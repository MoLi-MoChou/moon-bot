// The MCP connector framework (plan §阶段 5): a mounted MCP server's tools join the
// Zod registry as `mcp__<server>__<tool>` entries — the policy gate classifies them L3
// by default (unknown names), so every connector call runs inside the budget-and-
// approval flow without any connector-specific wiring. Results are verified on the way
// out (bounded text, error flag kept), and a dropped connection is retried once before
// the call fails — partial failure recovers instead of poisoning the session.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import type { ToolEntry, ToolOutcome, ToolRegistry } from '../registry.ts'
import type { EngineContentBlock } from '../events.ts'

/** The tool surface a connector talks to: the SDK client's, loosened for tests. */
interface ToolSurface {
  list(): Promise<{ tools: readonly { name: string, description?: string, inputSchema?: unknown }[] }>
  callTool(input: { name: string, arguments?: unknown }): Promise<{ content?: unknown, isError?: boolean }>
  close(): Promise<void>
}

/** How much of a connector result the model sees; the rest is a size note. */
const RESULT_CHARS = 20_000

export interface McpServerSpec {
  readonly id: string
  readonly command: string
  readonly args?: readonly string[] | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
}

/** One mounted server: its client and the entries it added to the registry. */
export class McpConnector {
  private client: Client | undefined
  private names: readonly string[] = []
  private readonly tools: ToolSurface

  private readonly spec: McpServerSpec

  constructor(spec: McpServerSpec, tools?: ToolSurface) {
    this.spec = spec
    // A test can hand its own tool surface; production gets the SDK client lazily.
    // A test can hand its own tool surface; production gets the SDK client lazily,
    // behind the loose shape the connector reads.
    const surface = (): ToolSurface => {
      const own = this.connect()
      return {
        list: async () => (await (await own).listTools()) as unknown as { tools: readonly { name: string, description?: string, inputSchema?: unknown }[] },
        callTool: async input => (await (await own).callTool(input as never)) as unknown as { content?: unknown, isError?: boolean },
        close: async () => { await this.client?.close().catch(() => {}); this.client = undefined },
      }
    }
    this.tools = tools ?? surface()
  }

  private async connect(): Promise<Client> {
    this.client ??= new Client({ name: 'moon-bot', version: '0.1.0' }, { capabilities: {} })
    await this.client.connect(new StdioClientTransport({
      command: this.spec.command,
      args: [...(this.spec.args ?? [])],
      ...(this.spec.env !== undefined ? { env: { ...process.env, ...this.spec.env } as Record<string, string> } : {}),
    }))
    return this.client
  }

  /** The server's tools as registry entries, namespaced and policy-visible. */
  async entries(): Promise<readonly ToolEntry[]> {
    const listed = await this.tools.list()
    const tools = listed.tools
    return tools.flatMap((tool): readonly ToolEntry[] => {
      if (typeof tool?.name !== 'string' || tool.name === '') return []
      const schema = tool.inputSchema !== null && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
        ? tool.inputSchema as Readonly<Record<string, unknown>>
        : { type: 'object', properties: {} }
      const name = `mcp__${this.spec.id}__${tool.name}`
      const description = typeof tool.description === 'string' && tool.description !== '' ? tool.description : `${this.spec.id} tool ${tool.name}`
      return [{
        name,
        description,
        parameters: schema,
        // The server validates its own input; the registry's schema passes it through.
        schema: z.record(z.unknown()),
        execute: async (input: Readonly<Record<string, unknown>>): Promise<ToolOutcome | string> => this.call(tool.name, input),
      }] as unknown as readonly ToolEntry[]
    })
  }

  /** One call, verified and bounded; a dropped connection is retried once. */
  private async call(tool: string, input: Readonly<Record<string, unknown>>): Promise<ToolOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.tools.callTool({ name: tool, arguments: input })
        const blocks: EngineContentBlock[] = Array.isArray(result.content)
          ? result.content.flatMap(block => {
            const view = block as { type?: unknown, text?: unknown }
            return view?.type === 'text' && typeof view.text === 'string' ? [{ type: 'text', text: view.text }] : []
          })
          : []
        let text = blocks.map(block => block.type === 'text' ? block.text : '').join('\n')
        if (text.length > RESULT_CHARS) text = `${text.slice(0, RESULT_CHARS)}\n… (${String(text.length - RESULT_CHARS)} more characters cut)`
        return {
          content: text === '' ? [] : [{ type: 'text', text }],
          ...(result.isError === true ? { isError: true } : {}),
        }
      } catch (error) {
        // A broken connection is refreshed once; the second failure is the answer.
        if (attempt === 0) {
          await this.tools.close().catch(() => {})
          continue
        }
        return { content: [{ type: 'text', text: `${this.spec.id}.${tool} failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
      }
    }
  }

  /** Mounts this server's tools into a registry; the disposer unmounts them. */
  async mount(registry: ToolRegistry): Promise<() => void> {
    const entries = await this.entries()
    for (const entry of entries) registry.register(entry)
    this.names = entries.map(entry => entry.name)
    return () => { void this.tools.close() }
  }

  get mountedNames(): readonly string[] {
    return this.names
  }
}

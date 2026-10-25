// Mounting a capability into a DSH-hosted Agent (plan §阶段 6's hosted seam): the MCP
// server or skill becomes a fiber on the Agent's own context, so it lives as long as
// that Session does and goes away with it. The MCP client is imported lazily, so a
// standalone build never touches it.
import type { Agent, LoaderService, PluginFiber } from './dsh-types.js'

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

export interface HostMountHost {
  readonly ctx: { get<T>(name: string): T | undefined }
}

/** The skill plugin or the MCP client plugin, as the DSH plugin host takes them. */
export class HostMounts {
  private pluginPromise: Promise<unknown> | undefined
  private readonly host: HostMountHost

  constructor(host: HostMountHost) {
    this.host = host
  }

  /** The MCP client plugin, loaded once per process. */
  private mcpPlugin(): Promise<unknown> {
    this.pluginPromise ??= (async () => {
      const loader = this.host.ctx.get<LoaderService>('loader')
      if (typeof loader?.import !== 'function') throw new Error('This DSH cannot load MCP servers.')
      const exports = await loader.import(MCP_CLIENT)
      return loader.unwrapExports?.(exports) ?? (exports as { readonly default?: unknown } | undefined)?.default ?? exports
    })()
    return this.pluginPromise
  }

  /** A skill on the Agent: its catalog entry lives as long as the Session. */
  async skillMount(agent: Agent, name: string, config: Readonly<Record<string, unknown>>): Promise<{ fiber: PluginFiber | undefined }> {
    const plugin = {
      name: `ds-bot-capability-skill-${name}`,
      inject: ['skills'],
      apply(c: { effect(execute: () => unknown): void; readonly skills: { register(entry: Record<string, unknown>): void } }) {
        c.effect(() => c.skills.register({ name: config.name, description: config.description, source: 'runtime', content: config.content }))
      },
    }
    return this.start(agent, plugin)
  }

  /** An MCP server on the Agent: its tools join that Session's tool list. */
  async mcpMount(agent: Agent, _name: string, config: Readonly<Record<string, unknown>>): Promise<{ fiber: PluginFiber | undefined }> {
    return this.start(agent, await this.mcpPlugin(), config)
  }

  private async start(agent: Agent, plugin: unknown, config?: Readonly<Record<string, unknown>>): Promise<{ fiber: PluginFiber | undefined }> {
    const fiber = config === undefined ? agent.ctx?.plugin?.(plugin) : agent.ctx?.plugin?.(plugin, config)
    if (fiber === undefined) throw new Error('This DSH cannot mount capabilities on an Agent.')
    await fiber.await?.()
    return { fiber }
  }
}

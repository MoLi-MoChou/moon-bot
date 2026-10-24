// The DSH derivation of a registry entry (plan §阶段 2, transition): while DSH runs the
// loop, every registry tool is also registered with DSH — same executor, same parameter
// map, no schema validation on this path (the executors stay lenient exactly as they
// are today). When phase 3 retires the DSH loop, this file goes with it.
//
// defineTool loads lazily: the standalone service has no DSH install, and there the
// registration is a plain pass-through anyway (the context's own collector).
import type { ToolContext, ToolEntry, ToolOutcome } from '../../engine/registry.ts'
import type { HostRuntime } from '../runtime.ts'
import { output, type ToolOutput } from './shared.ts'

export interface DshToolContext {
  readonly tools: { register(tool: unknown): () => void }
}

type ToolWrapper = <T extends Record<string, unknown>>(definition: T) => T

let wrapper: Promise<ToolWrapper> | undefined

const toolWrapper = (): Promise<ToolWrapper> => {
  wrapper ??= import('@deepseek-ai/dsh-tools')
    .then(module => module.defineTool as ToolWrapper)
    // Without a DSH install the registration takes the definition as it is.
    .catch(() => ((definition: unknown) => definition) as unknown as ToolWrapper)
  return wrapper
}

const asText = (outcome: ToolOutcome): string => outcome.content
  .flatMap(block => block.type === 'text' ? [block.text] : [])
  .join('\n')

/** Registers one entry with DSH, adapting the ToolContext. */
export function registerDshTool(ctx: DshToolContext, entry: ToolEntry, rt: HostRuntime, toolOutput: ToolOutput = output): void {
  void toolWrapper().then(defineTool => {
    ctx.tools.register(defineTool({
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters,
      output: toolOutput,
      async execute(args: Readonly<Record<string, unknown>>, exec: { readonly agent?: { readonly id?: string, readonly session?: unknown, readonly [key: string]: unknown }, readonly callId?: string, readonly signal?: AbortSignal, concludeTurn?(): void }): Promise<string> {
        const sessionId = exec.agent?.id
        if (sessionId === undefined) return `${entry.name} needs a session to run in.`
        const context: ToolContext = {
          sessionId,
          callId: exec.callId ?? '',
          ...(exec.agent?.session !== undefined ? { session: exec.agent.session } : {}),
          // The live agent rides along for the tools that hand it on (group_relay's round
          // drains its inbox); the registry context itself stays agent-free.
          ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
          ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
          ...(exec.concludeTurn !== undefined ? { concludeTurn: () => exec.concludeTurn?.() } : {}),
        }
        const outcome = await entry.execute(args as Readonly<Record<string, unknown>>, context)
        if (typeof outcome === 'string') return outcome
        if (outcome.isError === true) rt.warn('ds-bot: %s answered an error: %s', entry.name, asText(outcome))
        return asText(outcome)
      },
    } as Record<string, unknown>))
  }).catch(error => rt.warn('ds-bot: registering %s with DSH failed: %s', entry.name, error))
}

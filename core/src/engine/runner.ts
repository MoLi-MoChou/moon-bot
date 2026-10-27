// The execution boundary between Moon Bot's host and the machine that runs an Agent.
// LocalRunner is the in-process implementation used today; its small interface is the
// seam a headless daemon/remote runner can implement without changing Bot delivery.
import type { AgentRuntime } from './runtime.ts'
import { AcpRuntime } from './acp/runtime.ts'
import { localEngineCatalog, type EngineCatalog, type LocalAgent } from './acp/discovery.ts'

export interface RunnerBotSpec {
  readonly runtimeId?: unknown
  readonly engine?: unknown
}

export interface RunnerOptions {
  readonly builtin: AgentRuntime
  readonly emit: (sessionId: string, event: import('./events.ts').EngineEvent) => void
  readonly catalog?: EngineCatalog
}

export interface ExecutionRunner {
  runtimeFor(sessionId: string, bot: RunnerBotSpec | undefined): AgentRuntime
  stop(): Promise<void>
}

export class LocalRunner implements ExecutionRunner {
  private readonly acp = new Map<string, AcpRuntime>()
  private readonly catalog: EngineCatalog
  private readonly options: RunnerOptions
  private discovered: readonly LocalAgent[] | undefined

  constructor(options: RunnerOptions) {
    this.options = options
    this.catalog = options.catalog ?? localEngineCatalog
  }

  runtimeFor(_sessionId: string, bot: RunnerBotSpec | undefined): AgentRuntime {
    const localAgents = this.discovered ?? (this.discovered = this.catalog.list())
    const discovered = typeof bot?.runtimeId === 'string'
      ? localAgents.find(entry => entry.id === bot.runtimeId && entry.kind === 'acp')
      : undefined
    const configured = bot?.engine
    const spec = discovered ?? (configured !== null && typeof configured === 'object' && (configured as { kind?: unknown }).kind === 'acp'
      ? configured as { command?: unknown; args?: readonly string[]; key?: unknown }
      : undefined)
    const command = typeof spec?.command === 'string' ? spec.command : ''
    if (command === '') return this.options.builtin
    const key = typeof spec?.key === 'string' && spec.key !== '' ? spec.key : command
    let runtime = this.acp.get(key)
    if (runtime === undefined) {
      runtime = new AcpRuntime({
        command,
        ...(Array.isArray(spec?.args) ? { args: spec.args } : {}),
        emit: this.options.emit,
      })
      this.acp.set(key, runtime)
    }
    return runtime
  }

  async stop(): Promise<void> {
    await Promise.all([...this.acp.values()].map(runtime => runtime.stop().catch(() => undefined)))
    this.acp.clear()
  }
}

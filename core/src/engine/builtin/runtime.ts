// The built-in engine's runtime: implements AgentRuntime over the pi kernel. One turn at
// a time per session (the inbox semantics the roster builds on): a runTurn that lands
// while another runs waits for its slot; `steer` joins the running turn instead.
//
// Transcript persistence is total: the user trigger, every assistant step and the turn's
// end reason go to the store, in order. The pi Agent is per-turn (state is rebuilt from
// the store), so a restart or a part switch changes nothing the loop depends on.
import type { Agent } from '@earendil-works/pi-agent-core'
import type { EngineEvent } from '../events.ts'
import type { AgentRuntime, CancelReason, TurnInput, TurnMessage } from '../runtime.ts'
import { buildAgent, contentOfPi, endEventOf } from './adapter.ts'
import type { EngineServices } from './services.ts'

interface Waiter {
  readonly resolve: () => void
}

interface SessionState {
  turns: number
  running: boolean
  readonly queue: Waiter[]
  agent?: Agent | undefined
  cancelReason?: CancelReason | undefined
}

export interface BuiltinOptions {
  readonly services: EngineServices
  /** Where the engine's events go: the session/event fanout the turn router listens on. */
  readonly emit: (sessionId: string, event: EngineEvent) => void
}

export class BuiltinRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, SessionState>()
  private readonly options: BuiltinOptions

  constructor(options: BuiltinOptions) {
    this.options = options
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    for (const state of this.sessions.values()) state.agent?.abort()
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const state = this.stateOf(input.sessionId)
    // One turn per session: a caller that arrives mid-turn waits, and its events flow
    // only when its own turn runs — each delivery answers its own trigger.
    if (state.running) {
      await new Promise<void>(resolve => { state.queue.push({ resolve }) })
    }
    yield* this.pump(input)
    // The next waiter's turn starts as this generator's last act; its own events were
    // already flowing through its own runTurn, which the resolve() below unblocked.
    state.queue.shift()?.resolve()
  }

  async steer(sessionId: string, message: TurnMessage): Promise<boolean> {
    const state = this.sessions.get(sessionId)
    if (state === undefined || !state.running || state.agent === undefined) return false
    const blocks = message.content.map(block => ({ type: 'text' as const, text: block.type === 'text' ? block.text : JSON.stringify(block) }))
    state.agent.steer({ role: 'user', content: blocks, timestamp: Date.now() })
    this.options.emit(sessionId, { type: 'user/message', content: message.content, source: message.source })
    return true
  }

  async cancelTurn(sessionId: string, reason: CancelReason = 'user'): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (state === undefined || !state.running) return
    state.cancelReason = reason
    state.agent?.abort()
  }

  private stateOf(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (state === undefined) this.sessions.set(sessionId, state = { turns: 0, running: false, queue: [], agent: undefined })
    return state
  }

  /**
   * Runs one turn and yields its events as they land: the turn drives forward, the
   * generator drains what it produced so far each time control returns.
   */
  private async *pump(input: TurnInput): AsyncIterable<EngineEvent> {
    const state = this.stateOf(input.sessionId)
    state.running = true
    state.turns += 1
    const turn = state.turns
    const pending: EngineEvent[] = []
    let wake: (() => void) | undefined
    const collect = (event: EngineEvent): void => {
      pending.push(event)
      this.options.emit(input.sessionId, event)
      const open = wake
      wake = undefined
      open?.()
    }
    let settled = false
    const run = this.runOne(input, turn, collect).finally(() => {
      settled = true
      const open = wake
      wake = undefined
      open?.()
    })
    while (true) {
      while (pending.length > 0) yield pending.shift() as EngineEvent
      if (settled) {
        await run
        while (pending.length > 0) yield pending.shift() as EngineEvent
        return
      }
      await new Promise<void>(resolve => { wake = resolve })
    }
  }

  private async runOne(input: TurnInput, turn: number, collect: (event: EngineEvent) => void): Promise<void> {
    const { services } = this.options
    const state = this.stateOf(input.sessionId)
    try {
      // What the turn answers arrives first, as the router's user/message.
      collect({ type: 'turn/start', turn })
      collect({ type: 'user/message', content: input.message.content, source: input.message.source })
      const resolved = await services.models.resolve(input.sessionId, input.config)
      if (resolved === undefined) {
        collect({ type: 'turn/end', turn, reason: { kind: 'error', error: { code: 'NO-MODEL', message: `no model for session ${input.sessionId}` } } })
        return
      }
      const [base, frozen, dynamic, history] = await Promise.all([
        services.prompt.base(input.sessionId),
        services.prompt.frozen(input.sessionId),
        services.prompt.dynamic?.(input.sessionId) ?? Promise.resolve(undefined),
        services.transcript.history(input.sessionId),
      ])
      const agent = await buildAgent({
        sessionId: input.sessionId, services, config: input.config,
        basePrompt: base, frozenPrompt: frozen, dynamicPrompt: dynamic,
        history, resolved, callbacks: { onEvent: collect },
      })
      state.agent = agent
      await services.transcript.append(input.sessionId, { role: 'user', content: input.message.content, turn, at: Date.now() })
      const before = agent.state.messages.length
      try {
        // One user message carries the turn's trigger; text blocks stay text, other
        // blocks ride as their JSON stand-in (the host keeps the originals).
        const blocks = input.message.content.map(block => ({ type: 'text' as const, text: block.type === 'text' ? block.text : JSON.stringify(block) }))
        await agent.prompt([{ role: 'user', content: blocks, timestamp: Date.now() }])
      } finally {
        // Whatever the run's fate, what was said is the transcript now. Each kernel
        // message is kept raw as well, so the next turn replays it verbatim.
        for (const message of agent.state.messages.slice(before)) {
          // The trigger itself was stored before the run; pi echoes it as a user message.
          if (message.role !== 'assistant' && message.role !== 'toolResult') continue
          await services.transcript.append(input.sessionId, {
            role: message.role,
            content: contentOfPi(message as { content: readonly unknown[] }),
            turn,
            ...(message.role === 'assistant' && 'stopReason' in message ? { stopReason: String((message as { stopReason?: unknown }).stopReason ?? '') } : {}),
            raw: message,
            at: Date.now(),
          })
        }
      }
      const last = [...agent.state.messages].reverse().find(message => message.role === 'assistant') as { stopReason?: string | undefined; errorMessage?: string | undefined } | undefined
      collect(endEventOf(turn, last, state.cancelReason))
    } catch (error) {
      collect({ type: 'turn/end', turn, reason: { kind: 'error', error: { message: error instanceof Error ? error.message : String(error) } } })
    } finally {
      state.running = false
      state.agent = undefined
      state.cancelReason = undefined
    }
  }
}

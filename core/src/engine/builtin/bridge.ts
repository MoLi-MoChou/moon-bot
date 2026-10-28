// The host bridge: one engine-backed agent per session, shaped as the agent the host's
// delivery already knows (followup/steer/cancel, an inbox for resume checks, a running
// status). What DSH's session runtime did for an inbox push, the engine does here: a
// followup opens a turn (queued behind a running one), a steer cuts into it. The
// runtime itself sends every engine event to the session/event fanout, which is the
// vocabulary the turn router consumes; the bridge only drains the turn, so it must not
// send them a second time. This is the seam phase 3's service wires for real.
import type { EngineEvent } from '../events.ts'
import type { AgentRuntime } from '../runtime.ts'

/** A delivered message as the host builds it: content blocks plus its delivery source. */
export interface DeliveredMessage {
  readonly content: readonly { readonly type: string, readonly [key: string]: unknown }[]
  readonly source?: Readonly<Record<string, unknown>> | undefined
}

export interface BridgeAgent {
  readonly session: { readonly id: string, readonly seq?: number }
  /** Every message that was pushed to this session, in order (the audit surface). */
  readonly calls: DeliveredMessage[]
  readonly inbox: { nextStep: unknown[], nextTurn: unknown[], remove(message: unknown): boolean }
  followup(message: DeliveredMessage): void
  steer(message: DeliveredMessage): void
  cancel(): void
  readonly status: 'running' | 'idle'
}

export interface BridgeOptions {
  readonly runtime: AgentRuntime | (() => AgentRuntime)
  /**
   * The host's session/event fanout, the same one the runtime emits to. The bridge uses
   * it only for the turn/end of a runTurn that threw, which no runtime emitted.
   */
  readonly emitEvent: (sessionId: string, event: EngineEvent) => void
  /** A hook the host can use to observe settle (unused by the bridge itself). */
  onSettled?(sessionId: string): void
  /** The session's next sequence number, for the pagers that read agent.session.seq. */
  seqOf?(): number
}

export function engineAgentOf(sessionId: string, options: BridgeOptions): BridgeAgent {
  const calls: DeliveredMessage[] = []
  let running = false
  let activeRuntime: AgentRuntime | undefined
  const runtimeOf = (): AgentRuntime => typeof options.runtime === 'function' ? options.runtime() : options.runtime
  const start = (message: DeliveredMessage): void => {
    calls.push(message)
    running = true
    const runtime = runtimeOf()
    activeRuntime = runtime
    void (async () => {
      try {
        // Drained, not re-emitted: the runtime sent each event to the fanout already.
        const turn = runtime.runTurn({ sessionId, message: { content: message.content as never, source: message.source } })[Symbol.asyncIterator]()
        while ((await turn.next()).done !== true) continue
      } catch {
        // A runTurn that throws (a broken service) still ends the turn: the router
        // must not be left waiting on a session that will never speak.
        options.emitEvent(sessionId, { type: 'turn/end', turn: 0, reason: { kind: 'error', error: { message: 'the engine turn crashed' } } })
      } finally {
        running = false
        if (activeRuntime === runtime) activeRuntime = undefined
        options.onSettled?.(sessionId)
      }
    })()
  }
  return {
    session: { id: sessionId, get seq() { return options.seqOf?.() ?? 0 } },
    calls,
    inbox: { nextStep: [], nextTurn: [], remove: () => false },
    followup: start,
    steer: (message) => {
      // A steer on an idle session starts the turn now (DSH's inbox would run it as
      // the next step); on a running one it cuts into that turn.
      void (activeRuntime ?? runtimeOf()).steer(sessionId, { content: message.content as never, source: message.source }).then(joined => {
        if (!joined) start(message)
      })
    },
    cancel: () => { void (activeRuntime ?? runtimeOf()).cancelTurn(sessionId, 'user') },
    get status() { return running ? 'running' : 'idle' },
  }
}

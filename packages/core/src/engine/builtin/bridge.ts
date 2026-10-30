// The host bridge: one engine-backed agent per session, shaped as the agent the host's
// delivery already knows (followup/steer/cancel, an inbox for resume checks, a running
// status). What the host's session runtime did for an inbox push, the engine does here: a
// followup opens a turn (queued behind a running one, and counted for the task panel's
// queue figure), a steer cuts into it. The runtime itself sends every engine event to
// the session/event fanout, which is the vocabulary the turn router consumes; the
// bridge only drains the turn, so it must not send them a second time. This is the
// seam phase 3's service wires for real.
import { randomUUID } from 'node:crypto'
import type { EngineEvent } from '../events.ts'
import type { AgentRuntime, EngineSessionConfig } from '../runtime.ts'

/** A delivered message as the host builds it: content blocks plus its delivery source. */
export interface DeliveredMessage {
  readonly content: readonly { readonly type: string; readonly [key: string]: unknown }[]
  readonly source?: Readonly<Record<string, unknown>> | undefined
}

/** One accepted message that has not started its own turn yet. */
export interface QueuedTurn {
  readonly id: string
  readonly content: DeliveredMessage['content']
  readonly source?: DeliveredMessage['source']
}

export interface BridgeAgent {
  readonly session: { readonly id: string; readonly seq?: number }
  /** Every message that was pushed to this session, in order (the audit surface). */
  readonly calls: DeliveredMessage[]
  /** `nextTurn` is the waiting list itself. `nextStep` stays empty: this engine has one queue. */
  readonly inbox: {
    readonly nextStep: readonly QueuedTurn[]
    readonly nextTurn: readonly QueuedTurn[]
    remove(id: string): boolean
    prepend(
      target: string,
      message: {
        readonly id?: string
        readonly content?: DeliveredMessage['content']
        readonly source?: DeliveredMessage['source']
      },
    ): void
  }
  /** Followups accepted while a turn runs, waiting for their own: the task panel's queue. */
  pendingTurns(): number
  followup(message: DeliveredMessage): void
  steer(message: DeliveredMessage): void
  /** `hook` says a Main Bot's stop_bot ended the turn; the user's own stop is `user`. */
  cancel(cause?: { readonly kind?: string }): void
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
  /** The session config (cwd, model, effort) as resolved by host services. */
  configOf?(sessionId: string): EngineSessionConfig | undefined
}

export function engineAgentOf(sessionId: string, options: BridgeOptions): BridgeAgent {
  const calls: DeliveredMessage[] = []
  let running = false
  let activeRuntime: AgentRuntime | undefined
  // A followup that lands while a turn runs waits for its own turn. The runtime would
  // queue the call itself, but then nothing could say how many wait; keeping them here
  // is the honest count the task panel shows, and a cancel drops them with the turn
  // (what the host's inbox did, and what stop_bot's own description promises).
  const waiting: QueuedTurn[] = []
  const runtimeOf = (): AgentRuntime => (typeof options.runtime === 'function' ? options.runtime() : options.runtime)
  const exchangeOf = (source: DeliveredMessage['source']): string | undefined => {
    const id = source?.exchangeId
    return typeof id === 'string' && id !== '' ? id : undefined
  }
  // `waiting` is the only mutable list. A second copy of the same id, or of a request
  // already queued under the same exchange, is not inserted again.
  const place = (message: DeliveredMessage & { readonly id?: string }, where: 'front' | 'back'): void => {
    const given = message.id
    const item: QueuedTurn =
      message.source === undefined
        ? { id: given !== undefined && given !== '' ? given : randomUUID(), content: message.content }
        : {
            id: given !== undefined && given !== '' ? given : randomUUID(),
            content: message.content,
            source: message.source,
          }
    const exchangeId = exchangeOf(item.source)
    if (
      waiting.some(
        queued => queued.id === item.id || (exchangeId !== undefined && exchangeOf(queued.source) === exchangeId),
      )
    )
      return
    if (where === 'front') waiting.unshift(item)
    else waiting.push(item)
  }
  const start = (message: DeliveredMessage): void => {
    calls.push(message)
    running = true
    const runtime = runtimeOf()
    activeRuntime = runtime
    const config = options.configOf?.(sessionId)
    void (async () => {
      try {
        // Drained, not re-emitted: the runtime sent each event to the fanout already.
        const turn = runtime
          .runTurn({
            sessionId,
            message: { content: message.content as never, source: message.source },
            ...(config !== undefined ? { config } : {}),
          })
          [Symbol.asyncIterator]()
        while ((await turn.next()).done !== true) continue
      } catch {
        // A runTurn that throws (a broken service) still ends the turn: the router
        // must not be left waiting on a session that will never speak.
        options.emitEvent(sessionId, {
          type: 'turn/end',
          turn: 0,
          reason: { kind: 'error', error: { message: 'the engine turn crashed' } },
        })
      } finally {
        running = false
        if (activeRuntime === runtime) activeRuntime = undefined
        options.onSettled?.(sessionId)
        const next = waiting.shift()
        if (next !== undefined) start(next)
      }
    })()
  }
  // A turn already runs: this message waits for its own. A steer that finds no turn
  // joins the queue too, so it does not jump the messages already waiting.
  const open = (message: DeliveredMessage): void => {
    if (running) {
      place(message, 'back')
      return
    }
    start(message)
  }
  return {
    session: {
      id: sessionId,
      get seq() {
        return options.seqOf?.() ?? 0
      },
    },
    calls,
    inbox: {
      nextStep: [],
      get nextTurn() {
        return waiting
      },
      remove: (id: string): boolean => {
        const index = waiting.findIndex(item => item.id === id)
        if (index < 0) return false
        waiting.splice(index, 1)
        return true
      },
      prepend: (_target, message) => {
        place({ ...message, content: message.content ?? [] }, 'front')
      },
    },
    pendingTurns: () => waiting.length,
    followup: open,
    steer: message => {
      // A steer on an idle session starts the turn now (the host's inbox would run it as
      // the next step); on a running one it cuts into that turn.
      void (activeRuntime ?? runtimeOf())
        .steer(sessionId, { content: message.content as never, source: message.source })
        .then(joined => {
          if (!joined) open(message)
        })
    },
    cancel: cause => {
      // The turn's end drops what waited behind it, and its abort reason says who ended
      // it: a Main Bot's `hook`, or the user's own stop.
      waiting.length = 0
      void (activeRuntime ?? runtimeOf()).cancelTurn(sessionId, cause?.kind === 'hook' ? 'hook' : 'user')
    },
    get status() {
      return running ? 'running' : 'idle'
    },
  }
}

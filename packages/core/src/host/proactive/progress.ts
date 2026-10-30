// The one event trigger this version has: nothing has moved for N minutes.
//
// It watches a conversation rather than a clock. "Moved" means anything the user or the Bot
// did that a reader would call progress: a message landed, a turn started or ended. The
// check is a poll because the host keeps no history of activity, only what is happening
// now; the observer below is the smallest thing that remembers when it last changed.
import type { TriggerDeps } from './trigger.ts'
import { trigger } from './trigger.ts'

/** How often the hook looks. Coarse on purpose: a nudge is never urgent. */
export const PROGRESS_POLL_MS = 60_000

/** What the hook watches: one subscription's session, and how long silence is too long. */
export interface Watched {
  readonly subscriptionId: string
  readonly botId: string
  readonly sessionId: string
  readonly minutes: number
}

export interface ProgressDeps extends TriggerDeps {
  readonly watched: () => readonly Watched[]
  /** When something last moved in that Session, as the host observed it. */
  readonly lastActivityAt: (sessionId: string) => number | undefined
  /** Whether a turn is running right now; a running turn is progress by definition. */
  readonly busy: (sessionId: string) => boolean
  /** Notes that the hook fired for this subscription at this time. */
  readonly noteFired: (subscriptionId: string, at: number) => void
  readonly now: () => number
}

/**
 * Whether a conversation has been still for long enough to be worth a look, and since when.
 * A conversation never seen to move is not stale: the hook only speaks about silence it
 * actually observed, not about silence it arrived too late to see.
 */
export function staleSince(
  watched: Watched,
  lastActivityAt: number | undefined,
  now: number,
  busy: boolean,
): number | undefined {
  if (busy) return undefined
  if (lastActivityAt === undefined) return undefined
  const still = now - lastActivityAt
  if (still < watched.minutes * 60_000) return undefined
  return lastActivityAt
}

/**
 * One poll. Each stale subscription runs the pipeline, which decides on its own whether
 * there is anything to say: the hook reports the silence, it does not decide the message.
 */
export async function pollProgress(deps: ProgressDeps): Promise<readonly string[]> {
  const now = deps.now()
  const fired: string[] = []
  for (const watched of deps.watched()) {
    if (watched.minutes <= 0) continue
    if (staleSince(watched, deps.lastActivityAt(watched.sessionId), now, deps.busy(watched.sessionId)) === undefined)
      continue
    // Marked before the run so a slow run cannot be started twice by the next tick.
    deps.noteFired(watched.subscriptionId, now)
    try {
      const outcome = await trigger(deps, watched.subscriptionId, watched.botId, 'event')
      deps.log('moon-bot: no-progress hook for %s: %s', watched.subscriptionId, outcome)
      fired.push(watched.subscriptionId)
    } catch (error) {
      deps.log(
        'moon-bot: no-progress hook for %s threw: %s',
        watched.subscriptionId,
        error instanceof Error ? error.message : error,
      )
      fired.push(watched.subscriptionId)
    }
  }
  return fired
}

/**
 * Remembers when each Session last moved. Fed from the host's own activity signal; the hook
 * reads it and never writes to the conversation itself.
 */
export class ProgressWatch {
  private readonly seen = new Map<string, number>()

  /** Records movement: a message, a turn starting, a turn ending. */
  moved(sessionId: string, at: number = Date.now()): void {
    this.seen.set(sessionId, at)
  }

  lastActivityAt(sessionId: string): number | undefined {
    return this.seen.get(sessionId)
  }

  forget(sessionId: string): void {
    this.seen.delete(sessionId)
  }
}

/** Starts the progress poll and returns the disposer. */
export function startProgressPoll(deps: ProgressDeps): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = (): void => {
    void pollProgress(deps)
      .catch((error: unknown) => {
        deps.log('moon-bot: no-progress poll failed: %s', error instanceof Error ? error.message : error)
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, PROGRESS_POLL_MS)
      })
  }
  timer = setTimeout(tick, PROGRESS_POLL_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

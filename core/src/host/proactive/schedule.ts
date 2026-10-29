// The poller that makes a subscription fire on its own.
//
// It is a poll rather than a timer per subscription because the set of subscriptions changes
// while the app runs, and a poll reads it fresh every tick. The timing itself comes from the
// scheduler's own `nextRunOf`, so a daily time, an interval or a cron expression all behave
// exactly as a scheduled task's would.
import { nextRunOf, type ScheduleSpec } from '../../service/scheduler.ts'
import { trigger, type TriggerDeps } from './trigger.ts'

/** How often the poll looks for something due. A minute late is fine for a nudge. */
export const DUE_POLL_MS = 30_000

export interface DueSubscription {
  readonly id: string
  readonly botId: string
  /** The scheduler's selector, as the store keeps it. */
  readonly when: string
}

export interface DueDeps extends TriggerDeps {
  readonly dueSubscriptions: () => readonly DueSubscription[]
  /** When this subscription last fired, as the store recorded it, or undefined. */
  readonly lastFiredAt: (subscriptionId: string) => number | undefined
  readonly noteFired: (subscriptionId: string, at: number) => void
  readonly now: () => number
}

/** Whether a subscription is due, and when it was due. */
export function dueAt(subscription: DueSubscription, lastFiredAt: number | undefined, now: number): number | undefined {
  let spec: ScheduleSpec
  try {
    spec = JSON.parse(subscription.when) as ScheduleSpec
  } catch {
    return undefined
  }
  // An empty selector never fires: a subscription with no time is a misconfiguration, not a
  // reason to run on every poll.
  if (spec === null || typeof spec !== 'object' || Object.keys(spec).length === 0) return undefined
  // The next run after the last firing, or after the beginning of time when it never fired.
  const from = lastFiredAt ?? 0
  const next = nextRunOf(spec, from)
  if (next === undefined || next > now) return undefined
  return next
}

/**
 * One poll: fires everything due, once each, and records that it fired so the next tick
 * moves on. A subscription that fails is recorded as fired anyway, so a broken one does not
 * retry every thirty seconds for the rest of the day.
 */
export async function pollDue(deps: DueDeps): Promise<readonly string[]> {
  const now = deps.now()
  const fired: string[] = []
  for (const subscription of deps.dueSubscriptions()) {
    const due = dueAt(subscription, deps.lastFiredAt(subscription.id), now)
    if (due === undefined) continue
    deps.noteFired(subscription.id, now)
    try {
      const outcome = await trigger(deps, subscription.id, subscription.botId, 'schedule')
      deps.log('moon-bot: proactive %s fired: %s', subscription.id, outcome)
      fired.push(subscription.id)
    } catch (error) {
      // trigger() does not throw by design; this is the belt for its braces.
      deps.log('moon-bot: proactive %s threw: %s', subscription.id, error instanceof Error ? error.message : error)
      fired.push(subscription.id)
    }
  }
  return fired
}

/** Starts the poll and returns the disposer. */
export function startDuePoll(deps: DueDeps): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = (): void => {
    void pollDue(deps).catch((error: unknown) => {
      deps.log('moon-bot: proactive poll failed: %s', error instanceof Error ? error.message : error)
    }).finally(() => {
      if (!stopped) timer = setTimeout(tick, DUE_POLL_MS)
    })
  }
  timer = setTimeout(tick, DUE_POLL_MS)
  timer.unref?.()
  return () => { stopped = true; clearTimeout(timer) }
}

// What starts a run: a schedule, the no-progress hook, or the user asking.
//
// The schedule case borrows the scheduler's timing (croner plus a poll, recovered from the
// tasks table after a restart) rather than growing a second timer; only the callback
// differs. The hook is a poll of its own because it watches conversations, not a clock.
import { deliverOnce, type SendDeps } from './send.ts'
import type { RunDeps, RunRequest } from './pipeline.ts'
import { startOfLocalDay, type EarlierCandidate } from './screen-hard.ts'

/** How often the no-progress hook looks. Coarse: a nudge is not urgent. */
export const HOOK_POLL_MS = 60_000
/** How many messages of the day a triggered run reads. */
const DAY_MESSAGES = 120

export interface TriggerDeps {
  readonly pipeline: RunDeps
  readonly send: SendDeps
  /** Everything one run needs to read, resolved at fire time. */
  readonly contextOf: (subscriptionId: string, botId: string) => Promise<{
    readonly topics: string
    readonly dailyCap: number
    readonly sessionId: string
    readonly quietFrom: string | null
    readonly quietTo: string | null
    readonly memory: readonly { readonly topic: string | null, readonly text: string, readonly added: string | null }[]
    readonly messages: readonly { readonly role: string, readonly text: string, readonly at: number }[]
    readonly earlier: readonly EarlierCandidate[]
    readonly alreadySaid: readonly string[]
    readonly deliveredToday: number
    readonly mentionedRecently: boolean
  } | undefined>
  readonly localTime: () => string
  readonly localDayStart: () => number
  readonly log: (message: string, ...rest: readonly unknown[]) => void
}

/**
 * Runs one subscription through the pipeline and delivers the result. Returns what
 * happened so a caller can log it; nothing is thrown, because a trigger that throws takes
 * the poller down with it.
 */
export async function trigger(deps: TriggerDeps, subscriptionId: string, botId: string, source: 'schedule' | 'event'): Promise<string> {
  const context = await deps.contextOf(subscriptionId, botId).catch((error: unknown) => {
    deps.log('moon-bot: active message context failed for %s: %s', subscriptionId, error instanceof Error ? error.message : error)
    return undefined
  })
  if (context === undefined) return 'no-context'
  const request: RunRequest = {
    subscriptionId,
    botId,
    sessionId: context.sessionId,
    triggerSource: source,
    readOnly: false,
    candidates: {
      topics: context.topics,
      memory: context.memory,
      messages: context.messages.slice(-DAY_MESSAGES),
      alreadySaid: context.alreadySaid,
    },
    screen: {
      deliveredToday: context.deliveredToday,
      dailyCap: context.dailyCap,
      earlier: context.earlier,
      mentionedRecently: context.mentionedRecently,
      localTime: deps.localTime(),
      quiet: context.quietFrom === null || context.quietTo === null ? null : { from: context.quietFrom, to: context.quietTo },
    },
  }
  const outcome = await deliverOnce(request, deps.pipeline, deps.send)
  // The quiet round: a run that produced nothing leaves no trace the user sees.
  if (outcome.kind === 'nothing' || outcome.kind === 'failed') return outcome.kind
  return outcome.kind === 'sent' ? 'sent' : `withheld:${outcome.reason}`
}

/** The epoch of the start of the host's local day, for the cap. */
export const dayStartFor = (timeZone: string | undefined, now: number = Date.now()): number =>
  startOfLocalDay(now, timeZone)

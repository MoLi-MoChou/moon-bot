// The morning retry: candidates that were held back by quiet hours, offered again once the
// window has passed.
//
// A delayed candidate is not prepared again. It was good enough to send at 23:00 and the
// facts have not changed by 08:00; what has changed is whether the user may be interrupted.
// So the retry re-runs the hard rules only, and skips preparation entirely — one fewer model
// call, and no chance of saying something different from what was already decided.
import type { HostRuntime } from '../runtime.js'
import { proactiveCaller, type ProactiveSource } from './deliver.ts'
import { screenHard, type EarlierCandidate } from './screen-hard.ts'

export interface DelayedCandidate {
  readonly id: string
  readonly subscriptionId: string
  readonly sessionId: string
  readonly text: string
  readonly evidence: readonly string[]
  readonly ttl: 'short' | 'long'
  readonly fingerprint: string
  readonly topicKeys: readonly string[]
  readonly createdAt: number
  readonly decidedAt: number | undefined
}

export interface RetryDeps {
  /** Candidates decided `delayed`, oldest first. */
  readonly delayedOf: (now: number) => readonly DelayedCandidate[]
  /** The same shape the first pass used, minus preparation. */
  readonly earlierOf: (subscriptionId: string) => readonly EarlierCandidate[]
  readonly deliveredToday: (subscriptionId: string) => number
  readonly dailyCapOf: (subscriptionId: string) => number
  readonly quietOf: (subscriptionId: string) => { readonly from: string; readonly to: string } | null
  readonly mentionedRecently: (subscriptionId: string) => boolean
  readonly localTime: () => string
  readonly now: () => number
  readonly send: (sessionId: string, text: string, source: ProactiveSource) => boolean
  readonly live: (sessionId: string) => boolean
  readonly record: (candidateId: string, decision: 'delivered' | 'dropped' | 'delayed', reason?: string | null) => void
  readonly log: (message: string, ...rest: readonly unknown[]) => void
}

export type RetryOutcome = 'sent' | 'still-quiet' | 'dropped' | 'gone'

/**
 * Retries the delayed candidates that can now be sent. Returns what happened to each, so a
 * caller can log it; nothing is thrown, because this runs from a poll.
 */
export async function retryDelayed(
  deps: RetryDeps,
): Promise<readonly { readonly id: string; readonly outcome: RetryOutcome }[]> {
  const now = deps.now()
  const results: { id: string; outcome: RetryOutcome }[] = []
  for (const candidate of deps.delayedOf(now)) {
    const verdict = screenHard({
      candidate,
      deliveredToday: deps.deliveredToday(candidate.subscriptionId),
      dailyCap: deps.dailyCapOf(candidate.subscriptionId),
      earlier: deps.earlierOf(candidate.subscriptionId),
      mentionedRecently: deps.mentionedRecently(candidate.subscriptionId),
      localTime: deps.localTime(),
      quiet: deps.quietOf(candidate.subscriptionId),
    })
    if (verdict.kind === 'delay') {
      // Still quiet, or quiet again by the time the poll reached it. Nothing changes.
      results.push({ id: candidate.id, outcome: 'still-quiet' })
      continue
    }
    if (verdict.kind === 'drop') {
      // It waited and the world moved on: the day's cap is spent, the user already talked
      // about it, or the subject was said again. Either way it is no longer worth sending.
      deps.record(candidate.id, 'dropped', `after the wait: ${verdict.reason}`)
      results.push({ id: candidate.id, outcome: 'dropped' })
      continue
    }
    if (!deps.live(candidate.sessionId)) {
      deps.record(candidate.id, 'dropped', 'the conversation was not open in the morning')
      results.push({ id: candidate.id, outcome: 'gone' })
      continue
    }
    const sent = deps.send(candidate.sessionId, proactiveCaller(candidate.text, candidate.evidence), {
      kind: 'proactive',
      subscriptionId: candidate.subscriptionId,
      candidateId: candidate.id,
    })
    if (!sent) {
      deps.record(candidate.id, 'dropped', 'the message could not be handed over in the morning')
      results.push({ id: candidate.id, outcome: 'gone' })
      continue
    }
    deps.record(candidate.id, 'delivered')
    results.push({ id: candidate.id, outcome: 'sent' })
  }
  if (results.length > 0) {
    deps.log('moon-bot: retried %s delayed candidate(s)', String(results.length))
  }
  return results
}

/** Whether a delayed candidate is worth keeping at all: a week is the de-duplication window. */
export const stillWorthRetrying = (candidate: DelayedCandidate, now: number): boolean =>
  now - candidate.createdAt <= 7 * 24 * 60 * 60_000

/** The host-facing wrapper: reads the store and sends through the runtime. */
export async function retryFrom(
  rt: HostRuntime,
  deps: Omit<RetryDeps, 'send' | 'live'> & {
    readonly send: RetryDeps['send']
  },
): Promise<readonly { readonly id: string; readonly outcome: RetryOutcome }[]> {
  return await retryDelayed({
    ...deps,
    live: sessionId => rt.readOnly() === undefined && rt.live.get(sessionId) !== undefined,
  })
}

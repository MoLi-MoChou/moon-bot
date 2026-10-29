// The host half of proactive messages: reads what a review needs, runs the pipeline, and
// reports candidates. Nothing here delivers a message — that arrives in a later step, and
// keeping the two apart is what makes the manual review collection start before any Bot is
// allowed to speak on its own.
import type { HostRuntime } from '../runtime.js'
import { startOfLocalDay } from './screen-hard.ts'
import { runOnce, type RunOutcome } from './pipeline.ts'
import type { DayMessage, MemoryLine } from './prep.ts'

/** How many messages of the day a review reads. Enough for a day, bounded for the prompt. */
const DAY_MESSAGES = 120
/** How long a candidate is remembered for the de-duplication window. */
const WINDOW_MS = 7 * 24 * 60 * 60_000

export interface ReviewCandidate {
  readonly id: string
  readonly text: string
  readonly evidence: readonly string[]
  readonly whyCare: string
  readonly ttl: 'short' | 'long'
  readonly would: 'send' | 'drop' | 'delay'
  readonly reason?: string
}

export interface Review {
  readonly candidates: readonly ReviewCandidate[]
  readonly considered: number
}

export interface ProactiveDeps {
  /** The store's proactive tables, or undefined when there is no store. */
  readonly store: () => {
    readonly recentCandidates: (subscriptionId: string, since: number) => readonly {
      readonly text: string
      readonly fingerprint: string
      readonly topicKeys: string
      readonly decision: { readonly decision: string, readonly decidedAt: number } | undefined
    }[]
    readonly deliveredOn: (subscriptionId: string, since: number, until: number) => number
  } | undefined
  /** The messages of one session since a moment, oldest first. */
  readonly messagesSince: (sessionId: string, since: number) => readonly DayMessage[]
  /** What the Bot remembers, as the memory panel reads it. */
  readonly memoryOf: (botId: string) => readonly MemoryLine[]
  /** Local wall-clock 'HH:MM' for the host's time zone. */
  readonly localTimeOf: (at: number) => string
  readonly timeZone: () => string | undefined
}

const clockOf = (at: number, timeZone: string | undefined): string => new Intl.DateTimeFormat('en-GB', {
  ...(timeZone === undefined ? {} : { timeZone }), hour12: false, hour: '2-digit', minute: '2-digit',
}).format(new Date(at))

/**
 * Looks back over the Bot's day and lists what it would say, without saying it.
 *
 * The screen still runs, so a candidate that would be dropped shows up with its reason:
 * that is the signal the two-week trial reads, and it is the difference between "nothing to
 * say" and "something to say that must not be sent".
 */
export async function review(rt: HostRuntime, deps: ProactiveDeps, botId: string): Promise<Review> {
  const bot = rt.botOf(botId)
  if (bot === undefined) throw new Error('Unknown Bot')
  const store = deps.store()
  const now = Date.now()
  const timeZone = deps.timeZone()
  const dayStart = startOfLocalDay(now, timeZone)
  const subscriptions = rt.proactiveSubscriptionsOf?.(botId) ?? []
  const candidates: ReviewCandidate[] = []
  let considered = 0
  for (const subscription of subscriptions) {
    const earlier = store?.recentCandidates(subscription.id, now - WINDOW_MS) ?? []
    const messages = deps.messagesSince(rt.chatOf(botId), dayStart)
    const outcome = await runOnce({
      subscriptionId: subscription.id,
      botId,
      sessionId: rt.chatOf(botId),
      triggerSource: 'manual',
      readOnly: true,
      candidates: {
        topics: subscription.topics,
        memory: deps.memoryOf(botId),
        messages: messages.slice(-DAY_MESSAGES),
        // The subjects it already raised, so a review does not propose them again.
        alreadySaid: earlier.map(item => item.text),
      },
      screen: {
        deliveredToday: store?.deliveredOn(subscription.id, dayStart, now) ?? 0,
        dailyCap: subscription.dailyCap,
        earlier: earlier.map(item => ({
          fingerprint: item.fingerprint,
          topicKeys: JSON.parse(item.topicKeys) as readonly string[],
          decision: item.decision?.decision as 'delivered' | 'quiet' | 'dropped' | 'delayed' | undefined,
          decidedAt: item.decision?.decidedAt,
        })),
        mentionedRecently: false,
        localTime: deps.localTimeOf(now),
        quiet: subscription.quietFrom === null || subscription.quietTo === null
          ? null
          : { from: subscription.quietFrom, to: subscription.quietTo },
      },
    }, {
      ask: async ({ system, prompt }) => {
        const small = rt.smallShot
        if (small === undefined) throw new Error('No model is available for a review')
        return small(botId, system, prompt)
      },
      newId: () => `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => now,
      log: (message, ...rest) => rt.warn(message, ...rest),
    })
    if (outcome.kind === 'prepared') {
      considered += 1
      candidates.push(toReviewCandidate(outcome))
    }
  }
  return { candidates, considered }
}

const toReviewCandidate = (outcome: Extract<RunOutcome, { kind: 'prepared' }>): ReviewCandidate => {
  const { candidate, verdict } = outcome
  const base = { id: candidate.id, text: candidate.text, evidence: candidate.evidence, whyCare: candidate.whyCare, ttl: candidate.ttl }
  if (verdict.kind === 'accept') return { ...base, would: 'send' }
  if (verdict.kind === 'delay') return { ...base, would: 'delay', reason: 'quiet-hours' }
  return { ...base, would: 'drop', reason: verdict.reason }
}

/** The 'HH:MM' a host reports for an instant, for the quiet-hours check. */
export const localTimeAt = clockOf

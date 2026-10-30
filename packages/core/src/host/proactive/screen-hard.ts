// The hard rules: the checks that run before any model is asked, because they are local,
// cheap and decide most candidates on their own. A model call only ever sees what survives
// here, which is both the cost story and the reason a bad candidate never costs anything.
//
// Order matters: the cheapest and most decisive checks come first, so a candidate that is
// over the day's cap never triggers a similarity comparison.
import { repeatsEarlier } from './similarity.ts'

/** How far back the de-duplication window looks. */
export const WINDOW_MS = 7 * 24 * 60 * 60_000
/** How far back "the user just talked about this" looks. */
export const MENTIONED_MS = 24 * 60 * 60_000

export type TriggerSource = 'schedule' | 'event' | 'manual' | 'preauth'
export type Ttl = 'short' | 'long'

export interface ScreenCandidate {
  readonly id: string
  readonly text: string
  readonly fingerprint: string
  readonly topicKeys: readonly string[]
  readonly ttl: Ttl
  readonly createdAt: number
}

/** One earlier candidate and what became of it, as the window sees it. */
export interface EarlierCandidate {
  readonly fingerprint: string
  readonly topicKeys: readonly string[]
  readonly decision: 'delivered' | 'quiet' | 'dropped' | 'delayed' | undefined
  readonly decidedAt: number | undefined
}

export interface ScreenInput {
  readonly candidate: ScreenCandidate
  /** How many this subscription already delivered on the user's local day. */
  readonly deliveredToday: number
  readonly dailyCap: number
  /** Candidates from the window, newest first, with their decisions. */
  readonly earlier: readonly EarlierCandidate[]
  /** Whether the user talked about this subject in the last day. */
  readonly mentionedRecently: boolean
  /** Local wall-clock time of the trigger, as 'HH:MM'. */
  readonly localTime: string
  /** The subscription's quiet hours, or null when it has none. */
  readonly quiet: { readonly from: string; readonly to: string } | null
}

export type DropReason = 'daily-cap' | 'repeats' | 'mentioned-recently' | 'quiet-hours' | 'not-worth-it' | 'concurrent'

export type ScreenVerdict =
  | { readonly kind: 'accept' }
  | { readonly kind: 'drop'; readonly reason: DropReason }
  /** Quiet hours, but the candidate stays true long enough to matter in the morning. */
  | { readonly kind: 'delay' }

const minutesOf = (time: string): number | undefined => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (match === null) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

/** Whether a local time falls inside quiet hours, which may run past midnight. */
export function withinQuietHours(
  localTime: string,
  quiet: { readonly from: string; readonly to: string } | null,
): boolean {
  if (quiet === null) return false
  const now = minutesOf(localTime)
  const from = minutesOf(quiet.from)
  const to = minutesOf(quiet.to)
  if (now === undefined || from === undefined || to === undefined) return false
  if (from === to) return false
  return from < to ? now >= from && now < to : now >= from || now < to
}

/**
 * The start of the user's local day, as an epoch, for counting what was delivered.
 * Subtracting the local time since midnight is exact at a day boundary and needs no
 * knowledge of the zone's offset, which changes with daylight saving.
 */
export function startOfLocalDay(now: number, timeZone: string | undefined): number {
  const format = new Intl.DateTimeFormat('en-GB', {
    ...(timeZone === undefined ? {} : { timeZone }),
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = format.formatToParts(now)
  const read = (kind: string): number => Number(parts.find(part => part.type === kind)?.value ?? 0)
  // Some zones render midnight as 24 rather than 00.
  const hour = read('hour') % 24
  const sinceMidnight = (hour * 60 + read('minute')) * 60_000 + read('second') * 1000
  return now - sinceMidnight
}

/**
 * Runs the hard rules in order and stops at the first one that decides. `accept` here means
 * "worth asking a model about", not "will be delivered".
 *
 * There is no separate "did not answer last time" rule: a candidate close enough to the
 * unanswered one to count as the same subject is already a repeat, and one further away is
 * a different thing to say, which the user asked to hear about.
 */
export function screenHard(input: ScreenInput): ScreenVerdict {
  const { candidate, earlier } = input

  // 1. The day's cap. Nothing else matters if this subscription has already spoken today.
  if (input.deliveredToday >= input.dailyCap) return { kind: 'drop', reason: 'daily-cap' }

  // 2. Said before, in the window, whether delivered or turned down. A rejected subject
  //    stays quiet: asking again tomorrow is how a Bot becomes a nuisance.
  const repeat = repeatsEarlier(candidate, earlier)
  if (repeat.repeats) return { kind: 'drop', reason: 'repeats' }

  // 3. The user brought it up themselves in the last day: no need to tell them.
  if (input.mentionedRecently) return { kind: 'drop', reason: 'mentioned-recently' }

  // 4. Quiet hours: a passing observation waits for nothing, a deadline survives to 08:00.
  if (withinQuietHours(input.localTime, input.quiet)) {
    return candidate.ttl === 'long' ? { kind: 'delay' } : { kind: 'drop', reason: 'quiet-hours' }
  }

  return { kind: 'accept' }
}

/** Whether an earlier candidate is inside the de-duplication window. */
export const insideWindow = (candidate: { readonly createdAt: number }, now: number): boolean =>
  now - candidate.createdAt <= WINDOW_MS

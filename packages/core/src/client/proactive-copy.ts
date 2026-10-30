// The words a proactive review uses, kept out of the component so they can be tested
// without a renderer (the client test rule forbids importing a .tsx from a test).
import { t } from './i18n.ts'

export interface ReviewCandidateLike {
  readonly would: 'send' | 'drop' | 'delay'
  readonly reason?: string | undefined
}

export interface QuietLike {
  readonly quietFrom: string | null
  readonly quietTo: string | null
}

/** Why a candidate would not go out, in the user's words rather than the reason code. */
export function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'daily-cap':
      return t('it already spoke today')
    case 'repeats':
      return t('it said this in the last week')
    case 'mentioned-recently':
      return t('you brought it up yourself today')
    case 'quiet-hours':
      return t('quiet hours')
    case 'not-worth-it':
      return t('it judged this not worth interrupting for')
    default:
      return t('not worth interrupting for')
  }
}

/** How a review outcome reads: what the Bot would do with this candidate right now. */
export function outcomeText(candidate: ReviewCandidateLike): string {
  if (candidate.would === 'send') return t('Would send now')
  if (candidate.would === 'delay') return t('Held for the morning')
  return t('Would not send: {reason}', { reason: reasonText(candidate.reason) })
}

/** The user's quiet hours, or none. */
export function quietLabel(subscription: QuietLike): string {
  if (subscription.quietFrom === null || subscription.quietTo === null) return t('No quiet hours')
  return t('Quiet {from}–{to}', { from: subscription.quietFrom, to: subscription.quietTo })
}

/** Whether a review found anything worth showing at all. */
export const hasCandidates = (review: { readonly candidates: readonly unknown[] } | null): boolean =>
  review !== null && review.candidates.length > 0

// Sending what survived the screen, and recording every outcome.
//
// This is the only place a proactive message leaves the system. It exists apart from the
// review so the two can be reasoned about separately: a review shows, this sends. Everything
// that is decided without sending still gets a decision row, because the window and the
// two-week trial both read that log.
import type { HostRuntime } from '../runtime.js'
import { canDeliver, proactiveCaller, type ProactiveSource } from './deliver.ts'
import type { Candidate } from './prep.ts'
import { runOnce, type RunDeps, type RunRequest } from './pipeline.ts'

export interface SendDeps {
  /** Hands the message to the Bot's chat with the proactive source. */
  readonly send: (sessionId: string, text: string, source: ProactiveSource) => boolean
  readonly record: (
    candidateId: string,
    decision: 'delivered' | 'quiet' | 'dropped' | 'delayed',
    reason?: string | null,
  ) => void
  /** Whether this Session can be spoken to right now. */
  readonly live: (sessionId: string) => boolean
}

export interface SendOutcome {
  readonly kind: 'nothing' | 'failed'
  readonly reason?: string | undefined
}

export interface Sent {
  readonly kind: 'sent'
  readonly candidate: Candidate
}

export type DeliverOutcome = Sent | SendOutcome | { readonly kind: 'withheld'; readonly reason: string }

/**
 * Runs the pipeline and sends its result if the screen allowed it.
 *
 * A candidate the screen dropped, delayed or the model turned down is recorded with that
 * reason and nothing reaches the user. When the Session is not live the candidate is
 * dropped rather than queued: a message prepared for a moment that has passed should not
 * arrive later as if it were current.
 */
export async function deliverOnce(request: RunRequest, deps: RunDeps, send: SendDeps): Promise<DeliverOutcome> {
  const outcome = await runOnce(request, deps)
  if (outcome.kind === 'nothing') return { kind: 'nothing' }
  if (outcome.kind === 'failed') return { kind: 'failed', reason: outcome.reason }
  const { candidate, verdict } = outcome
  if (verdict.kind === 'drop') {
    send.record(candidate.id, 'dropped', verdict.reason)
    return { kind: 'withheld', reason: verdict.reason }
  }
  if (verdict.kind === 'delay') {
    send.record(candidate.id, 'delayed', 'quiet-hours')
    return { kind: 'withheld', reason: 'quiet-hours' }
  }
  if (!send.live(request.sessionId)) {
    send.record(candidate.id, 'dropped', 'the conversation was not open')
    return { kind: 'withheld', reason: 'not-live' }
  }
  const sent = send.send(request.sessionId, proactiveCaller(candidate.text, candidate.evidence), {
    kind: 'proactive',
    subscriptionId: request.subscriptionId,
    candidateId: candidate.id,
  })
  if (!sent) {
    send.record(candidate.id, 'dropped', 'the message could not be handed over')
    return { kind: 'withheld', reason: 'send-failed' }
  }
  send.record(candidate.id, 'delivered')
  return { kind: 'sent', candidate }
}

/** The delivery side, built from the host: live check and the followup hand-off. */
export function senderFor(
  rt: HostRuntime,
  deliver: {
    readonly hand: (
      sessionId: string,
      message: {
        readonly content: readonly { readonly type: 'text'; readonly text: string }[]
        readonly source: ProactiveSource
      },
    ) => boolean
  },
): SendDeps['send'] {
  return (sessionId, text, source) => {
    if (!canDeliver(rt, sessionId)) return false
    return deliver.hand(sessionId, { content: [{ type: 'text', text }], source })
  }
}

// Delivering a proactive message, and the quiet round that leaves no trace.
//
// Delivery reuses the one write path a turn already has: the message goes into the Bot's
// own chat as a user-role message the Bot answers, with a source of its own so the
// interface can mark it and so the Bot is told where it came from. The alternative — writing
// an assistant message directly — would put words in the Bot's mouth that no turn produced.
import type { HostRuntime } from '../runtime.js'

/** The source marker every proactive delivery carries. */
export interface ProactiveSource {
  readonly kind: 'proactive'
  readonly subscriptionId: string
  readonly candidateId: string
}

export interface Deliver {
  /** Hands the message to the Bot's own chat. Returns false when the Session is not live. */
  readonly send: (sessionId: string, text: string, source: ProactiveSource) => boolean
}

/**
 * How the Bot is told a proactive message is its cue: the same bracketed shape a scheduled
 * reminder uses, so a Bot already knows to treat it as an instruction rather than as
 * something the user typed.
 */
export function proactiveCaller(text: string, evidence: readonly string[]): string {
  const lines = [
    '[PROACTIVE] The user asked you to keep an eye on something, and this is worth telling them now.',
    '',
    text,
  ]
  if (evidence.length > 0) {
    lines.push('', 'What this rests on:')
    for (const line of evidence) lines.push(`- ${line}`)
  }
  lines.push(
    '',
    'Say it in one or two short sentences, as yourself. Do not add a greeting, do not repeat the evidence as a list, and do not ask a question the user has to answer.',
  )
  return lines.join('\n')
}

/**
 * Records what became of a candidate. Every path goes through here, so the decision log is
 * the complete story of a subscription: what it prepared, what was sent, what was not and
 * why. The de-duplication window reads exactly this.
 */
export interface Decide {
  readonly record: (
    candidateId: string,
    decision: 'delivered' | 'quiet' | 'dropped' | 'delayed',
    reason?: string | null,
  ) => void
}

/** Whether a proactive message may be sent to a Session right now. */
export const canDeliver = (rt: HostRuntime, sessionId: string): boolean =>
  rt.readOnly() === undefined && rt.live.get(sessionId) !== undefined

/** Marks the source so the interface can show it was not the user who spoke. */
export const isProactiveSource = (source: unknown): source is ProactiveSource =>
  typeof source === 'object' && source !== null && (source as { kind?: unknown }).kind === 'proactive'

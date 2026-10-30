// The soft half of the screen: the one question a local rule cannot answer, whether this
// is worth interrupting a person for.
//
// It runs only on what the hard rules let through, so it is asked at most once per
// subscription per run. The prompt is deliberately strict: dropping a good candidate costs
// nothing, sending a bad one costs the user's trust in every later message.
import type { ScreenCandidate } from './screen-hard.ts'

export const JUDGE_SYSTEM = `You decide one thing: is this worth interrupting a person for?

You are given a message an assistant prepared to send unprompted, and the evidence behind it. Answer with one word.

INTERRUPT only if the message gives the user something they can act on (a concrete next step) or a fact they do not already know and would want. Both need the evidence to actually support it.

DROP if any of these hold:
- It only expresses care, concern, or encouragement. That is never worth an interruption.
- It restates what the user already knows.
- The evidence does not support the claim, or is too vague to check.
- It is a nag: the same request, again, without new information.
- It is about the assistant rather than the user's work.

When you are unsure, DROP. A missed message costs nothing; a pointless one costs trust.

Answer exactly INTERRUPT or DROP, and one short reason after a colon. Example: "DROP: only restates yesterday's plan."`

export type JudgeVerdict = { readonly kind: 'send' } | { readonly kind: 'drop'; readonly reason: string }

/** Reads the one-word answer, treating anything unclear as a drop. */
export function parseJudgeAnswer(raw: string): JudgeVerdict {
  const text = raw.trim()
  const head = /^[\s*_`]*([A-Za-z]+)/.exec(text)?.[1]?.toUpperCase() ?? ''
  const after = /:\s*(.+)$/s.exec(text)?.[1]?.trim() ?? ''
  if (head === 'INTERRUPT') return { kind: 'send' }
  if (head === 'DROP') return { kind: 'drop', reason: after === '' ? 'not worth interrupting for' : after }
  // An unreadable answer is a drop: the safe direction is silence.
  return { kind: 'drop', reason: 'the judge answered nothing usable' }
}

/** The question, with the candidate and the evidence it rests on. */
export function judgePrompt(
  candidate: Pick<ScreenCandidate, 'text'> & { readonly evidence: readonly string[]; readonly whyCare: string },
): string {
  return [
    '## The message it would send',
    candidate.text,
    '',
    '## Why it thinks this matters',
    candidate.whyCare === '' ? '(it did not say)' : candidate.whyCare,
    '',
    '## The evidence',
    ...(candidate.evidence.length === 0
      ? ['(none — this alone is a DROP)']
      : candidate.evidence.map(line => `- ${line}`)),
  ].join('\n')
}

export type JudgeAsk = (request: { readonly system: string; readonly prompt: string }) => Promise<string>

/**
 * Runs the soft judgement. A failed or unreadable answer drops the candidate: a message the
 * Bot could not justify is one the user should not receive.
 */
export async function judge(
  candidate: Pick<ScreenCandidate, 'text'> & { readonly evidence: readonly string[]; readonly whyCare: string },
  ask: JudgeAsk,
): Promise<JudgeVerdict> {
  // No evidence is already a drop, before spending a request on it.
  if (candidate.evidence.length === 0) return { kind: 'drop', reason: 'no evidence' }
  try {
    return parseJudgeAnswer(await ask({ system: JUDGE_SYSTEM, prompt: judgePrompt(candidate) }))
  } catch (error) {
    return { kind: 'drop', reason: `the judge failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// Prep: gathering what a proactive message could be about, without touching anything.
//
// Read-only by construction: this module is given what to read (memory entries, the day's
// messages, what was already said) and produces candidates. It never writes, never calls a
// paid capability unless the subscription allows it, and any failure means the user sees
// nothing at all — silence is the correct outcome of a bad day.
import type { Ttl, TriggerSource } from './screen-hard.ts'
import { fingerprintOf, topicKeysOf } from './similarity.ts'

/** What the user asked this subscription to watch. */
export interface Subscription {
  readonly id: string
  readonly botId: string
  readonly sessionId: string
  readonly topics: string
  readonly allowPaidPrep: boolean
}

/** One thing the Bot remembers, as memory stores it. */
export interface MemoryLine {
  readonly topic: string | null
  readonly text: string
  readonly added: string | null
}

/** One message from the conversation, flattened to what a reader needs. */
export interface DayMessage {
  readonly role: string
  readonly text: string
  readonly at: number
}

export interface PrepInput {
  readonly subscription: Subscription
  readonly memory: readonly MemoryLine[]
  readonly messages: readonly DayMessage[]
  /** Candidates already decided in the window, so the reader does not propose them again. */
  readonly alreadySaid: readonly string[]
  readonly now: number
  readonly triggerSource: TriggerSource
}

export interface Candidate {
  readonly id: string
  readonly text: string
  readonly evidence: readonly string[]
  readonly whyCare: string
  readonly ttl: Ttl
  readonly fingerprint: string
  readonly topicKeys: readonly string[]
  /** When it was prepared: the screen measures its windows from this. */
  readonly createdAt: number
}

/** The model call Prep needs, as a seam so the pipeline can be tested without a model. */
export interface PrepareAsk {
  /** Returns the raw text the model answered; parsing is this module's job. */
  (request: { readonly system: string, readonly prompt: string }): Promise<string>
}

export const PREP_SYSTEM = `You are the part of Moon Bot that decides whether anything from the last day is worth telling the user about, unprompted.

You are given what this Bot remembers, what was said in its conversation today, and the subjects it already raised. Find at most one thing the user would be glad to hear and does not already know.

Rules:
- A candidate needs evidence: name the day and message, the file, or the failure it comes from. Without evidence there is no candidate.
- It must be actionable (a concrete next step) or informative (a fact the user does not know yet). Saying you care about something is not a candidate.
- If the user already talked about it today, it is not a candidate.
- If nothing qualifies, answer exactly NOTHING. That is the normal answer, not a failure.
- Never invent a fact. Never report something the memory does not say.

Answer with JSON only, no prose: {"text": one sentence the user reads, "evidence": [up to three lines, each naming its source], "why": one sentence on why this matters now, "ttl": "short" or "long"}.
"short" is for something that stops mattering today; "long" is for a deadline or a commitment that still matters tomorrow.`

export function prepPrompt(input: PrepInput): string {
  const lines: string[] = []
  lines.push(`What the user asked to watch for: ${input.subscription.topics}`)
  lines.push('')
  lines.push('## What this Bot remembers')
  if (input.memory.length === 0) lines.push('(nothing)')
  for (const entry of input.memory.slice(0, 60)) {
    lines.push(`- ${entry.topic === null ? '' : `[${entry.topic}] `}${entry.text}${entry.added === null ? '' : ` (saved ${entry.added})`}`)
  }
  lines.push('')
  lines.push('## What was said in this conversation today')
  if (input.messages.length === 0) lines.push('(nothing)')
  for (const message of input.messages.slice(-80)) {
    const stamp = new Date(message.at).toISOString().slice(0, 16).replace('T', ' ')
    lines.push(`- ${stamp} ${message.role}: ${message.text.slice(0, 400)}`)
  }
  if (input.alreadySaid.length > 0) {
    lines.push('')
    lines.push('## Already raised, do not repeat')
    for (const said of input.alreadySaid.slice(0, 40)) lines.push(`- ${said}`)
  }
  return lines.join('\n')
}

const TTL_LONG = /\b(deadline|due|tomorrow|friday|monday|commit|promise|by \d|before \d|截止|明天|周五|下周|承诺)/i

/** The one case where a candidate is dropped before any model sees it. */
const empty = (value: string): boolean => value.trim() === '' || /^nothing$/i.test(value.trim())

interface Parsed {
  readonly text: string
  readonly evidence: readonly string[]
  readonly why: string
  readonly ttl: Ttl
}

/** Reads the model's JSON answer, tolerating a fenced block around it. */
export function parsePrepAnswer(raw: string): Parsed | undefined {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  if (empty(body)) return undefined
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (text === '') return undefined
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((line): line is string => typeof line === 'string' && line.trim() !== '').slice(0, 3)
    : []
  // No evidence, no candidate: an unsourced guess is exactly what the user must not get.
  if (evidence.length === 0) return undefined
  const why = typeof record.why === 'string' ? record.why.trim() : ''
  const said = typeof record.ttl === 'string' ? record.ttl.trim().toLowerCase() : ''
  const ttl: Ttl = said === 'long' || (said === '' && TTL_LONG.test(text)) ? 'long' : 'short'
  return { text, evidence, why, ttl }
}

/**
 * Runs one preparation. Returns at most one candidate: a Bot that arrives with three things
 * to say at once is the failure mode this whole design is avoiding.
 */
export async function prepare(input: PrepInput, ask: PrepareAsk, newId: () => string): Promise<Candidate | undefined> {
  // Nothing to read means nothing to say; do not spend a model call finding that out.
  if (input.memory.length === 0 && input.messages.length === 0) return undefined
  const answer = await ask({ system: PREP_SYSTEM, prompt: prepPrompt(input) })
  const parsed = parsePrepAnswer(answer)
  if (parsed === undefined) return undefined
  return {
    id: newId(),
    text: parsed.text,
    evidence: parsed.evidence,
    whyCare: parsed.why,
    ttl: parsed.ttl,
    fingerprint: fingerprintOf(parsed.text),
    topicKeys: topicKeysOf(parsed.text),
    createdAt: input.now,
  }
}

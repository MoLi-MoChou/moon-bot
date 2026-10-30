// "@Name" is read by one rule everywhere: the group host picks who answers with it,
// and the client draws the same mentions in the bubbles, so what the user sees called
// is what gets called. Pure, so both sides import it.

export const ALL_WORDS: readonly string[] = ['all', 'everyone', '所有人', '全体']
// The speaker names a group log and a Bot's own chat give the user ("User: …",
// "You: …"). A Bot with one of them would read as the user.
export const USER_NAMES: readonly string[] = ['user', 'you']

/** Someone `@` can call: a Bot on the team. */
export interface MentionTarget {
  readonly id: string
  readonly name: string
}

/** A group log line, whose `who` may read as the user even for a Bot. */
export interface LogLineLike {
  readonly who?: string | null
  readonly botId?: string
}

/** One `@Name` found in a text; `all` marks `@all`/`@所有人`. */
export type MentionSpan =
  | { readonly start: number; readonly end: number; readonly bot: MentionTarget }
  | { readonly start: number; readonly end: number; readonly all: true }

/** One `@label` the host wrote for a referenced conversation (not a call). */
export interface ReferenceSpan {
  readonly start: number
  readonly end: number
  readonly label: string
}

// The name a group log line goes by. A Bot named before such names were refused still
// never reads as the user.
export const speakerOf = (line: LogLineLike): string | null | undefined =>
  line.botId !== undefined &&
  USER_NAMES.includes(
    String(line.who ?? '')
      .trim()
      .toLowerCase(),
  )
    ? `Bot "${line.who}"`
    : line.who

// A letter, digit, "_" or "-" after a name means a longer word ("@Mi" in "@MiniMax"),
// and "/", "\" or a "." that goes on into a word mean a path: the host writes a file
// reference as "@docs/guide.md", which must not call a Bot named Docs. A letter,
// digit, "_", "." or "/" before "@" means an address ("a@b", "medium.com/@Writer").
const NAME_GOES_ON = /^(?:[a-z0-9_\-/\\]|\.[a-z0-9_-])/i
const ADDRESS_BEFORE = /[a-z0-9_./]/i
// Code and Markdown links, with or without a title, are literal text.
const LITERAL = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g

const fitsAt = (text: string, at: number, word: string): boolean =>
  text.slice(at, at + word.length).toLowerCase() === word.toLowerCase() &&
  !NAME_GOES_ON.test(text.slice(at + word.length))
const overlaps = (
  spans: readonly { readonly start: number; readonly end: number }[],
  start: number,
  end: number,
): boolean => spans.some(span => start < span.end && span.start < end)

// What a Bot may be named: something "@" can call without a second reading.
export function nameProblem(name: string): string | undefined {
  const text = String(name ?? '').trim()
  if (text === '') return 'A Bot needs a name'
  if (/[@`\r\n]/.test(text)) return 'A Bot name cannot contain @, ` or a line break'
  if (ALL_WORDS.includes(text.toLowerCase())) return `"${text}" calls everyone in a group, so it cannot be a Bot name`
  if (USER_NAMES.includes(text.toLowerCase()))
    return `"${text}" stands for the user in a chat, so it cannot be a Bot name`
  return undefined
}

// the host writes each referenced conversation into the message once as "@label"; that one
// occurrence per listed label is a reference, not a call. Longest labels go first so
// "@K notes" is never read as the label "K".
export function referenceSpans(text: string, labels: readonly string[] = []): ReferenceSpan[] {
  const spans: ReferenceSpan[] = []
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    const mention = `@${label}`
    for (let at = text.indexOf(mention); at !== -1; at = text.indexOf(mention, at + 1)) {
      const end = at + mention.length
      if (
        (at > 0 && ADDRESS_BEFORE.test(text[at - 1] ?? '')) ||
        NAME_GOES_ON.test(text.slice(end)) ||
        overlaps(spans, at, end)
      )
        continue
      spans.push({ start: at, end, label })
      break
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

// Every "@Name" and "@all" outside code, links and references, in order. Longest names
// match first, so "@新 Bot 2" is never "@新 Bot"; a name may hold spaces.
export function mentionSpans(
  text: string,
  bots: readonly MentionTarget[],
  { references = [] }: { readonly references?: readonly string[] } = {},
): MentionSpan[] {
  const value = String(text ?? '')
  const skip: { readonly start: number; readonly end: number }[] = [
    ...[...value.matchAll(LITERAL)].map(match => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + (match[0] ?? '').length,
    })),
    ...referenceSpans(value, references),
  ]
  const byLength = bots.filter(bot => bot?.name).sort((a, b) => b.name.length - a.name.length)
  const spans: MentionSpan[] = []
  for (let at = value.indexOf('@'); at !== -1; at = value.indexOf('@', at + 1)) {
    if ((at > 0 && ADDRESS_BEFORE.test(value[at - 1] ?? '')) || overlaps(skip, at, at + 1)) continue
    const bot = byLength.find(candidate => fitsAt(value, at + 1, candidate.name))
    const all = bot ? undefined : ALL_WORDS.find(word => fitsAt(value, at + 1, word))
    if (!bot && !all) continue
    const end = at + 1 + (bot ? bot.name.length : all === undefined ? 0 : all.length)
    spans.push(bot ? { start: at, end, bot } : { start: at, end, all: true })
    at = end - 1
  }
  return spans
}

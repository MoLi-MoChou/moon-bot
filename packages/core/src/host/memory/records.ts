// Memory records: one entry per bullet line ending in `[key: value; …]` metadata,
// and a MEMORY.md entry point whose `## Index` links topic files as [[topic]]. This
// module is the text format and the shared shapes; storage.ts writes them down.

// Fixed sizes, in characters. Both MEMORY.md files ride in every request of every
// part, so together they stay near 8,000 characters, a few thousand tokens. A topic is
// read whole in one recall. An entry holds one fact.
export const MEMORY_LIMITS = { entry: 300, main: 4_000, topic: 16_000, topics: 40 } as const

export const MAIN = 'MEMORY.md'
export const EMPTY_MAIN = '# Memory\n\n## Index\n'
export const INDEX = /^##\s+index\s*$/i
export const HEADING = /^#{1,6}\s/
// A change whose entry is gone; any other failure keeps the review's place.
export const NO_MATCH = 'memory/no-match'
export const GONE = 'memory/bot-gone'
export const DENIED = 'memory/denied'
const META = /\s*\[([A-Za-z][\w-]*:[^\];]*(?:;\s*[A-Za-z][\w-]*:[^\];]*)*)\]\s*$/

/** The `[key: value; …]` pairs at the end of an entry line. */
export type MemoryMeta = Readonly<Record<string, string>>
/** Metadata handed to `formatEntry`: an absent value is left out, as storage writes it. */
export type MemoryMetaInput = Readonly<Record<string, string | undefined>>

/** One bullet entry, as it sits in a file. */
export interface MemoryEntry {
  readonly line: number
  readonly text: string
  readonly meta: MemoryMeta
}

/** A parsed memory file: its lines, its entries and its topic links. */
export interface ParsedMemory {
  readonly lines: string[]
  readonly entries: MemoryEntry[]
  readonly links: string[]
}

/** One memory file as storage reads it: MEMORY.md (`topic` undefined) or a topic. */
export interface MemoryFile extends ParsedMemory {
  readonly topic: string | undefined
  readonly file: string
  readonly path: string
  readonly content: string
}

/** Whose memory a change or a read is for. */
export type MemoryScope =
  | { readonly kind: 'team' }
  | { readonly kind: 'bot'; readonly botId: string }
  | { readonly kind: 'group'; readonly roomId: string }

/** An entry with the file it came from. */
export interface TaggedEntry extends MemoryEntry {
  readonly file: MemoryFile
}

/** An entry with the file and the panel tag (`own`, `team` or `group`). */
export interface ScopedEntry extends TaggedEntry {
  readonly scope: string
}

/** Who makes a change: a Bot (with a Session), the user, or the review (`auto`). */
export interface MemoryActor {
  readonly id: string
  readonly name: string
  readonly session?: string | undefined
  readonly auto?: boolean | undefined
}

// ---------------------------------------------------------------------------
// Entries and files, as text.

export function splitMeta(body: string): { text: string; meta: MemoryMeta } {
  const found = META.exec(body)
  if (found === null || found[1] === undefined) return { text: body.trim(), meta: {} }
  const meta: Record<string, string> = {}
  for (const pair of found[1].split(';')) {
    const at = pair.indexOf(':')
    const key = pair.slice(0, at).trim().toLowerCase()
    if (key !== '') meta[key] = pair.slice(at + 1).trim()
  }
  return { text: body.slice(0, found.index).trim(), meta }
}

const metaValue = (value: unknown): string => String(value ?? '').replace(/[;[\]\n]/g, ' ').replace(/\s+/g, ' ').trim()
export function formatEntry(text: string, meta: MemoryMetaInput = {}): string {
  const pairs = Object.entries(meta).filter(([, value]) => metaValue(value) !== '').map(([key, value]) => `${key}: ${metaValue(value)}`)
  return `- ${text}${pairs.length > 0 ? ` [${pairs.join('; ')}]` : ''}`
}

// One line, without a bullet or metadata of its own: the tool adds those.
export function cleanEntry(raw: unknown): string {
  const line = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^(?:[-*•]\s+)+/, '')
  return splitMeta(line).text
}

// A flat file name: case folds on some file systems, so names are lower case.
export function cleanTopic(raw: unknown): string | undefined {
  const name = String(raw ?? '').trim().replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '').trim().toLowerCase().replace(/\s+/g, '-')
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,47}$/u.test(name) && name !== 'memory' ? name : undefined
}

// Bullets outside `## Index` are entries; the Index holds [[links]]. Other lines
// (titles, notes the user wrote by hand) are kept as they are.
export function parseMemory(content: unknown): ParsedMemory {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop()
  const entries: MemoryEntry[] = []
  const links: string[] = []
  let inIndex = false
  lines.forEach((line, index) => {
    if (HEADING.test(line)) {
      inIndex = INDEX.test(line.trim())
      return
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet === null || bullet[1] === undefined) return
    if (inIndex) {
      for (const match of bullet[1].matchAll(/\[\[([^\]]+)\]\]/g)) if (match[1] !== undefined) links.push(match[1].trim())
      return
    }
    const { text, meta } = splitMeta(bullet[1])
    if (text !== '') entries.push({ line: index, text, meta })
  })
  return { lines, entries, links }
}

export const joinLines = (lines: readonly string[]): string => `${lines.join('\n')}\n`

// A new entry goes after the last one above `## Index`, or at the end of a topic.
export function insertEntry(lines: readonly string[], line: string): string[] {
  const index = lines.findIndex(item => INDEX.test(item.trim()))
  const end = index === -1 ? lines.length : index
  let at = end
  while (at > 0 && (lines[at - 1] ?? '').trim() === '') at -= 1
  const head = lines.slice(0, at)
  const last = head.at(-1)
  if (last !== undefined && HEADING.test(last)) head.push('')
  const tail = lines.slice(end)
  return [...head, line, ...(tail.length > 0 ? ['', ...tail] : [])]
}

export function addLink(lines: readonly string[], topic: string): string[] {
  const next = [...lines]
  let index = next.findIndex(item => INDEX.test(item.trim()))
  if (index === -1) {
    if (next.length > 0) next.push('')
    next.push('## Index')
    index = next.length - 1
  }
  let end = next.findIndex((item, at) => at > index && HEADING.test(item))
  if (end === -1) end = next.length
  let at = end
  while (at > index + 1 && (next[at - 1] ?? '').trim() === '') at -= 1
  next.splice(at, 0, `- [[${topic}]]`)
  return next
}

export function removeLink(lines: readonly string[], topic: string): string[] {
  return lines.filter(line => {
    if (!/^\s*[-*]\s+\[\[([^\]]+)\]\]\s*$/.test(line)) return true
    const found = /\[\[([^\]]+)\]\]/.exec(line)
    return found === null || (found[1] ?? '').trim() !== topic
  })
}

export const squash = (text: unknown): string => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

// The entry a request means: the one with that exact text, else every entry that
// contains it.
export function matchEntries<T extends MemoryEntry>(entries: readonly T[], wanted: unknown): T[] {
  const key = squash(cleanEntry(wanted))
  if (key === '') return []
  const exact = entries.find(entry => squash(entry.text) === key)
  if (exact !== undefined) return [exact]
  return entries.filter(entry => squash(entry.text).includes(key))
}

const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
]
// Known key formats, or a long unbroken run of mixed-case letters and digits outside a
// link. Separators break runs, so paths and names-with-dashes stay; a document id in
// a URL looks like a key and is worth keeping.
export function looksLikeKey(text: string): boolean {
  if (KEY_PATTERNS.some(pattern => pattern.test(text))) return true
  const bare = text.replace(/\bhttps?:\/\/\S+/g, ' ')
  return (bare.match(/[A-Za-z0-9+=]{32,}/g) ?? []).some(run => /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run))
}

// "password … is x": a password word (or PIN, passcode, 验证码…), a few words naming whose or where ("for
// root", "of the staging box", "的"), then the verb that gives its value.
// "Password manager", "password policy", and words such as 因为 or 作为 give none.
const PASSWORD_GIVEN = /(?:密码(?!管理|策略|规则)|口令|验证码|校验码|\bpassw(?:or)?d\b(?!\s*(?:managers?|polic(?:y|ies)|rules?|resets?|strength|less)\b)|\bpwd\b|\bpin(?: code)?\b|\bpass(?:code|phrase)\b|\b(?:otp|cvv|cvc)\b|\b(?:security|verification) code\b)[^\n.。;；,，]{0,40}?(?:是|(?<![因作认成以行])为|还是|改成|改为|换成|设为|设成|用(?![户于来途])(?!\s*\S+\s*(?:管理|保存|存|记))|叫|:|：|=|\b(?:is|are|was|remains|stays|becomes)\b|\b(?:set|changed) to\b)\s*\S/i
// The value first, perhaps several words: "uses correct horse battery staple as the
// root password", "我用 hunter2 当密码".
const PASSWORD_AFTER = /(?:\b(?:use[sd]?|using|set|sets|chose|chosen|picked|picks)\s+(?:[^\s,.;]+\s+){1,8}?(?:as|for)\s+(?:[\w'-]+\s+){0,3}?(?:passw(?:or)?d\b(?!\s*(?:managers?|polic(?:y|ies)|rules?|resets?|strength|fields?|prompts?|screens?|box(?:es)?)\b)|pwd\b|pin\b(?!\s*(?:pads?|entry|fields?|prompts?|screens?)\b)|pass(?:code|phrase)\b|otp\b)|用(?![户于来途])[^\n,，。;；]{1,40}?(?:当作?|作为?|做)\s*\S{0,6}?(?:密码(?!管理)|口令|验证码))/i
// An ID number under its label: "SSN 123-45-6789", "passport number is A12345678",
// "护照号 E12345678". Dates are no ID.
const ID_GIVEN = /(?:\bssn\b|\bsocial security\b|\bpassport\b|\btax (?:id|number)\b|\bdriver'?s licen[cs]e\b|\bnational (?:id|insurance)\b|\bid (?:card|number)\b|护照|身份证|社保|税号|驾驶证|驾照)[^\n.。;；,，]{0,30}?(?<![A-Za-z0-9-])(?!\d{4}-\d{1,2}-\d{1,2}(?!\d))[a-z]{0,2}\d[\d -]{4,}\d/i

// A key, a password given as one ("the root password is …"), a short ID number under
// its label, or an ID or card number: 15 digits or more in a row, outside a link. Spaces between digits and hyphens
// between groups of three digits or more are read through; a date's two-digit groups
// keep two dates apart.
export function looksSecret(text: string): boolean {
  if (looksLikeKey(text)) return true
  if (PASSWORD_GIVEN.test(text) || PASSWORD_AFTER.test(text) || ID_GIVEN.test(text)) return true
  return /\d{15,}/.test(text.replace(/\bhttps?:\/\/\S+/g, ' ').replace(/(?<=\d) (?=\d)/g, '').replace(/(?<=\d{3})-(?=\d{3})/g, ''))
}

// ---------------------------------------------------------------------------
// Small readers shared by the modules.

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { readonly message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function lastWhere<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at]
    if (item !== undefined && predicate(item)) return item
  }
  return undefined
}

export function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at]
    if (item !== undefined && predicate(item)) return at
  }
  return -1
}

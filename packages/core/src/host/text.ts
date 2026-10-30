// Pure text helpers shared by the host modules: message text, names, model refs,
// cutting and estimating text, and the clock format of chat anchors.
import { COLORS, EXTRA_COLORS, LEGACY_COLORS, OWN_CHAT_LINE_MAX } from './constants.ts'

/** A color id saved under its legacy name reads as the current one. */
export const currentColor = (color: string | undefined): string | undefined =>
  (typeof color === 'string' && Object.hasOwn(LEGACY_COLORS, color) ? LEGACY_COLORS[color] : color)

/** Whether `color` names a Bot color: a palette id or a `#rrggbb` ink. */
export const isColor = (color: unknown): color is string =>
  typeof color === 'string' && (COLORS.includes(color) || EXTRA_COLORS.includes(color) || /^#[0-9a-f]{6}$/i.test(color))

/** A `provider/model` ref split into its parts; undefined when it has no provider. */
export const splitRef = (ref: unknown): { readonly provider: string; readonly model: string } | undefined => {
  const text = typeof ref === 'string' ? ref : ''
  const index = text.indexOf('/')
  return index > 0 ? { provider: text.slice(0, index), model: text.slice(index + 1) } : undefined
}

interface ContentBlock {
  readonly type?: unknown
  readonly text?: unknown
}

/** The text of a message's content blocks, joined and trimmed. */
export const textOf = (content: unknown): string => (Array.isArray(content) ? content : [])
  .filter((block): block is ContentBlock => block !== null && typeof block === 'object')
  .filter(block => block.type === 'text' && typeof block.text === 'string')
  .map(block => block.text as string)
  .join('\n')
  .trim()

export const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase()

export const unquote = (text: unknown): string => String(text ?? '').trim().replace(/^["'“”「『《]+|["'“”」』》]+$/g, '').trim()

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The part of a long message around the first match, so a search hit stays visible. */
export const excerpt = (text: string, wanted: string, max: number = OWN_CHAT_LINE_MAX): string => {
  if (text.length <= max) return text
  const at = wanted === '' ? 0 : Math.max(0, text.toLowerCase().indexOf(wanted) - 120)
  return `${at > 0 ? '…' : ''}${text.slice(at, at + max)}…`
}

/** An upper bound: a CJK character is about one token, other text about a third. */
export const estimateTokens = (text: string): number => {
  let tokens = 0
  for (const char of text) tokens += (char.codePointAt(0) ?? 0) > 0x2e7f ? 1 : 0.34
  return Math.ceil(tokens)
}

export const clip = (text: string, max: number, rest: string): string => (text.length > max ? `${text.slice(0, max)}… (cut; ${rest})` : text)

/** The first `max` UTF-16 units of a text, never half of a character. */
export const headOf = (text: string, max: number): string => {
  if (text.length <= max) return text
  const last = text[max - 1]
  return text.slice(0, last !== undefined && /[\uD800-\uDBFF]/.test(last) ? max - 1 : max)
}

export type Clock = (time: number | undefined) => string

/** A clock that prints `MM-DD HH:mm` in `timeZone` (other hosts' tasks keep their zone). */
export const createClock = (timeZone?: string): Clock => {
  const clockFormat = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone !== undefined ? { timeZone } : {}),
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  return time => (Number.isFinite(time) ? clockFormat.format(time).replace(',', '') : '?')
}

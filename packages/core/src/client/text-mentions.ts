import { mentionSpans } from 'moon-bot-contracts'
import type { TextBot } from './text-types.ts'

export type { TextBot } from './text-types.ts'

export const MENTION_ORIGIN = 'https://bots.local/'

export function linkMentions(
  text: string,
  bots: readonly TextBot[],
  selfId?: string,
  everyoneBots?: readonly TextBot[],
): string {
  if (!text || !text.includes('@')) return text
  let out = ''
  let cursor = 0
  for (const span of mentionSpans(text, bots) as { start: number; end: number; bot?: TextBot; all?: true }[]) {
    if (span.bot && span.bot.id !== selfId) {
      out += `${text.slice(cursor, span.start)}[${text.slice(span.start + 1, span.end).replace(/[[\]\\]/g, '\\$&')}](${MENTION_ORIGIN}${span.bot.id})`
      cursor = span.end
      continue
    }
    if (span.all && everyoneBots !== undefined && everyoneBots.length > 0) {
      const marks = everyoneBots
        .map(bot => `[${bot.name.replace(/[[\]\\]/g, '\\$&')}](${MENTION_ORIGIN}${bot.id})`)
        .join(' ')
      out += `${text.slice(cursor, span.start)}${text.slice(span.start, span.end)} (${marks})`
      cursor = span.end
    }
  }
  return cursor === 0 ? text : out + text.slice(cursor)
}

export function mentionTarget(event: Event): string | null {
  const anchor = event.target instanceof Element ? event.target.closest(`a[href^="${MENTION_ORIGIN}"]`) : null
  const href = anchor?.getAttribute('href')
  return href === undefined || href === null ? null : href.slice(MENTION_ORIGIN.length)
}

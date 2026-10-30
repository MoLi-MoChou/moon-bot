// The composer's "@" mentions, drawn as chips. The text stays plain ("@Name ") for the
// store, the engine and the copy/paste codec; only the input paints a known name as a
// pill. A mirror layer under a transparent textarea does the painting, so the caret,
// the selection and the IME keep working on the real textarea.
import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { mentionSpans } from 'moon-bot-contracts'

/** A Bot the composer may mention: its name and the CSS ink its chip wears. */
export interface ChipBot {
  readonly id: string
  readonly name: string
  readonly ink?: string | undefined
}

/** A run of text that reads as a mention, by the rule the group host reads. */
export interface MentionChip {
  readonly start: number
  readonly end: number
  readonly kind: 'bot' | 'everyone'
  readonly name: string
  readonly ink?: string | undefined
}

export type ChipSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'chip'; readonly chip: MentionChip }

export interface ChipDeletion {
  readonly text: string
  readonly caret: number
}

// The mentions a text holds. `everyone` is only a mention in a group chat, where calling
// it calls the whole group; in a Bot's own chat it stays plain text, as the host reads it.
export function mentionChips(
  text: string,
  bots: readonly ChipBot[],
  { everyone = false }: { readonly everyone?: boolean } = {},
): MentionChip[] {
  if (!text.includes('@')) return []
  const byId = new Map(bots.map(bot => [bot.id, bot]))
  const chips: MentionChip[] = []
  for (const span of mentionSpans(text, bots)) {
    const name = text.slice(span.start + 1, span.end)
    if ('bot' in span) {
      const ink = byId.get(span.bot.id)?.ink
      chips.push(ink === undefined
        ? { start: span.start, end: span.end, kind: 'bot', name }
        : { start: span.start, end: span.end, kind: 'bot', name, ink })
    } else if (everyone) {
      chips.push({ start: span.start, end: span.end, kind: 'everyone', name })
    }
  }
  return chips
}

// Text and chips in order, so a render can keep the plain runs untouched.
export function chipSegments(text: string, chips: readonly MentionChip[]): ChipSegment[] {
  const segments: ChipSegment[] = []
  let cursor = 0
  for (const chip of chips) {
    if (chip.start < cursor || chip.end > text.length) continue
    if (chip.start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, chip.start) })
    segments.push({ kind: 'chip', chip })
    cursor = chip.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}

const remove = (text: string, start: number, end: number): string => text.slice(0, start) + text.slice(end)

// A Backspace at the end of, or inside, a chip removes the whole chip, and the single
// space the menu put after it, so one key press leaves the sentence clean. Any other
// caret position keeps the textarea's own Backspace.
export function deleteMentionBefore(text: string, caret: number, chips: readonly MentionChip[]): ChipDeletion | null {
  for (const chip of chips) {
    if (caret <= chip.start) break
    if (caret <= chip.end) return { text: remove(text, chip.start, chip.end), caret: chip.start }
    if (caret === chip.end + 1 && text[chip.end] === ' ') return { text: remove(text, chip.start, chip.end + 1), caret: chip.start }
  }
  return null
}

const inkOf = (chip: MentionChip): CSSProperties | undefined =>
  chip.ink === undefined ? undefined : { '--bt-mention-ink': chip.ink }

// The mirror: the same text, with each mention as a chip. It is aria-hidden and inert —
// the textarea above it holds the value, the caret and the selection.
export function MentionMirror({ field, text, chips, composing = false }: {
  readonly field: RefObject<HTMLTextAreaElement | null>
  readonly text: string
  readonly chips: readonly MentionChip[]
  readonly composing?: boolean | undefined
}): ReactElement {
  const mirror = useRef<HTMLDivElement | null>(null)
  const sync = (): void => {
    const input = field.current
    const layer = mirror.current
    if (input === null || layer === null) return
    layer.style.width = `${String(input.clientWidth)}px`
    layer.style.height = `${String(input.clientHeight)}px`
    layer.scrollTop = input.scrollTop
  }
  useLayoutEffect(sync, [text, composing])
  useEffect(() => {
    const input = field.current
    if (input === null) return undefined
    // The window's scrollbar appears with the first scrolled line, narrowing the
    // textarea; the mirror must narrow with it or the glyphs drift apart.
    const observer = new ResizeObserver(sync)
    observer.observe(input)
    input.addEventListener('scroll', sync)
    sync()
    return () => { observer.disconnect(); input.removeEventListener('scroll', sync) }
  }, [field])
  return <div ref={mirror} className='bt-mention-mirror' {...(composing ? { 'data-composing': 'true' } : {})} aria-hidden='true'>{chipSegments(text, chips).map((segment, index) => (segment.kind === 'chip'
      ? <span key={index} className='bt-mention-chip' data-kind={segment.chip.kind} style={inkOf(segment.chip)}>{`@${segment.chip.name}`}</span>
      : h(Fragment, { key: index }, segment.text)))}{/* A textarea keeps the line box after a trailing newline; the mirror needs a grapheme to paint that last empty line. */}{text.endsWith('\n') ? '\u200b' : null}</div>
}

// The layers' styles. Colors come from the theme tokens and each Bot's ink, radii from
// the design steps, so the chip follows light and dark themes and every Bot's character.
// Only the window's composer draws these classes today; the plugin host mounts the sheet
// too, so the two sheet lists stay one list (app/test/ui-sheets.test.mjs).
export const MENTION_CHIPS_CSS = [
  '[data-composer-input].bt-mention-input{position:relative;z-index:1;color:transparent;caret-color:var(--bt-ink)}',
  '[data-composer-input].bt-mention-input[data-composing=true]{color:var(--bt-ink)}',
  // The selection sits over the mirror, so it is drawn as a veil, not as opaque text.
  '[data-composer-input].bt-mention-input::selection{background:color-mix(in srgb,var(--bt-accent) 24%,transparent)}',
  '.bt-mention-field{position:relative;display:flex;flex:1 1 auto;min-width:0;align-self:flex-end}',
  '.bt-mention-mirror{position:absolute;top:0;left:0;z-index:0;overflow:hidden;pointer-events:none;user-select:none;color:var(--bt-ink);font:inherit;font-size:14px;line-height:24px;padding:6px 0 2px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word}',
  '.bt-mention-mirror[data-composing=true]{visibility:hidden}',
  // A chip adds no padding or margin: an inline box that takes extra room would move the
  // glyphs away from the textarea's own line breaks. The pill is background and halo only.
  '.bt-mention-chip{--bt-mention-ink:var(--bt-accent);color:inherit;background:color-mix(in srgb,var(--bt-mention-ink) 22%,transparent);border-radius:999px;box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-mention-ink) 22%,transparent);box-decoration-break:clone;-webkit-box-decoration-break:clone}',
  // A group-wide call is the one solid pill: every Bot keeps its own tinted color.
  '.bt-mention-chip[data-kind=everyone]{--bt-mention-ink:var(--bt-accent);background:var(--bt-accent);color:var(--bt-accent-ink,var(--bt-main));box-shadow:0 0 0 2px var(--bt-accent)}',
].join('\n')

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The module is pure (shared/mentions.ts and react only), so a bundle runs it without a
// DOM. The component's hooks are called directly, so they only need inert stubs.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/mention-chips.tsx', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  external: ['react'],
})
const module = {
  exports: {} as {
    mentionChips: (
      text: string,
      bots: readonly { id: string; name: string; ink?: string }[],
      options?: { everyone?: boolean },
    ) => { start: number; end: number; kind: string; name: string; ink?: string }[]
    chipSegments: (
      text: string,
      chips: readonly unknown[],
    ) => ({ kind: 'text'; text: string } | { kind: 'chip'; chip: { name: string } })[]
    deleteMentionBefore: (
      text: string,
      caret: number,
      chips: readonly unknown[],
    ) => { text: string; caret: number } | null
    MentionMirror: (props: {
      field: { current: null }
      text: string
      chips: readonly unknown[]
      composing?: boolean
    }) => { type: unknown; props: Record<string, unknown>; children: unknown[] }
    MENTION_CHIPS_CSS: string
  },
}
runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: (name: string) => {
    if (name !== 'react') throw new Error(`no platform module ${name}`)
    return {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
        type,
        props: props ?? {},
        children: children.flat(Infinity),
      }),
      Fragment: Symbol.for('react.fragment'),
      useRef: (initial: unknown) => ({ current: initial ?? null }),
      useLayoutEffect: () => {},
      useEffect: () => {},
    }
  },
})
const { mentionChips, chipSegments, deleteMentionBefore, MentionMirror, MENTION_CHIPS_CSS } = module.exports

const bots = [
  { id: 'chief', name: 'Chief', ink: 'var(--bt-ink-lilac)' },
  { id: 'poet', name: 'Poet', ink: 'var(--bt-ink-rose)' },
  { id: 'newbot', name: 'New Bot', ink: 'var(--bt-ink-sky)' },
]
const chipsOf = (text: string, options?: { everyone?: boolean }) => mentionChips(text, bots, options)
// The results come out of another VM realm, so they are compared as JSON, not prototypes.
const shown = (value: unknown): string => JSON.stringify(value)
const cutAt = (text: string, caret: number): string => shown(deleteMentionBefore(text, caret, chipsOf(text)))

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  return ((node as { children?: unknown[] }).children ?? []).map(textOf).join('')
}
function spansOf(tree: unknown): { kind: unknown; text: string; props: Record<string, unknown> }[] {
  if (tree === null || typeof tree !== 'object') return []
  const node = tree as { type: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const here =
    node.props?.className === 'bt-mention-chip'
      ? [{ kind: node.props['data-kind'], text: textOf(node), props: node.props }]
      : []
  return [...here, ...(node.children ?? []).flatMap(spansOf)]
}

test('a known name after "@" is a chip, case-insensitively and with spaces in the name', () => {
  assert.equal(
    shown(chipsOf('ask @Chief now')),
    shown([{ start: 4, end: 10, kind: 'bot', name: 'Chief', ink: 'var(--bt-ink-lilac)' }]),
  )
  // The chip paints the text exactly as typed; only the match is case-insensitive.
  assert.equal(shown(chipsOf('@chief').map(chip => chip.name)), shown(['chief']))
  assert.equal(
    shown(chipsOf('ping @New Bot 2')),
    shown([{ start: 5, end: 13, kind: 'bot', name: 'New Bot', ink: 'var(--bt-ink-sky)' }]),
  )
  assert.equal(shown(chipsOf('hi @New')), shown([]))
})

test('an address, a longer word, code and links keep plain text', () => {
  assert.equal(shown(chipsOf('mail me@Chief')), shown([]))
  assert.equal(shown(chipsOf('@Chiefs are here')), shown([]))
  assert.equal(shown(chipsOf('type `@Chief` to call')), shown([]))
  assert.equal(shown(chipsOf('read [the docs](@Chief) first')), shown([]))
  assert.equal(shown(chipsOf('no mentions here')), shown([]))
})

test('"everyone" is a group call, and only in a group', () => {
  assert.equal(
    shown(chipsOf('@everyone', { everyone: true }).map(chip => [chip.kind, chip.name])),
    shown([['everyone', 'everyone']]),
  )
  assert.equal(shown(chipsOf('@所有人', { everyone: true }).map(chip => chip.kind)), shown(['everyone']))
  assert.equal(shown(chipsOf('@everyone')), shown([]))
})

test('segments split the text into plain runs and chips, and rejoin to the same text', () => {
  const text = 'Hello @Chief, ask @Poet and @New Bot: thanks'
  const chips = chipsOf(text)
  const segments = chipSegments(text, chips)
  assert.equal(
    segments.map(segment => (segment.kind === 'chip' ? `[@${segment.chip.name}]` : segment.text)).join(''),
    'Hello [@Chief], ask [@Poet] and [@New Bot]: thanks',
  )
  assert.equal(
    segments.some(segment => segment.kind === 'text' && segment.text === ': thanks'),
    true,
  )
  assert.equal(shown(chipSegments('', [])), shown([]))
  assert.equal(shown(chipSegments('plain', [])), shown([{ kind: 'text', text: 'plain' }]))
})

test('Backspace removes a whole chip and the space after it', () => {
  const text = 'hi @Chief '
  assert.equal(cutAt(text, text.length), shown({ text: 'hi ', caret: 3 }))
  assert.equal(cutAt(text, 9), shown({ text: 'hi  ', caret: 3 }))
  assert.equal(cutAt(text, 5), shown({ text: 'hi  ', caret: 3 }))
  assert.equal(cutAt(text, 3), shown(null))
  assert.equal(cutAt(text, 2), shown(null))
  assert.equal(cutAt('hi @Chief there', 15), shown(null))
})

test('Backspace at the end of two chips removes only the last one', () => {
  const text = 'a @Chief b @Poet '
  assert.equal(cutAt(text, text.length), shown({ text: 'a @Chief b ', caret: 11 }))
  const last = 'no trailing space @Poet'
  assert.equal(cutAt(last, last.length), shown({ text: 'no trailing space ', caret: 18 }))
})

test('the mirror paints every mention as a chip and keeps the plain text', () => {
  const text = 'Hi @Chief and @Poet'
  const tree = MentionMirror({ field: { current: null }, text, chips: chipsOf(text) })
  assert.equal(tree.props['aria-hidden'], 'true')
  assert.equal(tree.props.className, 'bt-mention-mirror')
  assert.equal(tree.props['data-composing'], undefined)
  assert.equal(
    shown(spansOf(tree).map(span => [span.kind, span.text])),
    shown([
      ['bot', '@Chief'],
      ['bot', '@Poet'],
    ]),
  )
  assert.notEqual(spansOf(tree)[0]?.props['style'], undefined)
  assert.equal(textOf(tree), 'Hi @Chief and @Poet')
  const group = MentionMirror({
    field: { current: null },
    text: '@everyone',
    chips: chipsOf('@everyone', { everyone: true }),
  })
  assert.equal(shown(spansOf(group).map(span => span.kind)), shown(['everyone']))
  // While an IME composes, the textarea owns the text and the mirror steps aside.
  const composing = MentionMirror({ field: { current: null }, text: 'hi', chips: [], composing: true })
  assert.equal(composing.props['data-composing'], 'true')
  // A textarea keeps a line box after a trailing newline; the mirror adds one grapheme.
  const trailing = MentionMirror({ field: { current: null }, text: 'hi\n', chips: [] })
  assert.equal(textOf(trailing), 'hi\n\u200b')
  assert.equal(textOf(MentionMirror({ field: { current: null }, text: 'hi', chips: [] })), 'hi')
})

test('the chip styles use theme tokens and no literal color or radius', () => {
  assert.equal(MENTION_CHIPS_CSS.includes('.bt-mention-chip'), true)
  assert.equal(MENTION_CHIPS_CSS.includes('[data-kind=everyone]'), true)
  assert.match(MENTION_CHIPS_CSS, /border-radius:\d+px/)
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(MENTION_CHIPS_CSS), false, 'colors come from --bt-* tokens')
  assert.equal(/\brgba?\(/i.test(MENTION_CHIPS_CSS), false, 'colors come from --bt-* tokens')
  // Padding or margin on an inline chip would move the glyphs off the textarea's own
  // line breaks; the pill is drawn with background and halo only.
  assert.equal(/\.bt-mention-chip\{[^}]*\b(?:padding|margin)\s*:/i.test(MENTION_CHIPS_CSS), false)
})

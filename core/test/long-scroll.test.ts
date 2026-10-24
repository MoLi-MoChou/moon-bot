import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: `export { OFF_BOTTOM_PX, isOffBottom, scrollToBottom, followBottom } from './header.tsx'\nexport { stackChatItems } from './cells.ts'`,
    resolveDir: fileURLToPath(new URL('../src/client', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const mod = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, Object, Array, Number, URL, URLSearchParams, setTimeout, clearTimeout,
  require: (name) => {
    const platform = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initial => [initial, () => {}],
        useEffect: () => {},
        useRef: current => ({ current }),
        useLayoutEffect: () => {},
        useMemo: make => make(),
        useCallback: fn => fn,
        Fragment: 'fragment',
      },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { OFF_BOTTOM_PX, isOffBottom, scrollToBottom, followBottom, stackChatItems } = mod.exports

test('isOffBottom detects when the conversation scroll container leaves the bottom threshold', () => {
  assert.equal(OFF_BOTTOM_PX, 120)
  assert.equal(isOffBottom(null), false)
  // Pinned at bottom
  assert.equal(isOffBottom({ scrollHeight: 12000, scrollTop: 11200, clientHeight: 800 }), false)
  // Slightly above bottom within threshold (80px)
  assert.equal(isOffBottom({ scrollHeight: 12000, scrollTop: 11120, clientHeight: 800 }), false)
  // Scrolled up past threshold (240px > 120px)
  assert.equal(isOffBottom({ scrollHeight: 12000, scrollTop: 10960, clientHeight: 800 }), true)
})

test('scrollToBottom smoothly scrolls to the bottom and triggers host slot button if present', () => {
  let clicked = 0
  let scrolled = null
  const scroller = {
    scrollHeight: 18400,
    querySelector: sel => (sel.includes('_toBottomSlot') ? { click: () => { clicked += 1 } } : null),
    scrollTo: (opts) => { scrolled = opts },
  }
  scrollToBottom(scroller)
  assert.equal(clicked, 1)
  assert.equal(scrolled.top, 18400)
  assert.equal(scrolled.behavior, 'smooth')
})

test('followBottom keeps the view pinned at bottom only when already at bottom', () => {
  let scrolled = null
  const scroller = {
    scrollHeight: 15000,
    scrollTop: 14000,
    clientHeight: 800,
    scrollTo: (opts) => { scrolled = opts },
  }
  // When user is scrolled up (wasPinned = false), new messages must not yank scroll position
  assert.equal(followBottom(scroller, false), false)
  assert.equal(scrolled, null)

  // When user is at bottom (wasPinned = true), new messages keep scroll pinned to bottom
  assert.equal(followBottom(scroller, true), true)
  assert.equal(scrolled.top, 15000)
  assert.equal(scrolled.behavior, 'auto')
})

test('stackChatItems handles 500+ messages smoothly and merges consecutive bot replies', () => {
  const messages = []
  for (let i = 0; i < 500; i += 1) {
    messages.push({
      kind: i % 3 === 0 ? 'user' : 'bot',
      text: `Message #${i}`,
      time: 1700000000000 + i * 1000,
    })
  }
  const t0 = performance.now()
  const rows = stackChatItems(messages)
  const elapsed = performance.now() - t0
  assert.ok(elapsed < 50, `expected <50ms for 500 messages, got ${elapsed.toFixed(2)}ms`)
  // Every 3 items: 1 user + 2 consecutive bot items merged into 1 bot stack -> 2 rows per 3 items
  assert.equal(rows.length, 334)
  assert.equal(rows[1].kind, 'bot')
  assert.equal(rows[1].texts.length, 2)
})

test('the design sheets define offscreen content-visibility virtualization and back-to-bottom button styles', () => {
  const dir = new URL('../src/client/design/', import.meta.url)
  const styles = readdirSync(dir)
    .filter(name => name.endsWith('.ts'))
    .map(name => readFileSync(new URL(name, dir), 'utf8'))
    .join('\n')
  assert.ok(styles.includes('.bt-to-bottom{'))
  assert.ok(styles.includes('.bt-to-bottom-btn{'))
  assert.ok(styles.includes('content-visibility:auto;contain-intrinsic-size:auto 120px'))
})

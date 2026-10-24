import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { findStyles } from '../scripts/style-debt.mjs'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/motion.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react'],
})

function loadMotion(prefersReduced = false) {
  const mod = { exports: {} }
  const timeouts = []
  runInNewContext(bundle.outputFiles[0].text, {
    module: mod,
    exports: mod.exports,
    Object,
    Array,
    Map,
    Math,
    window: {
      matchMedia: query => ({
        matches: prefersReduced && query.includes('prefers-reduced-motion'),
      }),
    },
    setTimeout: (fn, ms) => {
      timeouts.push(ms)
      return timeouts.length
    },
    clearTimeout: () => {},
    require: (name) => {
      if (name !== 'react') throw new Error(`unexpected module ${name}`)
      return {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        useEffect: fn => fn(),
        useLayoutEffect: () => {},
        useRef: current => ({ current }),
        useState: initial => [initial, () => {}],
      }
    },
  })
  return { ...mod.exports, timeouts }
}

test('motion.ts is the single source of truth for springs, durations, and presets', () => {
  const m = loadMotion(false)
  assert.equal(m.MENU_EXIT_MS, 120)
  assert.equal(m.DIALOG_EXIT_MS, 160)
  assert.equal(m.SHEET_EXIT_MS, 220)
  assert.equal(m.PANEL_LINGER_MS, 300)
  assert.ok(m.SPRING_SHAPE.duration > 0 && m.SPRING_SHAPE.easing.startsWith('linear('))
  assert.ok(m.SPRING_TAP.duration > 0 && m.SPRING_TAP.easing.startsWith('linear('))
  assert.ok(m.SPRING_ROW_GLIDE.duration > 0 && m.SPRING_ROW_GLIDE.easing.startsWith('linear('))
  assert.ok(m.PANEL_TAB_EDGES.lead.duration > 0 && m.PANEL_TAB_EDGES.trail.duration > 0)
  assert.equal(m.MOTION_PRESETS.sidebar.rowGlide, m.SPRING_ROW_GLIDE)
  assert.equal(m.MOTION_PRESETS.overlay.exitMs, m.DIALOG_EXIT_MS)
  assert.equal(m.MOTION_PRESETS.menu.exitMs, m.MENU_EXIT_MS)
  assert.equal(m.MOTION_PRESETS.panel.lingerMs, m.PANEL_LINGER_MS)
  assert.equal(m.MOTION_PRESETS.message.enter, m.SPRING_SHAPE)

  const found = findStyles()
  assert.deepEqual(found.springs, {}, 'no inline springEasing or linear() outside motion.ts')
})

test('reducedMotion and useLinger respect prefers-reduced-motion', () => {
  const normal = loadMotion(false)
  assert.equal(normal.reducedMotion(), false)
  normal.useLinger(null, normal.DIALOG_EXIT_MS)
  assert.deepEqual(normal.timeouts, [160])

  const reduced = loadMotion(true)
  assert.equal(reduced.reducedMotion(), true)
  reduced.useLinger(null, reduced.DIALOG_EXIT_MS)
  assert.deepEqual(reduced.timeouts, [0])
})

test('client stylesheets guard sidebar, overlays, panels, and message entry with prefers-reduced-motion', () => {
  for (const file of ['design/marks.ts', 'design/overlays.ts', 'design/panels.ts', 'design/conversation.ts', 'design/composer.ts', 'sidebar-css.ts', 'browser-pane-css.ts', 'work-process.tsx']) {
    const text = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
    assert.ok(text.includes('@media (prefers-reduced-motion:reduce)'), `${file} should include prefers-reduced-motion guard`)
  }
})

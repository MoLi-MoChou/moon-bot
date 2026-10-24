import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { FILES_PANEL_CSS } from '../src/client/files-panel.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function loadOverlayHooks() {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT, 'src/client/overlay-hooks.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    external: ['react'],
  })
  const listeners = new Map()
  const effects = []
  let activeElement = null
  const windowStub = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchKey(key, extra = {}) {
      let defaultPrevented = Boolean(extra.defaultPrevented)
      let stopped = false
      const event = {
        key,
        isComposing: Boolean(extra.isComposing),
        get defaultPrevented() { return defaultPrevented },
        preventDefault() { defaultPrevented = true },
        stopPropagation() { stopped = true },
      }
      for (const fn of Array.from(listeners.get('keydown') ?? [])) {
        fn(event)
      }
      return { defaultPrevented, stopped }
    },
  }
  const reactStub = {
    useRef: value => ({ current: value }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useLayoutEffect: () => {},
    useEffect: (fn, deps) => { effects.push({ fn, deps, cleanup: null }) },
  }
  const mod = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === 'react') return reactStub
      throw new Error(`unexpected require: ${id}`)
    },
    window: windowStub,
    document: {
      get activeElement() { return activeElement },
      set activeElement(el) { activeElement = el },
    },
    requestAnimationFrame: fn => { fn(); return 1 },
    cancelAnimationFrame: () => {},
    HTMLElement: class HTMLElement {},
  })
  return {
    ...mod.exports,
    windowStub,
    effects,
    setActive(el) { activeElement = el },
    getActive() { return activeElement },
  }
}

describe('Keyboard navigation, Escape stack, and focus-visible rings', () => {
  it('closes only the topmost enabled Escape layer and ignores IME composition', async () => {
    const { useEscape, windowStub, effects } = await loadOverlayHooks()
    const calls = []
    useEscape(() => calls.push('drawer'), true)
    useEscape(() => calls.push('disabled-subview'), false)
    useEscape(() => calls.push('top-dialog'), true)

    for (const effect of effects) effect.cleanup = effect.fn()

    // Composing Escape (IME) must not close any layer
    windowStub.dispatchKey('Escape', { isComposing: true })
    assert.deepEqual(calls, [])

    // First Escape closes only top-dialog
    const first = windowStub.dispatchKey('Escape')
    assert.deepEqual(calls, ['top-dialog'])
    assert.equal(first.defaultPrevented, true)
    assert.equal(first.stopped, true)

    // Unmount top-dialog, next Escape closes drawer
    effects[2].cleanup?.()
    windowStub.dispatchKey('Escape')
    assert.deepEqual(calls, ['top-dialog', 'drawer'])

    effects[0].cleanup?.()
  })

  it('cycles focus across enabled menu items with ArrowDown, ArrowUp, Home, and End', async () => {
    const { stepMenuFocus, setActive, getActive } = await loadOverlayHooks()
    const makeItem = (label) => {
      const item = {
        label,
        focus() { setActive(item) },
      }
      return item
    }
    const a = makeItem('model-a')
    const b = makeItem('model-b')
    const c = makeItem('model-c')
    const menu = {
      querySelectorAll(selector) {
        assert.match(selector, /menuitem/)
        return [a, b, c]
      },
    }

    assert.equal(stepMenuFocus(menu, 'ArrowDown'), true)
    assert.equal(getActive(), a)

    assert.equal(stepMenuFocus(menu, 'ArrowDown'), true)
    assert.equal(getActive(), b)

    assert.equal(stepMenuFocus(menu, 'End'), true)
    assert.equal(getActive(), c)

    // Wraps from last to first
    assert.equal(stepMenuFocus(menu, 'ArrowDown'), true)
    assert.equal(getActive(), a)

    // Wraps from first to last on ArrowUp
    assert.equal(stepMenuFocus(menu, 'ArrowUp'), true)
    assert.equal(getActive(), c)

    assert.equal(stepMenuFocus(menu, 'Home'), true)
    assert.equal(getActive(), a)
  })


  it('folds + menu, memory ⋯ menu, and anchored menus into the useEscape stack (no capture Esc)', () => {
    const composer = readFileSync(join(ROOT, 'src/client/composer.tsx'), 'utf8')
    const memory = readFileSync(join(ROOT, 'src/client/memory-panel.tsx'), 'utf8')
    const model = readFileSync(join(ROOT, 'src/client/model-menu.tsx'), 'utf8')
    assert.match(composer, /useEscape\(\(\) => \{ setOpen\(null\)/)
    assert.doesNotMatch(composer, /addEventListener\('keydown', onKey, true\)/)
    assert.match(memory, /useEscape\(\(\) => \{ setMenu\(false\)/)
    assert.doesNotMatch(memory, /addEventListener\('keydown', onKey, true\)/)
    assert.match(model, /useEscape\(\(\) => \{[\s\S]*escapeRef\.current/)
    assert.doesNotMatch(model, /addEventListener\('keydown', onKey, true\)/)
    assert.doesNotMatch(memory, /const MENU_EXIT_MS = /)
    assert.match(memory, /MENU_EXIT_MS.*from '\.\/motion\.tsx'/)
    assert.match(composer, /MENU_EXIT_MS.*from '\.\/motion\.tsx'/)
  })

  it('defines visible :focus-visible rings across primary controls, menus, cards, and file preview', () => {
    const designDir = join(ROOT, 'src/client/design')
    const stylesSrc = readdirSync(designDir)
      .filter(name => name.endsWith('.ts'))
      .map(name => readFileSync(join(designDir, name), 'utf8'))
      .join('\n')
    for (const cls of [
      '.bt-round',
      '.bt-icon-btn',
      '.bt-soft',
      '.bt-send',
      '.bt-pill',
      '.bt-row',
      '.bt-settings-item',
      '.bt-settings-close',
      '.bt-q-submit',
      '.bt-q-btn',
      '.bt-menu button',
      '.bt-seg button',
      '.bt-input',
    ]) {
      assert.ok(stylesSrc.includes(cls), `expected the design sheets to style ${cls}`)
    }
    assert.match(stylesSrc, /:focus-visible\{outline:2px solid var\(--bt-accent\)/)
    assert.match(FILES_PANEL_CSS, /\.bt-fcard-download.*:focus-visible/)
    const browserSrc = readFileSync(join(ROOT, 'src/client/browser-pane-css.ts'), 'utf8')
    const processSrc = readFileSync(join(ROOT, 'src/client/work-process.tsx'), 'utf8')
    const memberSrc = readFileSync(join(ROOT, 'src/client/member-status.tsx'), 'utf8')
    assert.match(browserSrc, /\.bt-ptab.*:focus-visible/)
    assert.match(processSrc, /\.bt-process-close.*:focus-visible/)
    assert.match(memberSrc, /\.bt-mw-pill.*:focus-visible/)
  })
})

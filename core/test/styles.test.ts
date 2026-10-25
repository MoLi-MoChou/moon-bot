import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// A document to install styles into; the client's own helpers run inside it.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = await import('jsdom')

// The style helpers and the CSS they ship, bundled once with a minimal React for
// motion.ts; they run in each test's jsdom document through the vm context.
const { outputFiles } = await build({
  stdin: {
    contents: "export { installStyles, installCompiledStyles } from './src/client/design/index.ts'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}

const tick = () => new Promise(resolve => setImmediate(resolve))
// DS Bot's style tags in a document, all of them or those of one group.
const tagged = (document, tag?) => [...document.head.querySelectorAll('style')]
  .filter(style => style.dataset.dshBot !== undefined && (tag === undefined || style.dataset.dshBot === tag))

// A fresh jsdom document with the bundled style helpers bound to it.
const bench = () => {
  const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const module = { exports: {} as { installStyles: (css: string, tag: string) => { dataset: Record<string, string>, isConnected: boolean }, installCompiledStyles: (css: string, tag: string) => () => void } }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports,
    document: window.document,
    MutationObserver: window.MutationObserver,
    HTMLLinkElement: window.HTMLLinkElement,
    setTimeout, clearTimeout,
    require: name => (name === 'react' ? react : {}),
  })
  return { window, module }
}

// Every style tag this client installs names its owner, so nothing else in the page
// can take it for its own, and a tag this client did not install is left alone.
test('every style this client installs names the ds-bot owner', () => {
  const { window, module } = bench()
  const { installStyles, installCompiledStyles } = module.exports
  const { document } = window
  const stray = document.createElement('style')
  stray.textContent = 'stray{}'
  document.head.appendChild(stray)

  const plain = installStyles('a{color:red}', 'mentions')
  installCompiledStyles('.b{position:fixed}', 'shell')
  for (const style of tagged(document)) {
    assert.equal(style.dataset.plugin, 'ds-bot')
    assert.equal(style.matches('style:not([data-plugin])'), false)
  }
  assert.equal(plain.dataset.dshBot, 'mentions')
  assert.equal(stray.dataset.plugin, undefined, 'a foreign tag keeps no owner of ours')
})

test('a compiled style removed from outside comes back, until its cleanup runs', async () => {
  const { window, module } = bench()
  const { installCompiledStyles } = module.exports
  const { document } = window
  const dispose = installCompiledStyles('.b{position:fixed}', 'shell')
  const [style] = tagged(document, 'shell')
  assert.ok(style.isConnected)

  style.remove()
  await tick()
  assert.equal(style.isConnected, true, 'the observer puts a removed node back')

  dispose()
  await tick()
  assert.equal(style.isConnected, false)
  // Later page changes cannot resurrect it.
  const late = document.createElement('style')
  document.head.appendChild(late)
  await tick()
  assert.equal(style.isConnected, false)
})

test('mounting and unmounting compiled styles twice leaves no extra nodes', async () => {
  const { window, module } = bench()
  const { installCompiledStyles } = module.exports
  const { document } = window
  for (let round = 0; round < 2; round += 1) {
    const dispose = installCompiledStyles('.b{position:fixed}', 'shell')
    await tick()
    dispose()
  }
  await tick()
  assert.equal(tagged(document).length, 0)
})

test('the chat-room rule is installed through installStyles, so it is owned too', () => {
  const pane = readFileSync(new URL('../src/client/browser-pane-chrome.tsx', import.meta.url), 'utf8')
  assert.match(pane, /installStyles\(.*'chat-room'/)
  assert.equal(pane.includes("dataset.dshBot = 'chat-room'"), false)
})

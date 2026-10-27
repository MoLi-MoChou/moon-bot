// The task panel (2026-10-28 tasks-panel): the clocks and the "what is it doing" line are
// the page's own arithmetic, so they are tested without a browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/tasks-page.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom'],
})
const module = { exports: {} as {
  elapsed: (ms: number) => string
  doingText: (task: Record<string, unknown>, translate?: (key: string, params?: Record<string, unknown>) => string) => string
} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    const platform = {
      react: {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        Fragment: 'fragment',
        useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
        useEffect: () => {},
      },
      'react-dom': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name] as unknown
  },
})
const { elapsed, doingText } = module.exports

test('the clocks read as minutes and seconds, then hours', () => {
  assert.equal(elapsed(0), '0:00')
  assert.equal(elapsed(1_000), '0:01')
  assert.equal(elapsed(61_000), '1:01')
  assert.equal(elapsed(59 * 60_000 + 59_000), '59:59')
  assert.equal(elapsed(3_600_000), '1:00:00')
  assert.equal(elapsed(3_723_000), '1:02:03')
  assert.equal(elapsed(-5), '0:00')
})

test('a row says what the Bot is doing, in the order the host reports it', () => {
  const identity = (key: string, params?: Record<string, unknown>) => params === undefined ? key : `${key} ${JSON.stringify(params)}`
  assert.equal(doingText({ switching: true }, identity), 'Switching to a new session')
  assert.equal(doingText({ tool: 'read_file', target: 'plan.md' }, identity), 'Running {tool} on {target} {"tool":"read_file","target":"plan.md"}')
  assert.equal(doingText({ tool: 'web_search' }, identity), 'Running {tool} {"tool":"web_search"}')
  assert.equal(doingText({ said: 'Looking at the logs' }, identity), 'Looking at the logs')
  assert.equal(doingText({}, identity), 'Working')
})

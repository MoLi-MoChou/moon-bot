// A room row draws with nobody working (2026-10-28 follow-up): the sidebar used to read
// the first working member unconditionally, so any group whose members were all idle
// crashed the window. `roomLead` is the guard, and this pins it down.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: { contents: "export { roomLead } from './src/client/sidebar-rows.tsx'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const module = { exports: {} as {
  roomLead: (members: readonly Record<string, unknown>[], roster: { byId: Record<string, { name: string }> }) => { line: unknown, first?: { name: string } }
} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    if (name === 'react') {
      return {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
        Fragment: 'fragment', useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({ current: null }), useMemo: (make: () => unknown) => make(), useId: () => 'id',
      }
    }
    return {}
  },
})

const { roomLead } = module.exports
const roster = { byId: { a: { name: 'Ada' }, b: { name: 'Bo' } } }

test('an idle room has no lead and no working line', () => {
  const result = roomLead([], roster)
  assert.equal(result.line, null)
  assert.equal(result.first, undefined)
})

test('a working member leads the line, and the rest are counted', () => {
  const one = roomLead([{ id: 'a', tool: 'read_file' }], roster)
  assert.equal(one.first?.name, 'Ada')
  assert.notEqual(one.line, null)
  const two = roomLead([{ id: 'a', tool: 'read_file' }, { id: 'b', tool: 'web_search' }], roster)
  assert.equal(two.first?.name, 'Ada')
  assert.match(JSON.stringify(two.line), /\+1/)
})

test('a member the roster does not know still does not crash the row', () => {
  const result = roomLead([{ id: 'ghost', tool: 'read_file' }], roster)
  assert.equal(result.line, null)
})

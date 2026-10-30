import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { bundleClient } from '../scripts/build-client.ts'

// client.js is built, not committed; the root postinstall makes it on install.
const built = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const builtOnce = existsSync(new URL('../client.js', import.meta.url))

test('client.js is the build of src/client', {
  skip: builtOnce ? false : 'run npm run build (or npm ci) to make client.js',
}, async () => {
  assert.equal(await bundleClient(), built(), 'client.js is stale: run `npm run build`')
})

// dsh runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers only the shell's platform modules.
test('client.js registers a factory that exports apply and inject', () => {
  const registrations = []
  runInNewContext(built(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory, ...rest }] = registrations
  assert.equal(id, 'moon-bot-core')
  assert.deepEqual(Object.keys(rest), [])

  const requested = []
  const platform = {
    react: {
      createElement: () => null,
      Fragment: Symbol('Fragment'),
      useState: initial => [initial, () => {}],
      useEffect: () => {},
      useMemo: make => make(),
      useRef: current => ({ current }),
    },
    'react-dom': { createPortal: node => node },
  }
  const exports = factory(specifier => {
    requested.push(specifier)
    if (!(specifier in platform)) throw new Error(`no platform module ${specifier}`)
    return platform[specifier]
  })
  assert.deepEqual([...new Set(requested)].sort(), Object.keys(platform).sort())
  // A .tsx source must compile to h() calls: the shell has no react/jsx-runtime, and a
  // bundle that requires one fails to resolve in the browser (the client never registers).
  assert.ok(!requested.some(specifier => specifier.startsWith('react/jsx')), 'client.js must not require a jsx runtime')
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  assert.deepEqual(Object.keys(exports), ['apply', 'inject'])
  assert.equal(typeof exports.apply, 'function')
  // No `configForms`: the client never writes the user's DSH settings, such as the
  // work-details mode it once held at `verbose`.
  assert.deepEqual(Array.from(exports.inject), [
    'sessions',
    'uiWorkspace',
    'uiConversation',
    'slots',
    'theme',
    'layout',
  ])
})

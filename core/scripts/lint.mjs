// Lint with the oxlint in this package's devDependencies.
//
// Then run the gates oxlint cannot express — layer boundaries, the 350-line limit for a
// migrated logic file, floating promises, `.tsx` imports in tests, and built-in tags
// written as `h('tag')` in the client — from `check-gates.mjs`. `npm run lint` is therefore one command for both, and the fixtures
// under test/fixtures/gates exercise the same script.
//
// Usage: npm run lint [-- <oxlint options>]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const plugin = resolve(import.meta.dirname, '..')
// Node runs oxlint's own script: on Windows it cannot spawn the .cmd shim in node_modules/.bin
// without a shell.
const bin = join(plugin, 'node_modules', 'oxlint', 'bin', 'oxlint')
if (!existsSync(bin)) {
  console.error('lint: oxlint is missing - run npm ci in core')
  process.exit(2)
}
const result = spawnSync(process.execPath, [bin, '-c', '.oxlintrc.json', ...process.argv.slice(2), 'index.js', 'web-search.js', 'src', 'dev', 'scripts', 'test'], { cwd: plugin, stdio: 'inherit' })
if (result.error) console.error(`lint: ${result.error.message}`)

const gates = spawnSync(process.execPath, [join(plugin, 'scripts', 'check-gates.mjs')], { cwd: plugin, stdio: 'inherit' })
if (gates.error) console.error(`lint: ${gates.error.message}`)
const jsx = spawnSync(process.execPath, [join(plugin, 'scripts', 'jsx-debt.mjs')], { cwd: plugin, stdio: 'inherit' })
if (jsx.error) console.error(`lint: ${jsx.error.message}`)

const oxlintStatus = result.status ?? 1
const gatesStatus = gates.status ?? 1
const jsxStatus = jsx.status ?? 1
process.exit(oxlintStatus !== 0 ? oxlintStatus : gatesStatus !== 0 ? gatesStatus : jsxStatus)

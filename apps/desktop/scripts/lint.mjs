// Lint this package with its own oxlint (devDependency). Root `pnpm run lint` runs every
// workspace that defines a lint script via `pnpm -r --if-present`.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const plugin = resolve(import.meta.dirname, '..')
const bin = join(plugin, 'node_modules', 'oxlint', 'bin', 'oxlint')
if (!existsSync(bin)) {
  console.error('lint: oxlint is missing — run pnpm install at the repo root')
  process.exit(2)
}
const extra = process.argv.slice(2)
const result = spawnSync(
  process.execPath,
  [bin, '-c', '.oxlintrc.json', ...extra, 'src', 'ui/src', 'scripts', 'test'],
  { cwd: plugin, stdio: 'inherit' },
)
if (result.error) console.error(`lint: ${result.error.message}`)
process.exit(result.status ?? 1)

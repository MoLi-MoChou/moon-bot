// Builds core's generated artifacts (core/client.js and core/dist/) right after install,
// so a fresh clone can run the tests and the app without a manual step. Skipped when the
// build cannot run: a production-only install has no esbuild, and an image stage that
// copies only the manifests (before its own explicit build) has no core/scripts.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const esbuild = [join(root, 'node_modules', 'esbuild'), join(root, 'core', 'node_modules', 'esbuild')]
  .find(path => existsSync(join(path, 'bin', 'esbuild')))
if (esbuild === undefined) process.exit(0)
if (!existsSync(join(root, 'core', 'scripts', 'build-host.mjs'))) process.exit(0)

for (const [script, args] of [['scripts/build-host.mjs', []], ['scripts/build-client.ts', []]]) {
  const result = spawnSync(process.execPath, [join(root, 'core', script), ...args], {
    stdio: 'inherit',
    cwd: join(root, 'core'),
  })
  if (result.error !== undefined) {
    console.error(`postinstall: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

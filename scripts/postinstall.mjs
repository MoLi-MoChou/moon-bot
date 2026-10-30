// Builds contracts + ui dist/, then core's generated artifacts (packages/core/client.js and
// packages/core/dist/) right after install, so a fresh clone can run the tests and the app
// without a manual step. Skipped when the build cannot run: a production-only install has no
// esbuild, and an image stage that copies only the manifests (before its own explicit build)
// has no packages/core/scripts.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const core = join(root, 'packages', 'core')
const contracts = join(root, 'packages', 'contracts')
const ui = join(root, 'packages', 'ui')
const esbuild = [
  join(root, 'node_modules', 'esbuild'),
  join(core, 'node_modules', 'esbuild'),
  join(contracts, 'node_modules', 'esbuild'),
  join(ui, 'node_modules', 'esbuild'),
].find(path => existsSync(join(path, 'bin', 'esbuild')))
if (esbuild === undefined) process.exit(0)
if (!existsSync(join(core, 'scripts', 'build-host.mjs'))) process.exit(0)

const jobs = []
if (existsSync(join(contracts, 'scripts', 'build.mjs'))) {
  jobs.push({ cwd: contracts, script: 'scripts/build.mjs', args: [] })
}
if (existsSync(join(ui, 'scripts', 'build.mjs'))) {
  jobs.push({ cwd: ui, script: 'scripts/build.mjs', args: [] })
}
jobs.push(
  { cwd: core, script: 'scripts/build-host.mjs', args: [] },
  { cwd: core, script: 'scripts/build-client.ts', args: [] },
)
for (const job of jobs) {
  const result = spawnSync(process.execPath, [join(job.cwd, job.script), ...job.args], {
    stdio: 'inherit',
    cwd: job.cwd,
  })
  if (result.error !== undefined) {
    console.error(`postinstall: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

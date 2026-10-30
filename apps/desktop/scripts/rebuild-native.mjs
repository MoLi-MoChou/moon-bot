// Electron embeds a different Node ABI than the Node process used by pnpm install.
// Rebuild the native SQLite module before electron-builder copies it into the app.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'))
const electron = packageJson.devDependencies?.electron
const rebuildPackage = dirname(dirname(createRequire(import.meta.url).resolve('@electron/rebuild')))
const rebuild = join(rebuildPackage, 'lib', 'cli.js')
const core = resolve(app, '..', '..', 'packages', 'core')

if (typeof electron !== 'string') throw new Error('rebuild-native: electron version is missing')

const result = spawnSync(process.execPath, [
  rebuild,
  '--version', electron,
  '--module-dir', core,
  '--only', 'better-sqlite3',
  '--force',
], { cwd: app, stdio: 'inherit' })

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

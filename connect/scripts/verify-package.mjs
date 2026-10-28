// Check the artifact the publish would upload, not the checkout it came from: pack the
// tarball, install it into a throwaway prefix, and run the installed bin. A checkout
// hides the failure this catches — TypeScript sources work from the repository and do
// not work from node_modules, so the published files must be the bundle.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'moon-bot-connect-pack-'))
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })

try {
  run('npm', ['pack', '--pack-destination', work], { cwd: here })
  const tarball = readdirSync(work).find(name => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('npm pack produced no tarball')
  const prefix = join(work, 'prefix')
  run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel', 'error', join(work, tarball)])
  const bin = join(prefix, 'node_modules', 'moon-bot-connect', 'dist', 'main.js')
  const help = run(process.execPath, [bin, '--help'])
  if (!help.includes('moon-bot-connect: attach')) throw new Error('the installed bin does not print its usage')
  const doctor = run(process.execPath, [bin, 'doctor'], { env: { ...process.env, PATH: process.env.PATH ?? '' } })
  if (!doctor.includes('ok   node:')) throw new Error(`doctor did not report the node check:\n${doctor}`)
  const files = readdirSync(join(prefix, 'node_modules', 'moon-bot-connect'))
  if (!files.includes('dist') || files.includes('src')) throw new Error(`the package shipped the wrong files: ${files.join(', ')}`)
  console.log(`connect: the packed ${tarball} installs and runs (${files.join(', ')})`)
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
}

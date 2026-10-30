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

/** Runs and keeps the output either way: a non-zero step is reported, not thrown raw. */
const attempt = (command, args, options = {}) => {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
    return { status: 0, stdout: String(stdout ?? ''), stderr: '' }
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    }
  }
}

const must = (result, what) => {
  if (result.status !== 0) {
    throw new Error(`${what} failed (${result.status}):\n${result.stderr.slice(-1500)}${result.stdout.slice(-1500)}`)
  }
  return result.stdout
}

const work = mkdtempSync(join(tmpdir(), 'moon-bot-connect-pack-'))
try {
  must(attempt('npm', ['pack', '--pack-destination', work], { cwd: here }), 'npm pack')
  const tarball = readdirSync(work).find(name => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('npm pack produced no tarball')
  const prefix = join(work, 'prefix')
  must(attempt('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel', 'error', join(work, tarball)]), 'installing the tarball')

  const bin = join(prefix, 'node_modules', 'moon-bot-connect', 'dist', 'main.js')
  const help = must(attempt(process.execPath, [bin, '--help']), 'the installed bin --help')
  if (!help.includes('moon-bot-connect: attach')) throw new Error('the installed bin does not print its usage')

  // A machine with no agent CLI is the normal CI case: doctor reports the node check and
  // exits 1 on the missing agent, which is an answer rather than a packaging failure.
  // Assert the output, never the exit code.
  const doctor = attempt(process.execPath, [bin, 'doctor'])
  if (doctor.status > 1) throw new Error(`doctor crashed (${doctor.status}):\n${doctor.stderr.slice(-1500)}`)
  if (!doctor.stdout.includes('ok   node:')) throw new Error(`doctor did not report the node check:\n${doctor.stdout}${doctor.stderr}`)

  const files = readdirSync(join(prefix, 'node_modules', 'moon-bot-connect'))
  if (!files.includes('dist') || files.includes('src')) throw new Error(`the package shipped the wrong files: ${files.join(', ')}`)
  console.log(`connect: the packed ${tarball} installs and runs (${files.join(', ')}); doctor exits ${doctor.status} here`)
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
}

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

// electron-builder packs only what it finds through `dependencies` /
// `optionalDependencies`. Under npm, a package installed solely as a peer could
// be missing from the installer. pnpm's default `autoInstallPeers: true` pulls
// peers into the lock graph instead; keep that setting and refuse leftover
// non-pnpm locks so the repo stays on one package manager.
test('every package that the app runs on is a dependency, not only a peer', () => {
  assert.equal(existsSync(join(root, 'package-lock.json')), false, 'remove package-lock.json; use pnpm-lock.yaml')
  assert.equal(existsSync(join(root, 'npm-shrinkwrap.json')), false, 'remove npm-shrinkwrap.json; use pnpm-lock.yaml')
  assert.equal(existsSync(join(root, 'yarn.lock')), false, 'remove yarn.lock; use pnpm-lock.yaml')
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^lockfileVersion:\s*'9\.0'/m)
  assert.match(lock, /^ {2}autoInstallPeers:\s*true$/m)
  // app importer lists moon-bot-core as a real dependency (workspace link).
  const appBlock = lock.split(/\n {2}(?=\S)/).find(block => block.startsWith('apps/desktop:\n') || block.startsWith('apps/desktop:\r\n'))
  assert.ok(appBlock, 'pnpm-lock.yaml must list the apps/desktop importer')
  assert.match(appBlock, /^ {4}dependencies:\n(?: {6}.+\n)*? {6}moon-bot-core:\n {8}specifier: workspace:\*/m)
})

// W4: packageManager is the single pin; engines.pnpm and Dockerfile corepack prepare
// must name the same pnpm version.
test('root packageManager and engines.pnpm agree, and Docker corepack matches', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.match(pkg.packageManager, /^pnpm@(\d+\.\d+\.\d+)$/)
  const pinned = pkg.packageManager.slice('pnpm@'.length)
  assert.equal(pkg.engines?.node, '>=22.18')
  assert.equal(pkg.engines?.pnpm, `>=${pinned}`)
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  const prepares = [...dockerfile.matchAll(/corepack prepare pnpm@(\d+\.\d+\.\d+)/g)].map(m => m[1])
  assert.ok(prepares.length >= 1, 'Dockerfile must corepack prepare a pnpm version')
  assert.ok(prepares.every(v => v === pinned), `Dockerfile corepack prepare must use ${pinned}, got ${prepares.join(',')}`)
})

// A release is tagged with the version of ds-bot, and the installed apps compare their own
// version with the one in the release's latest.yml.
test('the app has the version of ds-bot', () => {
  const version = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).version
  assert.equal(version('../package.json'), version('../../../packages/core/package.json'))
})

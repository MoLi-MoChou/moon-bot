import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

// electron-builder packs only what it finds through `dependencies` /
// `optionalDependencies`. Under npm, a package installed solely as a peer could
// be missing from the installer. pnpm's default `autoInstallPeers: true` pulls
// peers into the lock graph instead; keep that setting and refuse a leftover
// package-lock.json so the repo stays on one package manager.
test('every package that the app runs on is a dependency, not only a peer', () => {
  assert.equal(existsSync(join(root, 'package-lock.json')), false, 'remove package-lock.json; use pnpm-lock.yaml')
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^lockfileVersion:\s*'9\.0'/m)
  assert.match(lock, /^ {2}autoInstallPeers:\s*true$/m)
  // app importer lists moon-bot-core as a real dependency (workspace link).
  const appBlock = lock.split(/\n {2}(?=\S)/).find(block => block.startsWith('app:\n') || block.startsWith('app:\r\n'))
  assert.ok(appBlock, 'pnpm-lock.yaml must list the app importer')
  assert.match(appBlock, /^ {4}dependencies:\n(?: {6}.+\n)*? {6}moon-bot-core:\n {8}specifier: workspace:\*/m)
})

// A release is tagged with the version of ds-bot, and the installed apps compare their own
// version with the one in the release's latest.yml.
test('the app has the version of ds-bot', () => {
  const version = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).version
  assert.equal(version('../package.json'), version('../../core/package.json'))
})

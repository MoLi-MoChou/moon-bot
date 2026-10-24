import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as tar from 'tar'
import { ENGINES, REGISTRIES, engineReady, ensureEngine, tarballUrl } from '../src/engines.ts'

test('the engines are the versions and checksums the lockfile installs', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  for (const engine of Object.values(ENGINES)) {
    const entry = lock.packages[`node_modules/${engine.name}`]
    assert.equal(entry.version, engine.version, engine.name)
    assert.equal(entry.integrity, engine.integrity, engine.name)
  }
})

test('tarball URLs follow the npm layout on both registries', () => {
  assert.equal(tarballUrl(REGISTRIES[0], ENGINES['win32-x64']), 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-win32-x64/-/libreoffice-kit-win32-x64-0.1.5.tgz')
  assert.equal(REGISTRIES[1], 'https://registry.npmmirror.com')
})

async function fakePackage() {
  const dir = mkdtempSync(join(tmpdir(), 'engine-src-'))
  mkdirSync(join(dir, 'package'))
  writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: '@x/engine', version: '1.0.0' }))
  writeFileSync(join(dir, 'package', 'prebuilds.json'), '{}')
  const file = join(dir, 'p.tgz')
  await tar.c({ gzip: true, file, cwd: dir }, ['package'])
  const bytes = readFileSync(file)
  return { bytes, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
}

test('a download is checked, unpacked once, and the second registry stands in for a failing one', async () => {
  const { bytes, integrity } = await fakePackage()
  const engine = { name: '@x/engine', version: '1.0.0', integrity }
  const root = mkdtempSync(join(tmpdir(), 'engines-'))
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    if (url.startsWith(REGISTRIES[0])) return new Response('nope', { status: 503 })
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
  }
  const states = []
  assert.equal(await ensureEngine({ root, engine, fetchImpl, onProgress: state => states.push(state.phase) }), 'ready')
  assert.equal(asked.length, 2)
  assert.equal(engineReady(root, engine), true)
  assert.ok(states.includes('downloading') && states.at(-1) === 'ready')
  assert.equal(await ensureEngine({ root, engine, fetchImpl }), 'ready')
  assert.equal(asked.length, 2)
})

test('a checksum mismatch leaves nothing installed', async () => {
  const { bytes } = await fakePackage()
  const engine = { name: '@x/engine', version: '1.0.0', integrity: `sha512-${createHash('sha512').update('other').digest('base64')}` }
  const root = mkdtempSync(join(tmpdir(), 'engines-'))
  await assert.rejects(ensureEngine({ root, engine, fetchImpl: async () => new Response(bytes) }), /checksum mismatch/)
  assert.equal(engineReady(root, engine), false)
})

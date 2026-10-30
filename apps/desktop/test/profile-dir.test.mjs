import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_PROFILE, PROFILE, profileDirOf } from '../src/profile-dir.ts'

const setup = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'moon-bot-profile-'))
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })
  return root
}

test('a fresh install gets the current folder, and nothing is created for it', (t) => {
  const data = setup(t)
  assert.equal(profileDirOf(data), join(data, 'profiles', PROFILE))
  assert.equal(profileDirOf(data), join(data, 'profiles', PROFILE))
})

test("an install from before the rename keeps its folder, moved to the new name", (t) => {
  const data = setup(t)
  const legacy = join(data, 'profiles', LEGACY_PROFILE)
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'settings.json'), '{"kept":true}')

  const dir = profileDirOf(data)

  assert.equal(dir, join(data, 'profiles', PROFILE))
  // The files came with it, and the old name is gone so nothing reads a stale copy.
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{"kept":true}')
  assert.equal(profileDirOf(data), dir, 'the move happens once')
})

test('a folder already under the new name wins and the old one is left alone', (t) => {
  const data = setup(t)
  const next = join(data, 'profiles', PROFILE)
  const legacy = join(data, 'profiles', LEGACY_PROFILE)
  mkdirSync(next, { recursive: true })
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(next, 'settings.json'), '{"now":true}')
  writeFileSync(join(legacy, 'settings.json'), '{"old":true}')

  assert.equal(profileDirOf(data), next)
  assert.equal(readFileSync(join(next, 'settings.json'), 'utf8'), '{"now":true}')
  assert.equal(readFileSync(join(legacy, 'settings.json'), 'utf8'), '{"old":true}')
})

test('a move that fails keeps the old folder in use instead of failing the start', (t) => {
  const data = setup(t)
  const legacy = join(data, 'profiles', LEGACY_PROFILE)
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'settings.json'), '{"kept":true}')

  const dir = profileDirOf(data, { rename: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) } })

  assert.equal(dir, legacy)
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{"kept":true}')
})

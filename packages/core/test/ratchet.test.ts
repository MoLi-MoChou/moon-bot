import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { countFile } from '../scripts/jsx-debt.mjs'
import { added, drops, lowered, rises } from '../scripts/ratchet.mjs'
import { clockWaits } from '../scripts/sleep-debt.mjs'

test('--write only lowers, and --add is what records a new count', () => {
  const baseline = { 'a.ts': 2, 'b.ts': 1 }
  const found = { 'a.ts': 4, 'c.ts': 3 }
  assert.deepEqual(lowered(baseline, found), { 'a.ts': 2 })
  assert.deepEqual(added(found), found)
  assert.deepEqual(rises(baseline, found), ['a.ts: 4 (baseline 2)', 'c.ts: 3 (baseline 0)'])
  assert.deepEqual(drops(baseline, found), ['b.ts: 0 (baseline 1)'])
})

test('a static component call is counted and a dynamic call is not', () => {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/gates/jsx/sample.tsx', import.meta.url)), 'utf8')
  assert.equal(countFile(text), 1)
})

test('clock waits are the literal awaits inside a test, and nothing else in the ok file', () => {
  const bad = readFileSync(fileURLToPath(new URL('./fixtures/gates/sleep/test/bad.test.ts', import.meta.url)), 'utf8')
  const ok = readFileSync(fileURLToPath(new URL('./fixtures/gates/sleep/test/ok.test.ts', import.meta.url)), 'utf8')
  assert.deepEqual(clockWaits(bad, 'bad.test.ts'), [4, 5, 9])
  assert.deepEqual(clockWaits(ok, 'ok.test.ts'), [])
})

test('a scratch baseline is not raised by the lower function', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moon-bot-ratchet-'))
  try {
    const file = join(dir, 'debt.json')
    writeFileSync(file, '{}\n')
    const baseline = {}
    const found = { 'new.tsx': 2 }
    writeFileSync(file, `${JSON.stringify(lowered(baseline, found))}\n`)
    assert.equal(readFileSync(file, 'utf8'), '{}\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

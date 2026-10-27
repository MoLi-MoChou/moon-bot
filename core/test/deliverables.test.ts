// The turn-end deliverable scan and its store (2026-10-28 files-and-library): what a
// turn left behind is decided by filesystem facts — changed inside the turn's window,
// not a dependency tree or an editor leftover — and what the store keeps, the chat's
// cards and the library page read.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { collectDeliverables } from '../src/host/deliverables.ts'
import { openStore } from '../src/store/db.ts'

const setTime = (path: string, at: number): void => utimesSync(path, new Date(at), new Date(at))

test('the scan keeps what changed in the turn and drops the rest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deliver-scan-'))
  try {
    const now = Date.now()
    writeFileSync(join(root, 'report.md'), 'x')
    setTime(join(root, 'report.md'), now - 1_000)
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'chart.png'), 'x')
    setTime(join(root, 'assets', 'chart.png'), now - 2_000)
    // Old work from an earlier turn.
    writeFileSync(join(root, 'old.txt'), 'x')
    setTime(join(root, 'old.txt'), now - 60_000)
    // Dependency trees and editor leftovers.
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x')
    setTime(join(root, 'node_modules', 'pkg', 'index.js'), now)
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), 'x')
    setTime(join(root, '.git', 'config'), now)
    writeFileSync(join(root, '.hidden'), 'x')
    setTime(join(root, '.hidden'), now)
    writeFileSync(join(root, 'writing.tmp'), 'x')
    setTime(join(root, 'writing.tmp'), now)

    const { files, truncated } = await collectDeliverables(root, { since: now - 5_000, until: now })
    assert.equal(truncated, false)
    assert.deepEqual(files.map(file => file.path).sort(), ['assets/chart.png', 'report.md'])
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('the scan caps the count and says so', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deliver-cap-'))
  try {
    const now = Date.now()
    for (let index = 0; index < 5; index += 1) {
      const path = join(root, `file-${index}.txt`)
      writeFileSync(path, 'x')
      setTime(path, now)
    }
    const { files, truncated } = await collectDeliverables(root, { since: now - 1_000, until: now, maxFiles: 3 })
    assert.equal(files.length, 3)
    assert.equal(truncated, true)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('the store pages a turn and shelves the library, newest first', () => {
  const home = mkdtempSync(join(tmpdir(), 'deliver-store-'))
  const store = openStore(home)
  try {
    store.sessions.upsertSession({ id: 'b1', kind: 'bot', ownerId: 'bot-1' })
    store.deliverables.add('b1', 3, [{ name: 'a.md', path: 'a.md', size: 10 }, { name: 'b.png', path: 'img/b.png', size: 20 }])
    store.deliverables.add('b1', 4, [{ name: 'c.csv', path: 'c.csv', size: 5 }])
    assert.deepEqual(store.deliverables.forTurn('b1', 3).map(row => [row.name, row.path]), [['a.md', 'a.md'], ['b.png', 'img/b.png']])
    assert.deepEqual(store.deliverables.forTurn('b1', 4).map(row => row.name), ['c.csv'])
    const shelf = store.deliverables.list({ limit: 2 })
    assert.equal(shelf.length, 2)
    assert.equal(shelf[0]?.ownerId, 'bot-1')
    assert.ok((shelf[0]?.createdAt ?? 0) >= (shelf[1]?.createdAt ?? 0), 'newest first')
    // A session leaving the team takes its deliverables with it.
    store.sessions.deleteSession('b1')
    assert.deepEqual(store.deliverables.list(), [])
  } finally {
    store.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

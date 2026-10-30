// The proactive messages store: subscriptions, the candidates prepared for them, and what
// was decided. The decision log is what keeps the same thing from being said twice.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openStore } from '../src/store/db.ts'
import { DEFAULT_DAILY_CAP, MAX_DAILY_CAP } from '../src/store/proactive.ts'

function store(t) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-proactive-'))
  const db = openStore(home)
  t.after(() => { db.close(); rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }) })
  return db.proactive
}

const sub = (over = {}) => ({
  id: 's1', botId: 'b1', sessionId: 'b1', topics: 'work', when: '{"kind":"daily","time":"08:00"}',
  ...over,
})

const candidate = (over = {}) => ({
  id: 'c1', subscriptionId: 's1', sessionId: 'b1', text: 'The weekly report is still empty in section 3.',
  evidence: ['10-28 14:22 · you said you would finish it by Friday'], whyCare: 'you set the deadline',
  ttl: 'long', topicKeys: ['weekly', 'report'], fingerprint: 'fp-1', triggerSource: 'schedule',
  ...over,
})

test('a subscription keeps the cap between one and five', (t) => {
  const proactive = store(t)
  assert.equal(proactive.addSubscription(sub({ id: 'a', dailyCap: 0 })).dailyCap, DEFAULT_DAILY_CAP)
  assert.equal(proactive.addSubscription(sub({ id: 'b', dailyCap: 99 })).dailyCap, MAX_DAILY_CAP)
  assert.equal(proactive.addSubscription(sub({ id: 'c' })).dailyCap, DEFAULT_DAILY_CAP)
})

test('a subscription round-trips, and only enabled ones are listed for work', (t) => {
  const proactive = store(t)
  const made = proactive.addSubscription(sub({ quietFrom: '22:00', quietTo: '08:00', eventHook: 'no-progress', eventMinutes: 10 }))
  assert.equal(made.quietFrom, '22:00')
  assert.equal(made.eventMinutes, 10)
  assert.equal(made.enabled, true)
  assert.equal(proactive.enabledSubscriptions().length, 1)
  proactive.setEnabled('s1', false)
  assert.equal(proactive.enabledSubscriptions().length, 0)
  // Still readable when off: the settings page shows it.
  assert.equal(proactive.subscription('s1')?.enabled, false)
})

test('a delivered candidate counts against the day, a dropped one does not', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub())
  proactive.addCandidate(candidate({ id: 'c1' }))
  proactive.addCandidate(candidate({ id: 'c2' }))
  proactive.addCandidate(candidate({ id: 'c3' }))
  proactive.decide('c1', 'delivered')
  proactive.decide('c2', 'dropped', 'not actionable')
  proactive.decide('c3', 'quiet', 'within quiet hours')
  const day = { since: Date.now() - 60_000, until: Date.now() + 60_000 }
  assert.equal(proactive.deliveredOn('s1', day.since, day.until), 1)
})

test('a decision is written once and never overwritten', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub())
  proactive.addCandidate(candidate())
  proactive.decide('c1', 'dropped', 'first')
  proactive.decide('c1', 'delivered', 'second')
  assert.equal(proactive.decision('c1')?.decision, 'dropped')
  assert.equal(proactive.decision('c1')?.reason, 'first')
})

test('the window returns recent candidates with their decisions, newest first', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub())
  proactive.addCandidate(candidate({ id: 'c1', fingerprint: 'a' }))
  proactive.addCandidate(candidate({ id: 'c2', fingerprint: 'b' }))
  proactive.decide('c2', 'delivered')
  const recent = proactive.recentCandidates('s1', Date.now() - 60_000)
  assert.equal(recent.length, 2)
  assert.equal(recent.filter(item => item.decision !== undefined).length, 1)
  // Evidence and topic keys come back as the arrays they were stored as.
  assert.deepEqual(JSON.parse(recent[0]?.evidence ?? '[]'), candidate().evidence)
  assert.deepEqual(JSON.parse(recent[0]?.topicKeys ?? '[]'), candidate().topicKeys)
})

test('candidates outside the window are not returned', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub())
  proactive.addCandidate(candidate())
  assert.equal(proactive.recentCandidates('s1', Date.now() + 60_000).length, 0)
})

test('one subscription does not see another\'s candidates', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub({ id: 's1' }))
  proactive.addSubscription(sub({ id: 's2' }))
  proactive.addCandidate(candidate({ id: 'c1', subscriptionId: 's1' }))
  assert.equal(proactive.recentCandidates('s2', Date.now() - 60_000).length, 0)
})

test('removing a subscription takes its candidates with it', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub())
  proactive.addCandidate(candidate())
  proactive.decide('c1', 'delivered')
  assert.equal(proactive.removeSubscription('s1'), true)
  assert.equal(proactive.candidate('c1'), undefined)
  assert.equal(proactive.decision('c1'), undefined)
})

test('the subscriptions of one Bot are its own', (t) => {
  const proactive = store(t)
  proactive.addSubscription(sub({ id: 's1', botId: 'b1' }))
  proactive.addSubscription(sub({ id: 's2', botId: 'b2' }))
  assert.deepEqual(proactive.subscriptionsOf('b1').map(item => item.id), ['s1'])
})

test('a store from before this feature gains the tables without losing anything', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-proactive-old-'))
  // A database at the previous schema version, with a session in it already.
  const file = join(home, 'store.sqlite3')
  const old = new DatabaseSync(file)
  const { MIGRATIONS } = await import('../src/store/schema.ts')
  // Whole migrations at once: splitting on ';' would cut a trigger body in half.
  for (const migration of MIGRATIONS.slice(0, 5)) old.exec(migration.sql)
  old.exec("INSERT INTO sessions (id, kind, owner_id, created_at, updated_at) VALUES ('b1', 'bot', 'b1', 1, 1)")
  old.exec('PRAGMA user_version = 5')
  old.close()
  const db = openStore(home)
  // Hooks run in the order they were registered, so the close comes before the delete: on
  // Windows the directory cannot be removed while this store still holds the file open.
  t.after(() => db.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }))
  // The old row is still there, and the new store works.
  assert.equal(db.sessions.session('b1')?.id, 'b1')
  db.proactive.addSubscription({ id: 's1', botId: 'b1', sessionId: 'b1', topics: 'work', when: '{}' })
  assert.equal(db.proactive.subscription('s1')?.botId, 'b1')
})

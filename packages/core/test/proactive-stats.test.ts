// The numbers the rollout is gated on: read from the store, not estimated.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { statsSince } from '../src/store/proactive-stats.ts'
import { openStore } from '../src/store/db.ts'

function env(t) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-stats-'))
  const store = openStore(home)
  t.after(() => store.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }))
  store.proactive.addSubscription({ id: 's1', botId: 'b1', sessionId: 'b1', topics: 'work', when: '{}' })
  return store
}

const candidate = (store, id) =>
  store.proactive.addCandidate({
    id,
    subscriptionId: 's1',
    sessionId: 'b1',
    text: `thing ${id}`,
    evidence: ['10-29 · you said so'],
    whyCare: 'because',
    ttl: 'short',
    topicKeys: [id],
    fingerprint: id,
    triggerSource: 'schedule',
  })

test('an empty window reports zeros rather than nothing', t => {
  const store = env(t)
  assert.deepEqual(statsSince(store.raw, Date.now() - 86_400_000), {
    prepared: 0,
    delivered: 0,
    rejected: 0,
    disabled: 0,
  })
})

test('prepared, sent and dropped are counted apart', t => {
  const store = env(t)
  candidate(store, 'a')
  candidate(store, 'b')
  candidate(store, 'c')
  store.proactive.decide('a', 'delivered')
  store.proactive.decide('b', 'dropped', 'not worth it')
  store.proactive.decide('c', 'delayed', 'quiet hours')
  const stats = statsSince(store.raw, Date.now() - 86_400_000)
  assert.equal(stats.prepared, 3)
  assert.equal(stats.delivered, 1)
  assert.equal(stats.rejected, 1, 'a delayed candidate is neither sent nor dropped')
})

test('the delivery rate the panel shows comes from these two numbers', t => {
  const store = env(t)
  for (const id of ['a', 'b', 'c', 'd']) candidate(store, id)
  store.proactive.decide('a', 'delivered')
  store.proactive.decide('b', 'dropped', 'x')
  store.proactive.decide('c', 'dropped', 'y')
  store.proactive.decide('d', 'dropped', 'z')
  const stats = statsSince(store.raw, Date.now() - 86_400_000)
  // One in four reached the user: the number that decides whether the trial passed.
  assert.equal(stats.delivered / stats.prepared, 0.25)
})

test('a switched-off subscription is counted, because that is the intrusive signal', t => {
  const store = env(t)
  assert.equal(statsSince(store.raw, Date.now() - 86_400_000).disabled, 0)
  store.proactive.setEnabled('s1', false)
  assert.equal(statsSince(store.raw, Date.now() - 86_400_000).disabled, 1)
})

test('the window excludes what happened before it', t => {
  const store = env(t)
  candidate(store, 'a')
  store.proactive.decide('a', 'delivered')
  // A window that starts after the work reports nothing, which is what makes the panel's
  // "last 7 days" mean what it says.
  assert.deepEqual(statsSince(store.raw, Date.now() + 60_000), { prepared: 0, delivered: 0, rejected: 0, disabled: 0 })
})

// Sending: what reaches the user, and what is recorded instead.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverOnce } from '../src/host/proactive/send.ts'

const candidateJson = JSON.stringify({
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said you still have to write the report'],
  why: 'You set the deadline yourself.',
  ttl: 'long',
})

function env(over = {}) {
  const recorded = []
  const handed = []
  return {
    recorded,
    handed,
    deps: {
      ask: async () => candidateJson,
      newId: () => 'c1',
      now: () => Date.parse('2026-10-29T12:00:00Z'),
      log: () => undefined,
      ...(over.deps ?? {}),
    },
    send: {
      send: (sessionId, text, source) => { handed.push({ sessionId, text, source }); return true },
      record: (id, decision, reason) => recorded.push({ id, decision, ...(reason === undefined ? {} : { reason }) }),
      live: () => true,
      ...(over.send ?? {}),
    },
  }
}

const request = (over = {}) => ({
  subscriptionId: 's1', botId: 'b1', sessionId: 'b1', triggerSource: 'schedule' as const,
  readOnly: false,
  candidates: {
    topics: 'my work',
    memory: [{ topic: null, text: 'Reports weekly on Fridays.', added: null }],
    messages: [{ role: 'user', text: 'I still have to write the report', at: 1 }],
    alreadySaid: [],
  },
  screen: {
    deliveredToday: 0, dailyCap: 1, earlier: [], mentionedRecently: false,
    localTime: '09:00', quiet: { from: '22:00', to: '08:00' },
  },
  ...over,
})

test('an accepted candidate is handed over with the proactive source and recorded as delivered', async () => {
  const e = env()
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.equal(outcome.kind, 'sent')
  assert.equal(e.handed.length, 1)
  assert.deepEqual(e.handed[0]?.source, { kind: 'proactive', subscriptionId: 's1', candidateId: 'c1' })
  assert.match(String(e.handed[0]?.text), /\[PROACTIVE\]/)
  assert.deepEqual(e.recorded, [{ id: 'c1', decision: 'delivered' }])
})

test('a dropped candidate is recorded with its reason and never sent', async () => {
  const e = env()
  const outcome = await deliverOnce(request({ screen: { ...request().screen, deliveredToday: 1 } }), e.deps, e.send)
  assert.deepEqual(outcome, { kind: 'withheld', reason: 'daily-cap' })
  assert.equal(e.handed.length, 0)
  assert.deepEqual(e.recorded, [{ id: 'c1', decision: 'dropped', reason: 'daily-cap' }])
})

test('a delayed candidate is recorded as delayed, not as dropped', async () => {
  // The distinction decides whether it is retried in the morning or forgotten.
  const e = env()
  const outcome = await deliverOnce(request({ screen: { ...request().screen, localTime: '23:30' } }), e.deps, e.send)
  assert.deepEqual(outcome, { kind: 'withheld', reason: 'quiet-hours' })
  assert.deepEqual(e.recorded, [{ id: 'c1', decision: 'delayed', reason: 'quiet-hours' }])
})

test('a candidate the judge turned down is recorded as dropped', async () => {
  const e = env({ deps: { judgeAsk: async () => 'DROP: restates what they know' } })
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.equal(outcome.kind, 'withheld')
  assert.equal(e.handed.length, 0)
  assert.equal(e.recorded[0]?.decision, 'dropped')
})

test('nothing prepared means nothing recorded and nothing sent', async () => {
  const e = env({ deps: { ask: async () => 'NOTHING' } })
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.deepEqual(outcome, { kind: 'nothing' })
  assert.equal(e.handed.length, 0)
  assert.equal(e.recorded.length, 0)
})

test('a preparation failure records nothing: there was no candidate to judge', async () => {
  const e = env({ deps: { ask: async () => { throw new Error('offline') } } })
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.equal(outcome.kind, 'failed')
  assert.equal(e.recorded.length, 0)
})

test('a conversation that is not open drops the candidate instead of queueing it', async () => {
  // A message prepared for a moment that has passed must not arrive later as if current.
  const e = env({ send: { live: () => false } })
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.deepEqual(outcome, { kind: 'withheld', reason: 'not-live' })
  assert.equal(e.handed.length, 0)
  assert.equal(e.recorded[0]?.decision, 'dropped')
})

test('a hand-off that fails is recorded, not swallowed', async () => {
  const e = env({ send: { send: () => false } })
  const outcome = await deliverOnce(request(), e.deps, e.send)
  assert.deepEqual(outcome, { kind: 'withheld', reason: 'send-failed' })
  assert.equal(e.recorded[0]?.decision, 'dropped')
})

// The morning retry: a candidate held by quiet hours is offered again, and the rules that
// decided it is no longer worth sending are the same ones as the first time.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryDelayed, stillWorthRetrying, type DelayedCandidate } from '../src/host/proactive/retry.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.parse('2026-10-30T08:05:00Z')

const delayed = (over: Partial<DelayedCandidate> = {}): DelayedCandidate => ({
  id: 'c1', subscriptionId: 's1', sessionId: 'b1',
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said so'], ttl: 'long',
  fingerprint: 'fp1', topicKeys: ['weekly', 'report', 'empty'],
  createdAt: NOW - 10 * HOUR, decidedAt: NOW - 10 * HOUR,
  ...over,
})

function env(over = {}) {
  const recorded = []
  const handed = []
  return {
    recorded, handed,
    deps: {
      delayedOf: () => [delayed()],
      earlierOf: () => [],
      deliveredToday: () => 0,
      dailyCapOf: () => 1,
      quietOf: () => ({ from: '22:00', to: '08:00' }),
      mentionedRecently: () => false,
      localTime: () => '08:05',
      now: () => NOW,
      send: (sessionId, text, source) => { handed.push({ sessionId, text, source }); return true },
      live: () => true,
      record: (id, decision, reason) => recorded.push({ id, decision, ...(reason === undefined ? {} : { reason }) }),
      log: () => undefined,
      ...(over.deps ?? {}),
    },
  }
}

test('a candidate held overnight goes out in the morning', () => {
  return (async () => {
    const e = env()
    const results = await retryDelayed(e.deps)
    assert.deepEqual(results, [{ id: 'c1', outcome: 'sent' }])
    assert.equal(e.handed.length, 1)
    assert.match(String(e.handed[0]?.text), /\[PROACTIVE\]/)
    assert.deepEqual(e.handed[0]?.source, { kind: 'proactive', subscriptionId: 's1', candidateId: 'c1' })
    assert.deepEqual(e.recorded, [{ id: 'c1', decision: 'delivered' }])
  })()
})

test('it stays held while it is still quiet', async () => {
  const e = env({ deps: { localTime: () => '03:00' } })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results, [{ id: 'c1', outcome: 'still-quiet' }])
  assert.equal(e.handed.length, 0)
  assert.equal(e.recorded.length, 0, 'nothing is decided while it still waits')
})

test('a candidate whose day is spent by the morning is dropped, not sent', async () => {
  // Something else went out at 07:00; the delayed one no longer fits the cap.
  const e = env({ deps: { deliveredToday: () => 1 } })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results, [{ id: 'c1', outcome: 'dropped' }])
  assert.equal(e.handed.length, 0)
  assert.match(String(e.recorded[0]?.reason), /after the wait: daily-cap/)
})

test('a candidate the user raised overnight is dropped', async () => {
  const e = env({ deps: { mentionedRecently: () => true } })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results, [{ id: 'c1', outcome: 'dropped' }])
  assert.match(String(e.recorded[0]?.reason), /mentioned-recently/)
})

test('a candidate that was said again overnight is dropped', async () => {
  const e = env({
    deps: {
      earlierOf: () => [{
        fingerprint: 'fp-other', topicKeys: ['weekly', 'report', 'empty'],
        decision: 'delivered' as const, decidedAt: NOW - HOUR,
      }],
    },
  })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results, [{ id: 'c1', outcome: 'dropped' }])
  assert.match(String(e.recorded[0]?.reason), /repeats/)
})

test('a conversation that is closed in the morning drops it rather than holding it again', async () => {
  // Waiting another day would deliver yesterday's observation as if it were today's.
  const e = env({ deps: { live: () => false } })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results, [{ id: 'c1', outcome: 'gone' }])
  assert.equal(e.handed.length, 0)
  assert.match(String(e.recorded[0]?.reason), /not open in the morning/)
})

test('several delayed candidates are each decided on their own', async () => {
  const e = env({ deps: { delayedOf: () => [delayed({ id: 'c1' }), delayed({ id: 'c2', text: 'The invoice is unpaid.', fingerprint: 'fp2', topicKeys: ['invoice', 'unpaid'] })] } })
  const results = await retryDelayed(e.deps)
  assert.deepEqual(results.map(item => item.outcome), ['sent', 'sent'])
  assert.equal(e.handed.length, 2)
})

test('nothing delayed means nothing happens', async () => {
  const e = env({ deps: { delayedOf: () => [] } })
  assert.deepEqual(await retryDelayed(e.deps), [])
})

test('a candidate older than the window is not worth retrying at all', () => {
  const fresh = delayed({ createdAt: NOW - 3 * 24 * HOUR })
  const stale = delayed({ createdAt: NOW - 8 * 24 * HOUR })
  assert.equal(stillWorthRetrying(fresh, NOW), true)
  assert.equal(stillWorthRetrying(stale, NOW), false)
})

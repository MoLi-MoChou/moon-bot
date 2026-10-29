// The pipeline order, and the rule that a failure leaves the user undisturbed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runOnce } from '../src/host/proactive/pipeline.ts'

const candidateJson = JSON.stringify({
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said you still have to write the report'],
  why: 'You set the deadline yourself.',
  ttl: 'long',
})

const deps = (over = {}) => {
  const logged = []
  return {
    logged,
    ask: async () => candidateJson,
    newId: () => 'c1',
    now: () => Date.parse('2026-10-29T12:00:00Z'),
    log: (message, ...rest) => logged.push([message, ...rest]),
    ...over,
  }
}

const request = (over = {}) => ({
  subscriptionId: 's1', botId: 'b1', sessionId: 'b1', triggerSource: 'schedule' as const,
  readOnly: false,
  candidates: {
    topics: 'my work',
    memory: [{ topic: null, text: 'Reports weekly on Fridays.', added: '2026-10-20' }],
    messages: [{ role: 'user', text: 'I still have to write the report', at: 1 }],
    alreadySaid: [],
  },
  screen: {
    deliveredToday: 0, dailyCap: 1, earlier: [], mentionedRecently: false,
    localTime: '09:00', quiet: { from: '22:00', to: '08:00' },
  },
  ...over,
})

test('a prepared candidate goes through the screen and comes back with its verdict', async () => {
  const outcome = await runOnce(request(), deps())
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'accept' })
  assert.equal(outcome.candidate.ttl, 'long')
})

test('a capped subscription produces a candidate and a drop verdict, so it can be logged', async () => {
  const outcome = await runOnce(request({ screen: { ...request().screen, deliveredToday: 1 } }), deps())
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'drop', reason: 'daily-cap' })
})

test('the screen still runs on a manual run, so the panel shows why something would not send', async () => {
  // A read-only run lists candidates instead of delivering them, but the reasons matter:
  // they are what tells the user whether the subscription is any good.
  const outcome = await runOnce(request({ readOnly: true, screen: { ...request().screen, mentionedRecently: true } }), deps())
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'drop', reason: 'mentioned-recently' })
})

test('a failed preparation is silent apart from a log line', async () => {
  const logged = []
  const outcome = await runOnce(request(), deps({
    ask: async () => { throw new Error('the model refused') },
    log: (message, ...rest) => logged.push([message, ...rest]),
  }))
  assert.deepEqual(outcome, { kind: 'failed', reason: 'the model refused' })
  assert.equal(logged.length, 1)
  assert.match(String(logged[0]?.[0]), /prep failed/)
})

test('a model that answers nothing is "nothing", not a failure', async () => {
  const outcome = await runOnce(request(), deps({ ask: async () => 'NOTHING' }))
  assert.deepEqual(outcome, { kind: 'nothing' })
})

test('an empty day never reaches the model', async () => {
  let asked = false
  const outcome = await runOnce(request({ candidates: { ...request().candidates, memory: [], messages: [] } }), deps({
    ask: async () => { asked = true; return candidateJson },
  }))
  assert.deepEqual(outcome, { kind: 'nothing' })
  assert.equal(asked, false)
})

test('quiet hours turn a long-lived candidate into a delay, not a drop', async () => {
  const outcome = await runOnce(request({ screen: { ...request().screen, localTime: '23:30' } }), deps())
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'delay' })
})

test('the soft judgement runs only on a candidate the hard rules allowed', async () => {
  // Asking about a candidate that is already dropped would spend a request to learn nothing.
  let judged = 0
  await runOnce(request(), deps({ judgeAsk: async () => { judged += 1; return 'INTERRUPT' } }))
  assert.equal(judged, 1)
  judged = 0
  await runOnce(request({ screen: { ...request().screen, deliveredToday: 1 } }), deps({ judgeAsk: async () => { judged += 1; return 'INTERRUPT' } }))
  assert.equal(judged, 0, 'a capped candidate must not reach the judge')
})

test('a candidate the judge turns down becomes a drop with the judge\'s reason', async () => {
  const outcome = await runOnce(request(), deps({ judgeAsk: async () => 'DROP: only restates yesterday' }))
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'drop', reason: 'not-worth-it' })
  assert.match(String(outcome.why), /restates yesterday/)
})

test('a judge that fails drops the candidate instead of sending it', async () => {
  const outcome = await runOnce(request(), deps({ judgeAsk: async () => { throw new Error('offline') } }))
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.equal(outcome.verdict.kind, 'drop')
})

test('a run with no judge still works: the hard rules alone decide', async () => {
  const outcome = await runOnce(request(), deps())
  assert.equal(outcome.kind, 'prepared')
  if (outcome.kind !== 'prepared') return
  assert.deepEqual(outcome.verdict, { kind: 'accept' })
})

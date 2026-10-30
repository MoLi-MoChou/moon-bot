// When a subscription fires: the timing, and the poll that makes it happen once.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dueAt, pollDue } from '../src/host/proactive/schedule.ts'

const at = iso => Date.parse(iso)

test('a daily subscription is due once its time has passed today', () => {
  const subscription = { id: 's1', botId: 'b1', when: JSON.stringify({ daily: { time: '08:00', time_zone: 'UTC' } }) }
  // Fired yesterday, so today's 08:00 is due.
  const yesterday = at('2026-10-28T08:00:00Z')
  assert.equal(dueAt(subscription, yesterday, at('2026-10-29T08:30:00Z')), at('2026-10-29T08:00:00Z'))
  // Fired today already: nothing more until tomorrow.
  assert.equal(dueAt(subscription, at('2026-10-29T08:00:00Z'), at('2026-10-29T08:30:00Z')), undefined)
  // Before its time: not due yet.
  assert.equal(dueAt(subscription, yesterday, at('2026-10-29T07:00:00Z')), undefined)
})

test('a subscription that has never fired is due as soon as its time has passed', () => {
  const subscription = { id: 's1', botId: 'b1', when: JSON.stringify({ every_seconds: 3600 }) }
  assert.notEqual(dueAt(subscription, undefined, 3_600_000), undefined)
})

test('a selector with no timing never fires', () => {
  // Otherwise a misconfigured subscription would run on every poll.
  for (const when of ['{}', 'null', 'not json', '', '[]']) {
    assert.equal(dueAt({ id: 's1', botId: 'b1', when }, undefined, Date.now()), undefined, when)
  }
})

test('an interval advances by its own step from the last firing', () => {
  const subscription = { id: 's1', botId: 'b1', when: JSON.stringify({ every_seconds: 600 }) }
  const last = 1_000_000
  assert.equal(dueAt(subscription, last, last + 599_000), undefined)
  assert.equal(dueAt(subscription, last, last + 600_000), last + 600_000)
})

test('a poll fires each due subscription once and moves it forward', async () => {
  const fired = []
  const noted = []
  const deps = {
    dueSubscriptions: () => [{ id: 's1', botId: 'b1', when: JSON.stringify({ every_seconds: 60 }) }],
    lastFiredAt: () => 0,
    noteFired: (id, when) => noted.push({ id, when }),
    now: () => 120_000,
    pipeline: { ask: async () => 'NOTHING', newId: () => 'c1', now: () => 120_000, log: () => undefined },
    send: { send: () => true, record: () => undefined, live: () => true },
    contextOf: async () => ({
      topics: 'x',
      dailyCap: 1,
      sessionId: 'b1',
      quietFrom: null,
      quietTo: null,
      memory: [],
      messages: [],
      earlier: [],
      alreadySaid: [],
      deliveredToday: 0,
      mentionedRecently: false,
    }),
    localTime: () => '09:00',
    localDayStart: () => 0,
    log: message => fired.push(message),
  }
  const ran = await pollDue(deps)
  assert.deepEqual(ran, ['s1'])
  assert.equal(noted.length, 1, 'the firing is recorded so the next tick moves on')
})

test('a subscription that is not due is not touched', async () => {
  const noted = []
  const deps = {
    dueSubscriptions: () => [
      { id: 's1', botId: 'b1', when: JSON.stringify({ daily: { time: '08:00', time_zone: 'UTC' } }) },
    ],
    lastFiredAt: () => at('2026-10-29T08:00:00Z'),
    noteFired: (id, when) => noted.push({ id, when }),
    now: () => at('2026-10-29T09:00:00Z'),
    pipeline: { ask: async () => 'NOTHING', newId: () => 'c1', now: () => 0, log: () => undefined },
    send: { send: () => true, record: () => undefined, live: () => true },
    contextOf: async () => undefined,
    localTime: () => '09:00',
    localDayStart: () => 0,
    log: () => undefined,
  }
  assert.deepEqual(await pollDue(deps), [])
  assert.equal(noted.length, 0)
})

test('a subscription that fails is still marked fired, so it does not retry every poll', async () => {
  const noted = []
  const deps = {
    dueSubscriptions: () => [{ id: 's1', botId: 'b1', when: JSON.stringify({ every_seconds: 60 }) }],
    lastFiredAt: () => 0,
    noteFired: (id, when) => noted.push({ id, when }),
    now: () => 120_000,
    pipeline: {
      ask: async () => {
        throw new Error('offline')
      },
      newId: () => 'c1',
      now: () => 0,
      log: () => undefined,
    },
    send: { send: () => true, record: () => undefined, live: () => true },
    contextOf: async () => ({
      topics: 'x',
      dailyCap: 1,
      sessionId: 'b1',
      quietFrom: null,
      quietTo: null,
      memory: [{ topic: null, text: 'a', added: null }],
      messages: [],
      earlier: [],
      alreadySaid: [],
      deliveredToday: 0,
      mentionedRecently: false,
    }),
    localTime: () => '09:00',
    localDayStart: () => 0,
    log: () => undefined,
  }
  await pollDue(deps)
  assert.equal(noted.length, 1)
})

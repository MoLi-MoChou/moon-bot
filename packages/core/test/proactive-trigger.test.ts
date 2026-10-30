// A trigger that runs a subscription and reports what happened, without throwing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trigger } from '../src/host/proactive/trigger.ts'

const candidateJson = JSON.stringify({
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said so'],
  why: 'You set the deadline.',
  ttl: 'long',
})

function env(over = {}) {
  const recorded = []
  const handed = []
  const context = {
    topics: 'my work',
    dailyCap: 1,
    sessionId: 'b1',
    quietFrom: '22:00',
    quietTo: '08:00',
    memory: [{ topic: null, text: 'Reports weekly on Fridays.', added: null }],
    messages: [{ role: 'user', text: 'I still have to write the report', at: 1 }],
    earlier: [],
    alreadySaid: [],
    deliveredToday: 0,
    mentionedRecently: false,
  }
  return {
    recorded,
    handed,
    deps: {
      pipeline: { ask: async () => candidateJson, newId: () => 'c1', now: () => 1000, log: () => undefined },
      send: {
        send: (sessionId, text, source) => {
          handed.push({ sessionId, text, source })
          return true
        },
        record: (id, decision, reason) => recorded.push({ id, decision, ...(reason === undefined ? {} : { reason }) }),
        live: () => true,
      },
      contextOf: async () => context,
      localTime: () => '09:00',
      localDayStart: () => 0,
      log: () => undefined,
      ...(over.deps ?? {}),
    },
  }
}

test('a triggered run sends and says so', async () => {
  const e = env()
  assert.equal(await trigger(e.deps, 's1', 'b1', 'schedule'), 'sent')
  assert.equal(e.handed.length, 1)
  assert.deepEqual(e.recorded, [{ id: 'c1', decision: 'delivered' }])
})

test('a run with nothing to say is reported as nothing, so the caller can stay silent', async () => {
  const e = env({
    deps: { pipeline: { ask: async () => 'NOTHING', newId: () => 'c1', now: () => 1000, log: () => undefined } },
  })
  assert.equal(await trigger(e.deps, 's1', 'b1', 'event'), 'nothing')
  assert.equal(e.handed.length, 0)
})

test('a withheld candidates reports why, for the panel', async () => {
  const e = env({
    deps: {
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
        deliveredToday: 1,
        mentionedRecently: false,
      }),
    },
  })
  assert.equal(await trigger(e.deps, 's1', 'b1', 'schedule'), 'withheld:daily-cap')
  assert.equal(e.handed.length, 0)
})

test('a context that cannot be read does not throw', async () => {
  const e = env({
    deps: {
      contextOf: async () => {
        throw new Error('store gone')
      },
    },
  })
  assert.equal(await trigger(e.deps, 's1', 'b1', 'schedule'), 'no-context')
})

test('a failed preparation is reported, not thrown: a trigger must not take the poller down', async () => {
  const e = env({
    deps: {
      pipeline: {
        ask: async () => {
          throw new Error('offline')
        },
        newId: () => 'c1',
        now: () => 1000,
        log: () => undefined,
      },
    },
  })
  assert.equal(await trigger(e.deps, 's1', 'b1', 'schedule'), 'failed')
})

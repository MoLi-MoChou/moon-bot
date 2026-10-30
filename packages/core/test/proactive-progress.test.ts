// The no-progress hook: silence is what it reports, not what it decides to say.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProgressWatch, pollProgress, staleSince } from '../src/host/proactive/progress.ts'

const watched = { subscriptionId: 's1', botId: 'b1', sessionId: 'b1', minutes: 10 }
const MINUTE = 60_000

test('a conversation still for longer than the threshold is stale', () => {
  const now = 1_000_000
  assert.equal(staleSince(watched, now - 11 * MINUTE, now, false), now - 11 * MINUTE)
  // Exactly at the threshold counts: ten minutes of nothing is ten minutes.
  assert.equal(staleSince(watched, now - 10 * MINUTE, now, false), now - 10 * MINUTE)
})

test('a conversation that moved recently is not stale', () => {
  const now = 1_000_000
  assert.equal(staleSince(watched, now - 9 * MINUTE, now, false), undefined)
})

test('a running turn is progress, however long it has been running', () => {
  // A long build is not silence, and interrupting it with a nudge would be wrong.
  const now = 1_000_000
  assert.equal(staleSince(watched, now - 60 * MINUTE, now, true), undefined)
})

test('a conversation never seen to move is not stale', () => {
  // The hook only speaks about silence it observed. Reporting a conversation it has never
  // watched would fire on every startup.
  assert.equal(staleSince(watched, undefined, 1_000_000, false), undefined)
})

test('a subscription with no threshold never fires', async () => {
  const fired = await pollProgress({
    ...deps(),
    watched: () => [{ ...watched, minutes: 0 }],
  })
  assert.deepEqual(fired, [])
})

function deps(over = {}) {
  const logged = []
  const noted = []
  return {
    logged,
    noted,
    watched: () => [watched],
    lastActivityAt: () => 1_000_000 - 11 * MINUTE,
    busy: () => false,
    noteFired: (id, at) => noted.push({ id, at }),
    now: () => 1_000_000,
    pipeline: { ask: async () => 'NOTHING', newId: () => 'c1', now: () => 1_000_000, log: () => undefined },
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
    log: message => logged.push(message),
    ...over,
  }
}

test('a stale subscription runs, and is marked fired before the run', async () => {
  const d = deps()
  assert.deepEqual(await pollProgress(d), ['s1'])
  assert.equal(d.noted.length, 1)
  assert.ok(d.logged.some(line => String(line).includes('no-progress hook')))
})

test('a busy subscription is not touched', async () => {
  const d = deps({ busy: () => true })
  assert.deepEqual(await pollProgress(d), [])
  assert.equal(d.noted.length, 0)
})

test('a run that throws is still marked fired, so the next tick does not repeat it', async () => {
  const d = deps({
    pipeline: {
      ask: async () => {
        throw new Error('offline')
      },
      newId: () => 'c1',
      now: () => 0,
      log: () => undefined,
    },
  })
  await pollProgress(d)
  assert.equal(d.noted.length, 1)
})

test('the watch remembers the last time a Session moved, and forgets on request', () => {
  const watch = new ProgressWatch()
  assert.equal(watch.lastActivityAt('b1'), undefined)
  watch.moved('b1', 111)
  assert.equal(watch.lastActivityAt('b1'), 111)
  watch.moved('b1', 222)
  assert.equal(watch.lastActivityAt('b1'), 222)
  watch.forget('b1')
  assert.equal(watch.lastActivityAt('b1'), undefined)
})

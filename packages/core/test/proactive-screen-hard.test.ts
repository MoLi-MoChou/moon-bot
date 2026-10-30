// The hard rules, one at a time. Each test states the rule and the case that would make a
// Bot a nuisance if the rule were missing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  insideWindow,
  screenHard,
  startOfLocalDay,
  withinQuietHours,
  MENTIONED_MS,
  WINDOW_MS,
} from '../src/host/proactive/screen-hard.ts'
import { fingerprintOf, topicKeysOf } from '../src/host/proactive/similarity.ts'

const NOW = Date.parse('2026-10-29T12:00:00Z')

const candidate = (over = {}) => {
  const text = over.text ?? 'The weekly report section 3 is still empty'
  return {
    id: 'c1',
    text,
    fingerprint: fingerprintOf(text),
    topicKeys: topicKeysOf(text),
    ttl: 'short',
    createdAt: NOW,
    ...over,
  }
}

const input = (over = {}) => ({
  candidate: candidate(),
  deliveredToday: 0,
  dailyCap: 1,
  earlier: [],
  mentionedRecently: false,
  localTime: '09:00',
  quiet: { from: '22:00', to: '08:00' },
  ...over,
})

test('a plain candidate with nothing against it passes to the model', () => {
  assert.deepEqual(screenHard(input()), { kind: 'accept' })
})

test('the day cap stops a second message before anything else is checked', () => {
  // The order matters for cost: a capped subscription must not even compare subjects.
  const verdict = screenHard(input({ deliveredToday: 1, dailyCap: 1, mentionedRecently: true }))
  assert.deepEqual(verdict, { kind: 'drop', reason: 'daily-cap' })
})

test('something said in the window is not said again', () => {
  const text = 'The weekly report section 3 is still empty'
  const verdict = screenHard(
    input({
      earlier: [
        {
          fingerprint: fingerprintOf(text),
          topicKeys: topicKeysOf(text),
          decision: 'delivered',
          decidedAt: NOW - 60_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'drop', reason: 'repeats' })
})

test('a subject that was turned down stays down for the window, not just for today', () => {
  // Asking again tomorrow about something the user already declined is how a Bot becomes
  // a nuisance, so a dropped candidate blocks the subject too.
  const text = 'The weekly report section 3 is still empty'
  const verdict = screenHard(
    input({
      earlier: [
        {
          fingerprint: fingerprintOf(text),
          topicKeys: topicKeysOf(text),
          decision: 'dropped',
          decidedAt: NOW - 3 * 24 * 60 * 60_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'drop', reason: 'repeats' })
})

test('a reworded repeat is still a repeat', () => {
  const earlier = candidate({ text: 'The weekly report section 3 is still empty', createdAt: NOW - 86_400_000 })
  const verdict = screenHard(
    input({
      candidate: candidate({ text: 'weekly report section 3 empty' }),
      earlier: [
        {
          fingerprint: earlier.fingerprint,
          topicKeys: earlier.topicKeys,
          decision: 'delivered',
          decidedAt: NOW - 86_400_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'drop', reason: 'repeats' })
})

test('a different fact about the same subject is not a repeat', () => {
  // "the report is empty" and "the report is due Friday" are different things to say.
  const earlier = candidate({ text: 'The weekly report section 3 is still empty' })
  const verdict = screenHard(
    input({
      candidate: candidate({ text: 'Your weekly report is due Friday' }),
      earlier: [
        {
          fingerprint: earlier.fingerprint,
          topicKeys: earlier.topicKeys,
          decision: 'delivered',
          decidedAt: NOW - 3_600_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'accept' })
})

test('a subject the user just raised is left alone', () => {
  assert.deepEqual(screenHard(input({ mentionedRecently: true })), { kind: 'drop', reason: 'mentioned-recently' })
})

test('a nearly identical subject is caught as a repeat, before the unanswered rule is reached', () => {
  // The two rules overlap, and repeats is the stronger one: it does not care whether the
  // earlier message was answered. This pins that order, because a repeat is a repeat.
  const text = 'The weekly report section 3 is still empty'
  const verdict = screenHard(
    input({
      candidate: candidate({ text: 'The weekly report section 3 is still empty, still' }),
      earlier: [
        {
          fingerprint: fingerprintOf(text),
          topicKeys: topicKeysOf(text),
          decision: 'delivered',
          decidedAt: NOW - 2 * 60 * 60_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'drop', reason: 'repeats' })
})

test('a subject said and left unanswered is covered by the repeat rule, not a second one', () => {
  // Writing this as its own rule was dead code: anything close enough to be "the same
  // subject unanswered" already trips the repeat check. Keeping both would have been a
  // rule that never fires, which reads like protection that is not there.
  const earlierText = 'The weekly report section 3 is still empty'
  const verdict = screenHard(
    input({
      candidate: candidate({ text: 'weekly report section 3 empty' }),
      earlier: [
        {
          fingerprint: fingerprintOf(earlierText),
          topicKeys: topicKeysOf(earlierText),
          decision: 'delivered',
          decidedAt: NOW - 2 * 60 * 60_000,
        },
      ],
    }),
  )
  assert.deepEqual(verdict, { kind: 'drop', reason: 'repeats' })
})

test('a passing observation during quiet hours is dropped, a deadline waits', () => {
  const quiet = { from: '22:00', to: '08:00' }
  assert.deepEqual(screenHard(input({ localTime: '23:30', quiet })), { kind: 'drop', reason: 'quiet-hours' })
  assert.deepEqual(screenHard(input({ localTime: '23:30', quiet, candidate: candidate({ ttl: 'long' }) })), {
    kind: 'delay',
  })
  // 07:59 is still quiet, 08:00 is not.
  assert.deepEqual(screenHard(input({ localTime: '07:59', quiet })), { kind: 'drop', reason: 'quiet-hours' })
  assert.deepEqual(screenHard(input({ localTime: '08:00', quiet })), { kind: 'accept' })
})

test('quiet hours that run past midnight cover both ends of the night', () => {
  const quiet = { from: '22:00', to: '08:00' }
  for (const time of ['22:00', '23:59', '00:00', '03:00', '07:59'])
    assert.equal(withinQuietHours(time, quiet), true, time)
  for (const time of ['08:00', '12:00', '21:59']) assert.equal(withinQuietHours(time, quiet), false, time)
  assert.equal(withinQuietHours('23:00', null), false, 'no quiet hours set means none')
})

test('a subscription with no quiet hours is never quiet', () => {
  assert.deepEqual(screenHard(input({ localTime: '03:00', quiet: null })), { kind: 'accept' })
})

test("the window is a week, and the local day starts at the user's midnight", () => {
  assert.equal(insideWindow({ createdAt: NOW - WINDOW_MS + 1000 }, NOW), true)
  assert.equal(insideWindow({ createdAt: NOW - WINDOW_MS - 1000 }, NOW), false)
  // Shanghai is UTC+8: at 12:00Z the local day began at 16:00Z the day before.
  const start = startOfLocalDay(NOW, 'Asia/Shanghai')
  assert.equal(new Date(start).toISOString(), '2026-10-28T16:00:00.000Z')
})

test('the two windows are the lengths the plan named', () => {
  assert.equal(WINDOW_MS, 7 * 24 * 60 * 60_000)
  assert.equal(MENTIONED_MS, 24 * 60 * 60_000)
})

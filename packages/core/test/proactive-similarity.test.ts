// Calibrating the subject comparison the de-duplication window uses.
//
// The plan wanted cosine similarity over embeddings; this build has no embedding
// provider, so the comparison is keyword overlap. These tests are the calibration the
// plan asked for: they pin the threshold with worded pairs, so a change to the scoring
// has to show what it does to cases that should and should not count as the same thing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SAME_SUBJECT, fingerprintOf, repeatsEarlier, similarityOf, topicKeysOf,
} from '../src/host/proactive/similarity.ts'

test('topic keys drop stop words and punctuation, in both languages', () => {
  assert.deepEqual(topicKeysOf('The weekly report is still empty!'), ['weekly', 'report', 'empty'])
  assert.deepEqual(topicKeysOf('周报 第 3 节 还 是 空 的'), ['3', '周', '报', '第', '节', '空'])
  // The same word twice counts once.
  assert.deepEqual(topicKeysOf('deploy deploy deploy'), ['deploy'])
})

test('an exact repeat is caught by the fingerprint alone, whatever the spacing', () => {
  assert.equal(fingerprintOf('The report is late'), fingerprintOf('  the   report IS late  '))
  assert.notEqual(fingerprintOf('The report is late'), fingerprintOf('The report is early'))
})

test('pairs that say the same thing score above the threshold', () => {
  const same = [
    ['The weekly report section 3 is still empty', 'weekly report section 3 empty'],
    ['You moved the deploy to Thursday', 'deploy moved to Thursday'],
    ['The 周报 deadline is Friday', '周报 deadline Friday'],
    ['Your test suite has been failing for three days', 'test suite failing three days'],
  ]
  for (const [a, b] of same) {
    const score = similarityOf(topicKeysOf(a), topicKeysOf(b))
    assert.ok(score >= SAME_SUBJECT, `${a} vs ${b} scored ${score.toFixed(2)}, expected >= ${SAME_SUBJECT}`)
  }
})

test('pairs that are related but different score below the threshold', () => {
  const different = [
    ['The weekly report section 3 is still empty', 'The deploy needs a rollback plan'],
    ['You moved the deploy to Thursday', 'The deploy succeeded on Tuesday'],
    ['Your test suite has been failing for three days', 'Your test suite passes now'],
    ['周报 第 3 节 空', '部署 计划 变化'],
  ]
  for (const [a, b] of different) {
    const score = similarityOf(topicKeysOf(a), topicKeysOf(b))
    assert.ok(score < SAME_SUBJECT, `${a} vs ${b} scored ${score.toFixed(2)}, expected < ${SAME_SUBJECT}`)
  }
})

test('the comparison is symmetric, and an empty subject matches nothing', () => {
  const a = topicKeysOf('deploy moved to Thursday')
  const b = topicKeysOf('Thursday deploy')
  assert.equal(similarityOf(a, b), similarityOf(b, a))
  assert.equal(similarityOf([], b), 0)
  assert.equal(similarityOf(a, []), 0)
})

test('a one-word subject counts as the same subject said again', () => {
  // Containment is the signal while the shorter side is very short: those words are the
  // whole subject. Past that the difference between the two can reverse the meaning, so
  // overlap decides instead. Two tokens is the line because a one-word Chinese subject is
  // already two characters.
  const short = topicKeysOf('周报')
  const long = topicKeysOf('周报 第 3 节 还 是 空 的')
  assert.ok(similarityOf(short, long) >= SAME_SUBJECT)
  // Three words carry a reversal, so this pair stays apart.
  const before = topicKeysOf('test suite failing')
  const after = topicKeysOf('test suite passes')
  assert.ok(similarityOf(before, after) < SAME_SUBJECT)
})

test('repeatsEarlier reports the fingerprint it matched, for the decision log', () => {
  const earlier = [
    { fingerprint: fingerprintOf('The deploy moved to Thursday'), topicKeys: topicKeysOf('The deploy moved to Thursday') },
    { fingerprint: fingerprintOf('The report is empty'), topicKeys: topicKeysOf('The report is empty') },
  ]
  const exact = repeatsEarlier(
    { fingerprint: fingerprintOf('The deploy moved to Thursday'), topicKeys: topicKeysOf('The deploy moved to Thursday') },
    earlier,
  )
  assert.equal(exact.repeats, true)
  assert.equal(exact.against, earlier[0]?.fingerprint)
  // Reworded but the same subject.
  const reworded = repeatsEarlier(
    { fingerprint: fingerprintOf('deploy Thursday'), topicKeys: topicKeysOf('deploy Thursday') },
    earlier,
  )
  assert.equal(reworded.repeats, true)
  // A different subject passes.
  const fresh = repeatsEarlier(
    { fingerprint: fingerprintOf('The invoice for October is unpaid'), topicKeys: topicKeysOf('The invoice for October is unpaid') },
    earlier,
  )
  assert.equal(fresh.repeats, false)
  assert.equal(fresh.against, undefined)
})

test('nothing earlier means nothing repeats', () => {
  const answer = repeatsEarlier({ fingerprint: 'x', topicKeys: topicKeysOf('anything at all') }, [])
  assert.equal(answer.repeats, false)
})

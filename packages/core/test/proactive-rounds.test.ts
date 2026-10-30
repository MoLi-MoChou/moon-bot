// The quiet round: a proactive run is recorded even when it had nothing to say, and its
// line never reads like a turn that did work.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoundLog, roundLine } from '../src/host/proactive/rounds.ts'

test('every outcome has a line a person can read', () => {
  assert.equal(roundLine('sent'), 'brought something up')
  assert.match(roundLine('nothing'), /found nothing to say/)
  assert.match(roundLine('failed'), /could not finish/)
  // A withheld run says why in the panel, using the screen's own reason code.
  assert.match(roundLine('withheld:daily-cap'), /held back \(daily-cap\)/)
  assert.match(roundLine('withheld:repeats'), /held back \(repeats\)/)
})

test('no line claims work was done when none was', () => {
  // The panel must not make a silent run look like a turn: that is what would make the
  // list untrustworthy, and why these rows are kept apart from turn history.
  for (const outcome of ['nothing', 'failed']) {
    assert.doesNotMatch(roundLine(outcome), /brought something up/)
  }
})

test('the log keeps the newest first and stays bounded', () => {
  const log = createRoundLog(3)
  for (let index = 0; index < 5; index += 1) {
    log.note({ subscriptionId: `s${index}`, botId: 'b1', botName: 'Chief', at: index, outcome: 'nothing' })
  }
  const recent = log.recent()
  assert.equal(recent.length, 3, 'the log does not grow without limit')
  assert.equal(recent[0]?.subscriptionId, 's4', 'newest first')
  assert.equal(recent[2]?.subscriptionId, 's2')
})

test('recent hands back a copy, so a reader cannot change the log', () => {
  const log = createRoundLog()
  log.note({ subscriptionId: 's1', botId: 'b1', botName: 'Chief', at: 1, outcome: 'sent' })
  const first = log.recent() as { subscriptionId: string }[]
  first.push({ subscriptionId: 'injected' })
  assert.equal(log.recent().length, 1)
})

test('a run that sent is distinguished from one that held back', () => {
  // "Sent" and "held back" are the two outcomes the rollout numbers depend on; a panel that
  // showed them the same way would hide the very thing being measured.
  assert.notEqual(roundLine('sent'), roundLine('withheld:daily-cap'))
  assert.notEqual(roundLine('nothing'), roundLine('withheld:daily-cap'))
})

// How a proactive review reads. The wording is the whole interface here: a user keeps a
// subscription or turns it off based on whether these lines make sense.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasCandidates, outcomeText, quietLabel, reasonText } from '../src/client/proactive-copy.ts'

test('a candidate that would go out says so plainly', () => {
  assert.equal(outcomeText({ would: 'send' }), 'Would send now')
})

test('a candidate held for the morning says that, not that it was dropped', () => {
  // "Dropped" and "waiting" are different promises to the user.
  assert.equal(outcomeText({ would: 'delay' }), 'Held for the morning')
})

test('every drop reason has words a user can act on', () => {
  const reasons = ['daily-cap', 'repeats', 'mentioned-recently', 'quiet-hours', 'something-new']
  for (const reason of reasons) {
    const text = reasonText(reason)
    assert.ok(text.length > 0, reason)
    // The code itself must never reach the interface.
    assert.doesNotMatch(text, /-/, `${reason} leaked its code`)
  }
  assert.match(reasonText('daily-cap'), /already spoke today/)
  assert.match(reasonText('repeats'), /last week/)
})

test('a dropped candidate names the reason inside the sentence', () => {
  const text = outcomeText({ would: 'drop', reason: 'repeats' })
  assert.match(text, /^Would not send: /)
  assert.match(text, /last week/)
})

test('quiet hours read as a window, and no quiet hours says so', () => {
  assert.equal(quietLabel({ quietFrom: '22:00', quietTo: '08:00' }), 'Quiet 22:00–08:00')
  assert.equal(quietLabel({ quietFrom: null, quietTo: null }), 'No quiet hours')
  // Half a window is not a window.
  assert.equal(quietLabel({ quietFrom: '22:00', quietTo: null }), 'No quiet hours')
})

test('an empty review is distinguishable from no review yet', () => {
  assert.equal(hasCandidates(null), false)
  assert.equal(hasCandidates({ candidates: [] }), false)
  assert.equal(hasCandidates({ candidates: [{}] }), true)
})

test('a proactive row is marked before its text, so the mark is read first', async () => {
  // The client rule forbids importing a .tsx from a test, so this pins the contract the two
  // sides share: the field the host sets and the field the row reads.
  const { readFileSync } = await import('node:fs')
  const chat = readFileSync(new URL('../src/client/cells-chat.tsx', import.meta.url), 'utf8')
  const types = readFileSync(new URL('../src/client/cells-chat-types.ts', import.meta.url), 'utf8')
  assert.match(types, /proactive\?: boolean/, 'the row type carries the mark')
  assert.match(chat, /row\.proactive === true \? <span className='bt-upmark'/, 'the mark is rendered')
  assert.match(chat, /data-proactive=/, 'the row can be styled apart without relying on the text')
  const pager = readFileSync(new URL('../src/host/parts-pager.ts', import.meta.url), 'utf8')
  // A proactive message comes from its own source kind, and is presented as a user row
  // because the Bot answers it — but it keeps the mark.
  assert.match(pager, /source\?\.kind === 'user' \|\| source\?\.kind === PROACTIVE_KIND/)
  assert.match(pager, /proactive: true/)
})

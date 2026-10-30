// Delivery: what the Bot is told, and the markers the interface and the window rely on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isProactiveSource, proactiveCaller } from '../src/host/proactive/deliver.ts'

test("the Bot is told this came from the user's standing request, not from the user now", () => {
  // If the Bot read it as a normal message it would answer as if the user had just spoken,
  // and might open with a greeting addressed to a person who is not there.
  const text = proactiveCaller('The weekly report is still empty.', ['10-29 · you said so'])
  assert.match(text, /\[PROACTIVE\]/)
  assert.match(text, /asked you to keep an eye on/)
  assert.match(text, /The weekly report is still empty\./)
})

test('the evidence travels with the instruction, so the Bot can be specific', () => {
  const text = proactiveCaller('The report is empty.', ['10-28 14:22 · you said you would finish it by Friday'])
  assert.match(text, /What this rests on:/)
  assert.match(text, /10-28 14:22/)
})

test('with no evidence the section is left out rather than left empty', () => {
  const text = proactiveCaller('Something happened.', [])
  assert.doesNotMatch(text, /What this rests on:/)
})

test('the instruction forbids the shapes that make a proactive message annoying', () => {
  const text = proactiveCaller('x', [])
  assert.match(text, /one or two short sentences/)
  assert.match(text, /Do not add a greeting/)
  assert.match(text, /do not ask a question/)
})

test('a proactive source is recognisable, and anything else is not', () => {
  assert.equal(isProactiveSource({ kind: 'proactive', subscriptionId: 's1', candidateId: 'c1' }), true)
  assert.equal(isProactiveSource({ kind: 'schedule' }), false)
  assert.equal(isProactiveSource({ kind: 'user' }), false)
  assert.equal(isProactiveSource(null), false)
  assert.equal(isProactiveSource(undefined), false)
  assert.equal(isProactiveSource('proactive'), false)
})

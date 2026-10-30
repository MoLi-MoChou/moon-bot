// Prep: what it asks the model, and what it refuses to accept as an answer.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PREP_SYSTEM, parsePrepAnswer, prepare, prepPrompt } from '../src/host/proactive/prep.ts'

const sub = { id: 's1', botId: 'b1', sessionId: 'b1', topics: 'my work', allowPaidPrep: false }

const input = (over = {}) => ({
  subscription: sub,
  memory: [{ topic: null, text: 'The user reports weekly on Fridays.', added: '2026-10-20' }],
  messages: [{ role: 'user', text: 'I still have to write the report', at: Date.parse('2026-10-29T09:00:00Z') }],
  alreadySaid: [],
  now: Date.parse('2026-10-29T12:00:00Z'),
  triggerSource: 'manual' as const,
  ...over,
})

const answer = (value: unknown) => JSON.stringify(value)
const good = {
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said you still have to write the report'],
  why: 'You set the deadline yourself.',
  ttl: 'long',
}

test('the prompt carries the memory, the day, and what was already raised', () => {
  const prompt = prepPrompt(input({ alreadySaid: ['The deploy moved to Thursday'] }))
  assert.match(prompt, /my work/)
  assert.match(prompt, /weekly on Fridays/)
  assert.match(prompt, /still have to write the report/)
  assert.match(prompt, /Already raised, do not repeat/)
  assert.match(prompt, /The deploy moved to Thursday/)
})

test('the prompt says an empty answer is the normal one', () => {
  // The model has to be told that silence is acceptable, or it will manufacture something.
  assert.match(PREP_SYSTEM, /NOTHING/)
  assert.match(PREP_SYSTEM, /normal answer, not a failure/)
})

test('a well-formed answer becomes a candidate', async () => {
  const candidate = await prepare(input(), async () => answer(good), () => 'c1')
  assert.equal(candidate?.id, 'c1')
  assert.equal(candidate?.ttl, 'long')
  assert.equal(candidate?.evidence.length, 1)
  assert.equal(candidate?.whyCare, 'You set the deadline yourself.')
  // The de-duplication keys come from the text itself.
  assert.equal(typeof candidate?.fingerprint, 'string')
  assert.ok((candidate?.topicKeys.length ?? 0) > 0)
})

test('a model that says nothing produces no candidate', async () => {
  assert.equal(await prepare(input(), async () => 'NOTHING', () => 'c1'), undefined)
  assert.equal(await prepare(input(), async () => '  nothing  ', () => 'c1'), undefined)
  assert.equal(await prepare(input(), async () => '', () => 'c1'), undefined)
})

test('an answer with no evidence is refused, however good it sounds', async () => {
  // The rule that matters most: no source, no message.
  const unsourced = { ...good, evidence: [] }
  assert.equal(await prepare(input(), async () => answer(unsourced), () => 'c1'), undefined)
})

test('evidence made only of blank lines counts as no evidence', async () => {
  const blank = { ...good, evidence: ['', '   '] }
  assert.equal(await prepare(input(), async () => answer(blank), () => 'c1'), undefined)
})

test('broken JSON is a silent failure, not an exception', async () => {
  assert.equal(await prepare(input(), async () => '{"text": ', () => 'c1'), undefined)
  assert.equal(await prepare(input(), async () => '[1,2,3]', () => 'c1'), undefined)
  assert.equal(await prepare(input(), async () => '"just a string"', () => 'c1'), undefined)
})

test('a fenced JSON block is read as JSON', () => {
  const parsed = parsePrepAnswer('```json\n' + answer(good) + '\n```')
  assert.equal(parsed?.text, good.text)
})

test('evidence is capped at three lines', () => {
  const many = { ...good, evidence: ['a', 'b', 'c', 'd', 'e'] }
  assert.equal(parsePrepAnswer(answer(many))?.evidence.length, 3)
})

test('a deadline is treated as long-lived even when the model says short', () => {
  // A commitment that outlives the quiet hours must not be dropped at 23:00.
  const parsed = parsePrepAnswer(answer({ ...good, ttl: 'short', text: 'The report is due Friday.' }))
  assert.equal(parsed?.ttl, 'short', 'an explicit answer is respected')
  const implicit = parsePrepAnswer(answer({ ...good, ttl: '', text: 'The report is due Friday.' }))
  assert.equal(implicit?.ttl, 'long', 'a deadline with no answer is assumed long')
})

test('nothing to read means no model call at all', async () => {
  let asked = 0
  const candidate = await prepare(input({ memory: [], messages: [] }), async () => { asked += 1; return answer(good) }, () => 'c1')
  assert.equal(candidate, undefined)
  assert.equal(asked, 0, 'an empty day must not cost a request')
})

test('the prompt keeps long conversations bounded', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({ role: 'user', text: `m${index}`, at: 1 }))
  const prompt = prepPrompt(input({ messages }))
  // The latest ones survive; the oldest are left out.
  assert.match(prompt, /m199/)
  assert.doesNotMatch(prompt, /- m0\b/)
})

// The soft judgement: is this worth interrupting for, and does an unclear answer fail safe.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JUDGE_SYSTEM, judge, judgePrompt, parseJudgeAnswer } from '../src/host/proactive/screen-judge.ts'

const candidate = {
  text: 'The weekly report you meant to finish by Friday is still empty.',
  evidence: ['10-29 09:00 · you said you still have to write the report'],
  whyCare: 'You set the deadline yourself.',
}

test('INTERRUPT sends, DROP does not', () => {
  assert.deepEqual(parseJudgeAnswer('INTERRUPT'), { kind: 'send' })
  assert.deepEqual(parseJudgeAnswer('interrupt: gives a next step'), { kind: 'send' })
  const dropped = parseJudgeAnswer('DROP: only restates what they know')
  assert.equal(dropped.kind, 'drop')
  if (dropped.kind === 'drop') assert.match(dropped.reason, /restates/)
})

test('an answer with no reason still drops, with a reason of its own', () => {
  const verdict = parseJudgeAnswer('DROP')
  assert.equal(verdict.kind, 'drop')
  if (verdict.kind === 'drop') assert.equal(verdict.reason, 'not worth interrupting for')
})

test('markdown decoration around the word is tolerated', () => {
  assert.deepEqual(parseJudgeAnswer('**INTERRUPT**'), { kind: 'send' })
  assert.deepEqual(parseJudgeAnswer('`DROP`: nag'), parseJudgeAnswer('DROP: nag'))
})

test('anything unreadable drops, because the safe direction is silence', () => {
  for (const answer of ['', 'maybe', 'I think this is fine', '{"verdict":"send"}', 'yes']) {
    const verdict = parseJudgeAnswer(answer)
    assert.equal(verdict.kind, 'drop', answer)
  }
})

test('the prompt carries the message, the reason and the evidence', () => {
  const prompt = judgePrompt(candidate)
  assert.match(prompt, /still empty/)
  assert.match(prompt, /You set the deadline/)
  assert.match(prompt, /you said you still have to write the report/)
})

test('a candidate with no evidence is dropped without asking anyone', () => {
  let asked = false
  const verdict = parseJudgeAnswer('INTERRUPT')
  assert.equal(verdict.kind, 'send')
  // The real check: judge() refuses before spending a request.
  return judge({ ...candidate, evidence: [] }, async () => { asked = true; return 'INTERRUPT' })
    .then((answer) => {
      assert.equal(answer.kind, 'drop')
      assert.equal(asked, false)
    })
})

test('a failed call is a drop, not an error the caller has to handle', async () => {
  const verdict = await judge(candidate, async () => { throw new Error('no model today') })
  assert.equal(verdict.kind, 'drop')
  if (verdict.kind === 'drop') assert.match(verdict.reason, /no model today/)
})

test('the instruction says an unsure answer must drop', () => {
  // This is the line that makes the prompt safe; without it the model leans to sending.
  assert.match(JUDGE_SYSTEM, /When you are unsure, DROP/)
  assert.match(JUDGE_SYSTEM, /only expresses care/)
})

test('a normal interruption goes through', async () => {
  const verdict = await judge(candidate, async () => 'INTERRUPT: the deadline is Friday')
  assert.deepEqual(verdict, { kind: 'send' })
})

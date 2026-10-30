// Pre-authorised actions: the narrowest reading of §7, checked in every direction.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PREAUTH_MAX_LEVEL, auditOf, coverableByRule, mayAct, type PreAuthRule } from '../src/host/proactive/preauth.ts'

const rule = (over: Partial<PreAuthRule> = {}): PreAuthRule => ({
  id: 'r1',
  subscriptionId: 's1',
  purpose: 'hand off stalled work',
  when: { kind: 'no-progress', minutes: 10 },
  scope: { tools: ['message_bot', 'create_bot'], dailyCap: 3 },
  prohibitions: [],
  respectQuietHours: true,
  enabled: true,
  createdAt: 1,
  ...over,
})

const attempt = (over = {}) => ({ tool: 'message_bot', withinQuietHours: false, actedToday: 0, ...over })

test('a tool in scope, inside the cap, outside quiet hours acts', () => {
  assert.deepEqual(mayAct(rule(), attempt()), { kind: 'act' })
})

test('a tool outside the scope only proposes, exactly as if there were no rule', () => {
  const verdict = mayAct(rule(), attempt({ tool: 'post_to_group' }))
  assert.equal(verdict.kind, 'propose')
  if (verdict.kind === 'propose') assert.match(verdict.reason, /outside what this rule allows/)
})

test('a prohibition wins over scope', () => {
  // A tool can be in scope and still be named as banned; the ban decides.
  const verdict = mayAct(rule({ prohibitions: ['post_to_group'] }), attempt({ tool: 'post_to_group' }))
  assert.equal(verdict.kind, 'propose')
  if (verdict.kind === 'propose') assert.match(verdict.reason, /do-not list/)
})

test("the day's cap is a wait, not a proposal: it may act tomorrow", () => {
  const verdict = mayAct(rule(), attempt({ actedToday: 3 }))
  assert.equal(verdict.kind, 'wait')
})

test('quiet hours are respected unless the user turned that off in the rule', () => {
  // The conservative default: a rule does not become a night shift by accident.
  const quiet = mayAct(rule(), attempt({ withinQuietHours: true }))
  assert.equal(quiet.kind, 'wait')
  if (quiet.kind === 'wait') assert.match(quiet.reason, /quiet hours/)
  // With the box ticked, the user made that decision and the rule acts.
  assert.deepEqual(mayAct(rule({ respectQuietHours: false }), attempt({ withinQuietHours: true })), { kind: 'act' })
})

test('a disabled rule never acts', () => {
  assert.equal(mayAct(rule({ enabled: false }), attempt()).kind, 'propose')
})

test('the cap is checked before the quiet window, so the reason is the stronger one', () => {
  const verdict = mayAct(rule(), attempt({ actedToday: 5, withinQuietHours: true }))
  assert.equal(verdict.kind, 'wait')
  if (verdict.kind === 'wait') assert.match(verdict.reason, /as often as it may today/)
})

test('every action leaves an audit line, including the ones that did not happen', () => {
  // The record is what makes a rule reviewable later; a silent rule is an unreviewable one.
  const acted = auditOf(rule(), attempt(), { kind: 'act' }, 500)
  assert.deepEqual(acted, { ruleId: 'r1', tool: 'message_bot', at: 500, outcome: 'acted' })
  const proposed = auditOf(rule(), attempt({ tool: 'x' }), { kind: 'propose', reason: 'outside' }, 500)
  assert.equal(proposed.outcome, 'proposed')
  assert.equal(proposed.reason, 'outside')
  const waited = auditOf(rule(), attempt(), { kind: 'wait', reason: 'quiet hours' }, 500)
  assert.equal(waited.outcome, 'waited')
})

test('the quiet-hours exemption is a property of the rule, not of the attempt', () => {
  // Otherwise a caller could talk itself past the window by saying it was not quiet.
  const strict = rule()
  assert.equal(mayAct(strict, attempt({ withinQuietHours: true })).kind, 'wait')
  assert.equal(mayAct(strict, attempt({ withinQuietHours: false })).kind, 'act')
})

test('a rule can never cover an action that spends money or cannot be undone', () => {
  // The red line, as a test. L3 and L4 keep asking every time, whatever a user wrote down:
  // a standing instruction is not the same as turning approval off.
  assert.equal(PREAUTH_MAX_LEVEL, 2)
  assert.equal(coverableByRule('message_bot'), true, 'L1')
  assert.equal(coverableByRule('update_bot'), true, 'L2')
  assert.equal(coverableByRule('web_search'), false, 'L3 spends money')
  assert.equal(coverableByRule('delete_capability'), false, 'L3')
  assert.equal(coverableByRule('create_bot'), false, 'L4 cannot be undone')
  // And a rule that names one still only gets to propose.
  const sneaky = rule({ scope: { tools: ['create_bot'], dailyCap: 3 } })
  const verdict = mayAct(sneaky, attempt({ tool: 'create_bot' }))
  assert.equal(verdict.kind, 'propose')
  if (verdict.kind === 'propose') assert.match(verdict.reason, /always asks/)
})

test('an unknown tool is out of scope, not implicitly allowed', () => {
  // ruleOf gives an unknown tool L3, so it is not coverable; and it is not in scope either.
  assert.equal(coverableByRule('some_new_tool'), false)
  assert.equal(mayAct(rule(), attempt({ tool: 'some_new_tool' })).kind, 'propose')
})

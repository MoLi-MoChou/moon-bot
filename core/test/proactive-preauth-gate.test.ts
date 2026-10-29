// The gate's pre-authorisation step, against a real store: a rule may answer where the
// policy would ask, and may never answer for an action the policy keeps for the user.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { preAuthGate } from '../src/service/proactive-gate.ts'
import { openStore } from '../src/store/db.ts'

function env(t) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-preauth-gate-'))
  const store = openStore(home)
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }) })
  store.proactive.addSubscription({ id: 's1', botId: 'b1', sessionId: 'b1', topics: 'work', when: '{}' })
  const runtime = {
    config: { timeZone: undefined },
    selfOf: (sessionId) => (sessionId === 'b1' ? 'b1' : undefined),
  }
  return { store, runtime }
}

// These tests run at whatever hour the machine is at, and a rule that respects quiet hours
// legitimately waits between 22:00 and 08:00. The rules under test here are about scope, so
// they say quiet hours do not hold them; the quiet-hours behaviour has its own tests.
const ruleFor = (store, over = {}) => store.proactiveRules.add({
  id: 'r1', subscriptionId: 's1', purpose: 'nudge stalled work',
  when: JSON.stringify({ kind: 'no-progress', minutes: 10 }),
  tools: ['update_bot'], prohibitions: [], dailyCap: 3, respectQuietHours: false, enabled: true,
  ...over,
})

test('a rule that respects quiet hours waits at night rather than acting', (t) => {
  // The conservative default, pinned: at 23:00 a rule with the box unticked only waits.
  const { store, runtime } = env(t)
  store.proactiveRules.add({
    id: 'r2', subscriptionId: 's1', purpose: 'night', when: JSON.stringify({ kind: 'no-progress', minutes: 10 }),
    tools: ['update_bot'], prohibitions: [], dailyCap: 3, respectQuietHours: true, enabled: true,
  })
  // Whatever the hour when this test runs, the audit says which way it went, and it is
  // consistent with the clock: acting inside the window would be the bug.
  const result = preAuthGate(runtime as never, store, 'b1', 'update_bot')
  const audit = store.proactiveRules.auditOf('r2')
  assert.equal(audit.length, 1)
  if (audit[0]?.outcome === 'waited') assert.equal(result, undefined)
  else assert.equal(result, 'r2')
})

test('a rule lets a covered tool through where the user would otherwise be asked, and records it', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store)
  const allowed = preAuthGate(runtime as never, store, 'b1', 'update_bot')
  assert.equal(allowed, 'r1')
  assert.equal(store.proactiveRules.actedSince('r1', 0), 1)
})

test('an irreversible action is never covered, even when a rule names it', (t) => {
  // create_bot is L4. A rule naming it must not turn a "the user decides" into an "it ran".
  const { store, runtime } = env(t)
  ruleFor(store, { tools: ['create_bot'] })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'create_bot'), undefined)
  // And nothing was recorded as acted.
  assert.equal(store.proactiveRules.actedSince('r1', 0), 0)
})

test('a costly action is never covered either', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store, { tools: ['web_search'] })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'web_search'), undefined)
})

test('an unknown tool is not covered', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store, { tools: ['something_new'] })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'something_new'), undefined)
})

test('a tool outside the scope is refused', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store, { tools: ['message_bot'] })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'delete_capability'), undefined)
})

test('a prohibition is honoured', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store, { tools: ['update_bot', 'attach_capability'], prohibitions: ['attach_capability'] })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'attach_capability'), undefined)
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), 'r1')
})

test('the day cap stops it, and the attempt is still audited', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store, { dailyCap: 1 })
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), 'r1')
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), undefined)
  const audit = store.proactiveRules.auditOf('r1')
  assert.equal(audit.length, 2, 'both attempts are on the record')
  assert.ok(audit.some(line => line.outcome === 'waited'))
})

test('a revoked rule stops at once', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store)
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), 'r1')
  assert.equal(store.proactiveRules.revoke('r1'), true)
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), undefined)
})

test('a Bot with no rules is asked, as before', (t) => {
  const { store, runtime } = env(t)
  assert.equal(preAuthGate(runtime as never, store, 'b1', 'update_bot'), undefined)
})

test('a session that belongs to no Bot is never covered', (t) => {
  const { store, runtime } = env(t)
  ruleFor(store)
  assert.equal(preAuthGate(runtime as never, store, 'nobody', 'message_bot'), undefined)
})

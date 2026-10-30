// The policy engine (plan §阶段 5): levels, budgets, and a refusal that names no
// appeal. The ledger is the store's; the day rolls over by UTC day.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_BUDGET, PolicyEngine, ruleOf } from '../src/engine/policy.ts'
import { openStore } from '../src/store/db.ts'

const fresh = (t: { after: (run: () => void) => void }, budget = DEFAULT_BUDGET) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-policy-'))
  const store = openStore(home)
  t.after(() => store.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const engine = new PolicyEngine({ countersOf: async (sessionId, level, spend) => store.policy.spend(sessionId, level, spend) }, budget)
  return { store, engine }
}

test('every team tool is classified, and the levels follow the plan', () => {
  assert.equal(ruleOf('list_bots').level, 0)
  assert.equal(ruleOf('read_group_chat').level, 0)
  assert.equal(ruleOf('message_bot').level, 1)
  assert.equal(ruleOf('remember').level, 1)
  assert.equal(ruleOf('create_group').level, 2)
  assert.equal(ruleOf('attach_capability').level, 3)
  assert.equal(ruleOf('delete_group').level, 4)
  assert.equal(ruleOf('create_bot').level, 4)
  assert.equal(ruleOf('request_secret').level, 4)
  // An unknown tool is L3: outside the auditable set, the safe answer asks.
  assert.equal(ruleOf('mcp_novel_connector').level, 3)
  // A tool whose own flow already asks stays quiet here.
  assert.equal(ruleOf('working_directory').asksItself, true)
})

test('L0–L2 always run; L3 and L4 run within their budgets, then ask', async (t) => {
  const { engine } = fresh(t, { level3PerDay: 2, level4PerDay: 1 })
  for (const tool of ['list_bots', 'message_bot', 'create_group']) {
    for (let index = 0; index < 5; index += 1) assert.equal((await engine.decide('s', tool)).kind, 'allow', tool)
  }
  assert.equal((await engine.decide('s', 'mcp_novel_connector')).kind, 'allow')
  assert.equal((await engine.decide('s', 'mcp_novel_connector')).kind, 'allow')
  const over = await engine.decide('s', 'mcp_novel_connector')
  assert.equal(over.kind, 'approval')
  assert.match(over.kind === 'approval' ? over.reason : '', /has run 2 times today/)
  assert.equal((await engine.decide('s', 'delete_group')).kind, 'allow')
  assert.equal((await engine.decide('s', 'delete_group')).kind, 'approval')
})

test('budgets are per session and per level', async (t) => {
  const { engine } = fresh(t, { level3PerDay: 1, level4PerDay: 1 })
  assert.equal((await engine.decide('a', 'mcp_novel_connector')).kind, 'allow')
  assert.equal((await engine.decide('a', 'mcp_novel_connector')).kind, 'approval')
  assert.equal((await engine.decide('b', 'mcp_novel_connector')).kind, 'allow', 'another session has its own budget')
  assert.equal((await engine.decide('a', 'delete_group')).kind, 'allow', 'L4 has its own counter')
})

test('the refusal names no appeal — the model cannot argue past it', async (t) => {
  const { engine } = fresh(t, { level3PerDay: 0, level4PerDay: 0 })
  const asked = await engine.decide('s', 'delete_group')
  assert.equal(asked.kind, 'approval')
  const text = asked.kind === 'approval' ? asked.reason : ''
  assert.ok(!/bypass|ignore|override|instead/i.test(text), 'no loophole words in the refusal')
})

test('the ledger counts in the store, by UTC day', (t) => {
  const { store } = fresh(t)
  assert.equal(store.policy.spend('s', 3, 2), 2)
  assert.equal(store.policy.spend('s', 3), 3)
  assert.equal(store.policy.countOf('s', 3), 3)
  assert.equal(store.policy.countOf('s', 4), 0)
  assert.equal(store.policy.countOf('other', 3), 0)
})

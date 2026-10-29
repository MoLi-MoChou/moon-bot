import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/prompt.ts'
import { fakeContext } from './fake-ctx.ts'

function start() {
  const ctx = fakeContext()
  const bots = new Map([
    ['main', { name: 'Chief' }],
    ['worker', { name: 'Dev', instructions: 'Check files.' }],
  ])
  install({
    ctx,
    selfOf: id => id === 'group-worker' ? 'worker' : id,
    botOf: id => bots.get(id),
    roomOf: id => id === 'room' ? {} : undefined,
    isMain: id => id === 'main',
  } as unknown as Parameters<typeof install>[0])
  const prompt = id => ctx.sections.get('bot-identity').text({ agent: { id } })
  return { ctx, prompt }
}

test('Bots get a scoped progress rule without changing the private/group prompt prefix', (t) => {
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  const rules = [
    '- Only for a direct user request in your own chat that needs several steps: write one short sentence of normal reply text before your first tool call, and make that tool call in the same response. Never start such a task with tools alone or end it with a promise. On long tasks, give brief factual updates only at meaningful milestones, then keep working.',
    '- For "[Message from …]" or "[Reply from …]" messages, do not write plans or progress updates: use tools silently, then reply with the answer. Simple answers do not need progress messages.',
    // Moon Bot patch: the group chat rule is left out under LEAN (no group chats).
  ]
  for (const id of ['main', 'worker']) {
    for (const rule of rules) {
      assert.ok(prompt(id).split('\n').includes(rule))
      assert.equal(prompt(id).split(rule).length - 1, 1)
    }
  }
  assert.equal(prompt('group-worker'), prompt('worker'))
})

test('the group relay and non-Bot sessions do not get progress instructions', (t) => {
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  assert.match(prompt('room'), /end your turn with an empty reply/)
  assert.doesNotMatch(prompt('room'), /progress|milestone/)
  assert.equal(prompt('outside'), '')
})

test('a Bot is told it can set reminders, so the tool is not left unreachable', (t) => {
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  const text = prompt('worker')
  // The tool exists in the registry; without a rule pointing at it a Bot asked to remind
  // the user answers that it cannot, which is what happened before this rule.
  assert.match(text, /create_schedule/)
  assert.match(text, /list_schedules/)
  assert.match(text, /delete_schedule/)
  // The old refusal must not be shipped alongside it.
  assert.doesNotMatch(text, /You cannot set reminders, timers or scheduled tasks/)
})

test('every tool a Bot is told about is one the host actually registers', async () => {
  // The rule names the tools by hand; this keeps the names honest against the registry.
  const { TEAM_TOOLS } = await import('../src/host/constants.ts')
  for (const name of ['create_schedule', 'list_schedules', 'delete_schedule']) {
    assert.ok(TEAM_TOOLS.includes(name), `${name} must be in TEAM_TOOLS to reach a Bot`)
  }
})

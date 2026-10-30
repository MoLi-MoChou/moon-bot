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

test('every tool a Bot receives either has a rule or is named in its own description', async (t) => {
  // A tool that reaches the model but is never named in the prompt is only discoverable
  // from its schema, and a Bot asked to use it may answer that it cannot — which is what
  // happened with create_schedule. This lists the ones with no rule so a new tool is a
  // deliberate choice rather than an oversight.
  const { TEAM_TOOLS } = await import('../src/host/constants.ts')
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  const text = prompt('worker')
  // Tools whose use needs no rule: their description is the whole instruction, they are
  // internal (the relay is synthesized by the host, never chosen by a model), or they are
  // Main-Bot-only and covered by MAIN_RULES rather than the team rules.
  const NEEDS_NO_RULE = [
    'forget', 'recall', 'read_browser', 'list_capabilities', 'save_capability',
    'delete_capability', 'attach_capability', 'detach_capability', 'list_engines',
    'list_models', 'stop_bot', 'group_relay',
    // Main Bot tools: MAIN_RULES names them, an ordinary Bot has no rule because it
    // cannot use them.
    'create_bot', 'create_group', 'delete_group',
  ]
  const unnamed = TEAM_TOOLS.filter(tool => !text.includes(tool))
  const unexplained = unnamed.filter(tool => !NEEDS_NO_RULE.includes(tool))
  assert.deepEqual(unexplained, [], 'a tool reaches the model with no prompt rule; add one or list it as self-explanatory')
})

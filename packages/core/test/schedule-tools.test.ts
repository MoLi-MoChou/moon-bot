// The scheduling tools a Bot calls. The point of these tests is the target: a reminder
// always lands in the conversation that asked for it — a Bot's own chat, or the group
// Session when the Bot speaks in a group — and never in someone else's.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

// One Bot in its own chat 'a', one group 'r1' whose member Writer speaks from 'gb'.
const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: {
    r1: {
      id: 'r1',
      name: 'Ops',
      members: ['a', 'b'],
      mode: 'admin',
      admin: 'a',
      named: true,
      sessions: { b: 'gb' },
      log: [],
      seq: 0,
      seen: {},
    },
  },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

function start(t) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-schedule-tools-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  // What the schedule service was asked to store, in call order.
  const created = []
  const deleted = []
  const tasks = []
  const scheduleService = {
    async catalog() {
      return tasks
    },
    async create(sessionId, request) {
      created.push({ sessionId, ...request })
      const record = {
        id: `t${created.length}`,
        sessionId,
        title: request.title,
        prompt: request.prompt,
        kind:
          request.at !== undefined
            ? 'at'
            : request.daily !== undefined
              ? 'daily'
              : request.every_seconds !== undefined
                ? 'every'
                : 'cron',
        ...(request.at !== undefined ? { scheduledAt: request.at } : {}),
        ...(request.daily !== undefined ? { time: request.daily.time, timeZone: request.daily.time_zone } : {}),
        ...(request.every_seconds !== undefined ? { everySeconds: request.every_seconds } : {}),
      }
      tasks.push(record)
      return record
    },
    async delete({ sessionId, id }) {
      deleted.push({ sessionId, id })
      const at = tasks.findIndex(task => task.id === id)
      if (at >= 0) tasks.splice(at, 1)
    },
    async list({ sessionId }) {
      return tasks.filter(task => task.sessionId === sessionId)
    },
  }
  const ctx = fakeContext({ services: { schedule: scheduleService } })
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async sessionId => ({
        agent: { id: sessionId, session: { id: sessionId }, followup() {}, steer() {}, cancel() {} },
      }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  const tool = (name, args, sessionId) =>
    ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, callId: 'c1' })
  t.after(() => {
    void ctx.dispose().then(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }))
  })
  return { tool, created, deleted, tasks }
}

test('a reminder made in a Bot chat comes back to that chat', async t => {
  const env = start(t)
  const answer = await env.tool(
    'create_schedule',
    {
      title: 'Charging test',
      prompt: 'remind the user to test the charging screen before 9:00',
      when: 'daily',
      time: '09:00',
      time_zone: 'Asia/Shanghai',
    },
    'a',
  )
  assert.match(answer, /^Set "Charging test"/)
  assert.equal(env.created.length, 1)
  // The target is the Bot's own chat Session, not the id the model passed anywhere.
  assert.equal(env.created[0].sessionId, 'a')
  assert.deepEqual(env.created[0].daily, { time: '09:00:00', time_zone: 'Asia/Shanghai' })
})

test('a reminder made while speaking in a group comes back to the group', async t => {
  const env = start(t)
  const answer = await env.tool(
    'create_schedule',
    {
      title: 'Group standup',
      prompt: 'post the standup note',
      when: 'every',
      minutes: '60',
    },
    'gb',
  )
  assert.match(answer, /group chat/)
  assert.equal(env.created[0].sessionId, 'gb')
  assert.deepEqual(env.created[0].every_seconds, 3600)
})

test('a Session outside the team cannot be given a reminder', async t => {
  const env = start(t)
  const answer = await env.tool(
    'create_schedule',
    { title: 'X', prompt: 'Y', when: 'every', minutes: '5' },
    'not-a-team-session',
  )
  assert.match(answer, /not one a reminder can come back to/)
  assert.equal(env.created.length, 0)
})

test('a reminder in the past is refused and nothing is stored', async t => {
  const env = start(t)
  const answer = await env.tool(
    'create_schedule',
    {
      title: 'Late',
      prompt: 'too late',
      when: 'at',
      at: '2020-01-01T00:00:00Z',
    },
    'a',
  )
  assert.match(answer, /The reminder was not set: Pick a time in the future/)
  assert.equal(env.created.length, 0)
})

test("list_schedules shows only this conversation's reminders, and delete removes one", async t => {
  const env = start(t)
  await env.tool('create_schedule', { title: 'Mine', prompt: 'mine', when: 'every', minutes: '30' }, 'a')
  await env.tool('create_schedule', { title: 'Group', prompt: 'group', when: 'every', minutes: '30' }, 'gb')
  const mine = await env.tool('list_schedules', {}, 'a')
  assert.match(mine, /Mine/)
  assert.doesNotMatch(mine, /Group/)
  const group = await env.tool('list_schedules', {}, 'gb')
  assert.match(group, /Group/)
  assert.doesNotMatch(group, /Mine/)
  // Cancelling from the wrong conversation leaves the other one alone.
  assert.match(await env.tool('delete_schedule', { id: 't2' }, 'a'), /not cancelled/)
  assert.equal(env.deleted.length, 0)
  assert.match(await env.tool('delete_schedule', { id: 't1' }, 'a'), /Cancelled t1/)
  assert.deepEqual(env.deleted, [{ sessionId: 'a', id: 't1' }])
})

test('with scheduling turned off the tools say so instead of pretending', async t => {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-schedule-off-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async sessionId => ({
        agent: { id: sessionId, session: { id: sessionId }, followup() {}, steer() {}, cancel() {} },
      }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  t.after(() => {
    void ctx.dispose().then(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }))
  })
  const answer = await ctx.registeredTools
    .get('create_schedule')
    .execute({ title: 'X', prompt: 'Y', when: 'every', minutes: '5' }, { agent: { id: 'a' }, callId: 'c1' })
  assert.match(answer, /Scheduled tasks are turned off/)
})

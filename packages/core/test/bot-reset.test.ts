// Resetting a Bot: the four parts are independent, nothing runs unless the user picked
// something, and a part that fails says so instead of looking done.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

const TEAM = {
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: {
      id: 'b',
      name: 'Writer',
      role: 'Write',
      sessionId: 'b',
      createdAt: 2,
      instructions: 'Write the copy',
      model: 'deepseek/v4',
      permission: 'read-only',
      workDir: '/tmp/somewhere',
      avatar: { shape: 'cat' },
    },
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
}

function start(t) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-reset-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const ctx = fakeContext()
  const cleared = []
  const memories = []
  const archived = []
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async id => {
        archived.push(id)
      },
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
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = options => {
    route = options
    return register(options)
  }
  const runtime = createRuntime(ctx, { home })
  runtime.clearSessionHistory = sessionId => {
    cleared.push(sessionId)
  }
  runtime.clearBotMemory = async botId => {
    memories.push(botId)
  }
  runtime.startFreshPart = async sessionId => {
    cleared.push(`fresh:${sessionId}`)
  }
  const call = async (endpoint, payload) =>
    (
      await route.fetch(
        new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }),
      )
    ).json()
  t.after(() => {
    void ctx.dispose().then(() => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }))
  })
  return { runtime, call, cleared, memories, archived, state: () => runtime.state }
}

test('memory only is the default shape: it clears what the Bot knows and nothing else', async t => {
  const env = start(t)
  const answer = await env.call('reset-bot', { id: 'b', memory: true })
  assert.equal(answer.ok, true)
  assert.deepEqual(answer.value.done, ['memory'])
  assert.deepEqual(env.memories, ['b'])
  // Nothing else moved: no transcript cleared, no settings touched.
  assert.deepEqual(env.cleared, [])
  assert.equal(env.state().bots.b.role, 'Write')
  assert.equal(env.state().bots.b.instructions, 'Write the copy')
})

test('the parts compose, and each one does only its own work', async t => {
  const env = start(t)
  const answer = await env.call('reset-bot', { id: 'b', memory: true, conversation: true, history: true })
  assert.equal(answer.ok, true)
  assert.deepEqual([...answer.value.done].sort(), ['conversation', 'history', 'memory'])
  assert.deepEqual(env.memories, ['b'])
  // Both the Bot's own chat and its group Session are covered by history and by a restart.
  assert.ok(env.cleared.includes('b'))
  assert.ok(env.cleared.includes('gb'))
  // The identity is untouched when it was not picked.
  assert.equal(env.state().bots.b.instructions, 'Write the copy')
})

test('restoring the defaults clears the settings but keeps the name and the groups', async t => {
  const env = start(t)
  const answer = await env.call('reset-bot', { id: 'b', identity: true })
  assert.equal(answer.ok, true)
  const bot = env.state().bots.b
  assert.equal(bot.name, 'Writer', "the name is the user's, not a default to overwrite")
  assert.equal(bot.role, undefined)
  assert.equal(bot.instructions, undefined)
  assert.equal(bot.model, undefined)
  assert.equal(bot.permission, undefined)
  assert.equal(bot.workDir, undefined)
  assert.equal(bot.avatar, undefined)
  // It is still in its group, still the same Bot.
  assert.deepEqual(env.state().rooms.r1.members, ['a', 'b'])
  assert.equal(env.state().bots.b.id, 'b')
})

test('a reset with nothing picked is refused instead of guessing', async t => {
  const env = start(t)
  const answer = await env.call('reset-bot', { id: 'b' })
  assert.equal(answer.ok, false)
  assert.match(JSON.stringify(answer), /Pick at least one thing to reset/)
  assert.deepEqual(env.memories, [])
  assert.deepEqual(env.cleared, [])
})

test('an unknown Bot is refused', async t => {
  const env = start(t)
  const answer = await env.call('reset-bot', { id: 'nobody', memory: true })
  assert.equal(answer.ok, false)
  assert.match(JSON.stringify(answer), /Unknown Bot/)
})

test('a part that cannot run is reported by name, and the others still go through', async t => {
  const env = start(t)
  env.runtime.clearBotMemory = async () => {
    throw new Error('Memory is turned off on this host')
  }
  const answer = await env.call('reset-bot', { id: 'b', memory: true, history: true })
  assert.equal(answer.ok, true)
  assert.deepEqual(answer.value.done, ['history'])
  assert.equal(answer.value.failed.length, 1)
  assert.equal(answer.value.failed[0].part, 'memory')
  assert.match(answer.value.failed[0].reason, /turned off/)
})

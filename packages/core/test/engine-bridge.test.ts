// The engine bridge against the real host (plan §阶段 2): the full plugin runs with
// engine-backed agents instead of DSH sessions, and a group round completes through the
// ordinary session/event route — the 对照 anchor the plan asks for, with DSH still in
// place for the classic path.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.ts'
import { BuiltinRuntime } from '../src/engine/builtin/runtime.ts'
import { engineAgentOf, type BridgeAgent } from '../src/engine/builtin/bridge.ts'
import type { EngineEvent } from '../src/engine/events.ts'
import type { EngineServices } from '../src/engine/builtin/services.ts'
import { openStore } from '../src/store/db.ts'
import { sqliteTranscriptOf } from '../src/engine/builtin/transcript.ts'
import type { SessionsLike } from '../src/engine/builtin/transcript.ts'

// A scripted OpenAI-compatible endpoint: replies in order, no key needed.
const openaiMock = () => {
  const requests: { body: { messages?: { role: string; content: unknown }[] } }[] = []
  let script: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      requests.push({ body })
      const text = script.shift() ?? 'ok'
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: Record<string, unknown>) =>
        res.write(
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        )
      send({ role: 'assistant', content: '' })
      send({ content: text })
      res.write(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return {
    requests,
    reply(...texts: string[]) {
      script.push(...texts)
    },
    listen: () =>
      new Promise<{ port: number }>(resolve =>
        server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port })),
      ),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

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
      admin: 'b',
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

test('a group round completes through the engine: delivery, turn events, group reply', async t => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-bridge-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const store = openStore(home)
  store.sessions.upsertSession({ id: 'gb', kind: 'group', ownerId: 'r1' })

  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'You are Moon Bot.', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: sqliteTranscriptOf(store.sessions as unknown as SessionsLike),
    toolsFor: () => [],
    definitions: [],
  }
  // One fanout for the engine and the bridge, as the service wires them.
  const engine = new BuiltinRuntime({ services, emit: (sessionId, event) => emitEvent(sessionId, event) })

  const ctx = fakeContext()
  t.after(async () => {
    await ctx.dispose()
    store.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })

  const agents = new Map<string, BridgeAgent>()
  let seq = 0
  const emitEvent = (sessionId: string, event: EngineEvent): void => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2)
        listener({ id: sessionId }, { type: event.type, seq: ++seq, data: event as { type: string } })
    }
  }
  const agentOf = (sessionId: string): BridgeAgent => {
    let agent = agents.get(sessionId)
    if (agent === undefined) agents.set(sessionId, (agent = engineAgentOf(sessionId, { runtime: engine, emitEvent })))
    return agent
  }
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
      resolveAgent: async sessionId => ({ agent: agentOf(sessionId) }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  const tool = (name: string, args: Record<string, unknown>, sessionId: string, exec: Record<string, unknown> = {}) =>
    ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec })

  // The round: the admin's relay opens Writer's group turn; the engine answers it.
  mock.reply('The plan is drafted and ready.')
  let result: { replies?: { kind: string; name: string; text?: string }[] } | undefined
  const stop = new AbortController()
  t.after(() => stop.abort())
  void tool('group_relay', {}, 'r1', { callId: 'c1', signal: stop.signal }).then((value: unknown) => {
    result = JSON.parse(String(value))
  })
  // Wait for Writer's delivery to land and its engine turn to finish.
  const until = Date.now() + 10000
  while (result === undefined && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(result, 'the relay round finished')
  assert.deepEqual(
    result.replies?.map(reply => [reply.kind, reply.name]),
    [[undefined, 'Writer']],
  )
  assert.match(String(result.replies?.[0]?.text), /The plan is drafted/)

  // The trigger the engine's turn answered is the group delivery, with its source.
  const trigger = agentOf('gb').calls[0]
  const triggerText = (trigger?.content ?? [])
    .map(block => (block.type === 'text' ? String((block as { text?: unknown }).text ?? '') : ''))
    .join('')
  assert.match(triggerText, /^\[Group chat "Ops"/)
  assert.equal(trigger?.source?.role, 'room')

  // The group turn is in SQLite: the trigger and the engine's answer.
  const rows = store.sessions.page('gb', 10)
  assert.match(JSON.stringify(rows), /The plan is drafted/)
})

test('a request between Bots round-trips through the engine and is recorded as an exchange', async t => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-bridge-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'You are Moon Bot.', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: {
      async history() {
        return []
      },
      async append() {},
    },
    toolsFor: () => [],
    definitions: [],
  }
  // One fanout for the engine and the bridge, as the service wires them.
  const engine = new BuiltinRuntime({ services, emit: (sessionId, event) => emitEvent(sessionId, event) })
  const ctx = fakeContext()

  const agents = new Map<string, BridgeAgent>()
  let seq = 0
  const emitEvent = (sessionId: string, event: EngineEvent): void => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2)
        listener({ id: sessionId }, { type: event.type, seq: ++seq, data: event as { type: string } })
    }
  }
  const agentOf = (sessionId: string): BridgeAgent => {
    let agent = agents.get(sessionId)
    if (agent === undefined) agents.set(sessionId, (agent = engineAgentOf(sessionId, { runtime: engine, emitEvent })))
    return agent
  }
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
      resolveAgent: async sessionId => ({ agent: agentOf(sessionId) }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  const tool = (name: string, args: Record<string, unknown>, sessionId: string, exec: Record<string, unknown> = {}) =>
    ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec })

  // Chief asks Writer; Writer's engine turn answers; Chief reads the reply.
  mock.reply('Draft is done: three sections.')
  let delivered: unknown[] = []
  ;(agentOf('a') as BridgeAgent & { calls: unknown[] }).calls.push = (...items: unknown[]) => {
    delivered = [...delivered, ...items]
    return items.length
  }
  await tool('message_bot', { to: 'Writer', message: 'Draft the plan' }, 'a')
  const until = Date.now() + 10000
  while (!delivered.some(item => String(JSON.stringify(item)).includes('Draft is done')) && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const reply = delivered.find(item => String(JSON.stringify(item)).includes('Draft is done'))
  assert.ok(reply, 'Chief received the engine turn\u2019s reply')
  assert.match(String(JSON.stringify(reply)), /\[Reply from Writer\]/)
})

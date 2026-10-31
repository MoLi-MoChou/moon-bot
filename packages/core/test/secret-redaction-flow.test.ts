import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { sqliteTranscriptOf } from '../src/engine/builtin/transcript.ts'
import { fakeContext } from './fake-ctx.ts'

const fresh = () => `flow-${randomBytes(16).toString('hex')}`

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: {
      id: 'm1',
      sessionId: 'm1',
      name: 'Chief',
      role: 'Chief of Staff',
      lab: 'deepseek',
      instructions: '',
      createdAt: 1,
    },
    b2: {
      id: 'b2',
      sessionId: 'b2',
      name: 'Writer',
      role: 'writing',
      lab: 'kimi',
      instructions: '',
      createdAt: 2,
    },
  },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

function start(value?: string) {
  const home = mkdtempSync(join(tmpdir(), 'moon-bot-redaction-flow-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  if (value !== undefined)
    writeFileSync(
      join(home, 'secrets.json'),
      JSON.stringify({
        version: 1,
        secrets: [{ name: 'FLOW_TOKEN', value, scope: 'all', createdAt: 1, updatedAt: 1 }],
      }),
    )
  const contributors: { live: boolean; resolve: (input: unknown) => unknown }[] = []
  const shellEnv = {
    register(contributor: { resolve: (input: unknown) => unknown }) {
      const entry = { ...contributor, live: true }
      contributors.push(entry)
      return () => {
        entry.live = false
      }
    },
  }
  const ctx = fakeContext({ services: { shellEnv } })
  const listeners: Record<string, ((payload: unknown, next?: unknown) => unknown)[]> = {}
  const on = ctx.on
  ctx.on = (name, listener, options) => {
    ;(listeners[name] ??= []).push(listener)
    return on(name, listener, options)
  }
  let route: { fetch(request: Request): Promise<Response> } | undefined
  ctx.connection.fetch.register = options => {
    route = options
    return () => {}
  }
  const call = async (endpoint: string, payload: unknown) => {
    const response = await route!.fetch(
      new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }),
    )
    return response.json()
  }
  const streamed: unknown[] = []
  ctx.llm.stream = (options: unknown) => {
    streamed.push(options)
    return (async function* () {})()
  }
  ctx.sessionController = {
    resolveAgent: async () => ({ agent: { session: {} } }),
  }
  ctx.sessions = { flush: async () => {} }
  ctx.workspaceRegistry = { archiveSession: async () => {} }
  apply(ctx, { home })
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, home, call, listeners, streamed, contributors, stop }
}

test('tools/execute middleware removes a secret from success and error results', async t => {
  const value = fresh()
  const bench = start()
  t.after(bench.stop)
  await bench.call('secret-set', { name: 'FLOW_TOKEN', value })
  await bench.ctx.loadSecrets?.()
  const setSecret = bench.listeners['secret-set']?.[0]
  assert.equal(setSecret, undefined, 'secret-set is an HTTP route, not event middleware')
  const toolMiddleware = bench.listeners['tools/execute'].at(-1)
  assert.ok(toolMiddleware)

  // The redaction listener reads secrets.json during host initialization.
  const clean = await toolMiddleware!({}, async () => ({
    isError: false,
    value: { stdout: value, nested: { text: value } },
    content: [{ type: 'text', text: value }],
    meta: { value },
  }))
  assert.equal(JSON.stringify(clean).includes(value), false)

  const failed = await toolMiddleware!({}, async () => ({
    isError: true,
    error: { message: `failed: ${value}` },
    content: [{ type: 'text', text: `failed: ${value}` }],
  }))
  assert.equal(JSON.stringify(failed).includes(value), false)
})

test('llm/stream rewrite sends no secret value to the provider', async t => {
  const value = fresh()
  const bench = start()
  t.after(bench.stop)
  await bench.call('secret-set', { name: 'FLOW_TOKEN', value })
  await bench.ctx.loadSecrets?.()
  const streamMiddleware = bench.listeners['llm/stream'].at(-2)
  assert.ok(streamMiddleware)
  const options = {
    provider: 'mock',
    model: 'test',
    sessionId: 'b2',
    system: `system ${value}`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `user ${value}` }] }],
  }
  const next = () => {
    throw new Error('redaction middleware should rewrite before next')
  }
  await streamMiddleware!(options, next)
  const sent = bench.streamed.at(-1)
  assert.ok(sent)
  assert.equal(JSON.stringify(sent).includes(value), false)
  assert.equal(JSON.stringify(options).includes(value), true)
})

test('sqliteTranscriptOf must not write secret values through the sessions writer', async () => {
  const value = fresh()
  const appended: unknown[] = []
  const transcript = sqliteTranscriptOf(
    {
      appendMessage(input) {
        appended.push(input)
      },
      page() {
        return []
      },
    },
    { redact: text => text.replaceAll(value, '[secret:FLOW_TOKEN]') },
  )
  await transcript.append('session-1', {
    role: 'user',
    content: [{ type: 'text', text: value }],
    turn: 1,
    at: Date.now(),
  })
  assert.equal(JSON.stringify(appended).includes(value), false)
})

test('sqliteTranscriptOf reconstructs stored messages through the same adapter', async () => {
  const value = fresh()
  const rows = [
    {
      role: 'assistant' as const,
      content: [{ type: 'text', text: value }],
      stopReason: null,
      turn: 2,
      source: { note: value },
      raw: { payload: value },
      createdAt: 4,
    },
  ]
  const transcript = sqliteTranscriptOf(
    {
      appendMessage() {},
      page() {
        return rows
      },
    },
    { redact: text => text.replaceAll(value, '[secret:FLOW_TOKEN]') },
  )
  assert.deepEqual(await transcript.history('session-1'), [
    {
      role: 'assistant',
      content: [{ type: 'text', text: '[secret:FLOW_TOKEN]' }],
      source: { note: '[secret:FLOW_TOKEN]' },
      raw: { payload: '[secret:FLOW_TOKEN]' },
      turn: 2,
      at: 4,
    },
  ])
})

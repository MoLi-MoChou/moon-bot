import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { COMPACT_REASONS, createContextCompact } from '../src/host/context-compact.ts'
import type { CompactDeps } from '../src/host/context-compact.ts'
import { fakeContext } from './fake-ctx.ts'

const LINES = { window: 1000, usable: 800, hard: 760, check: 640 }

function deps(over: Partial<CompactDeps> = {}): CompactDeps & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    readOnly: () => false,
    running: () => false,
    unread: () => false,
    switching: () => false,
    resolve: async () => { calls.push('resolve'); return { id: 's', session: { id: 's' } } as never },
    lines: async () => LINES,
    prepare: () => { calls.push('prepare') },
    engine: () => true,
    condense: async () => { calls.push('condense'); return true },
    ...over,
  }
}

test('a running turn, an unread delivery, or a move is refused before any condense', async () => {
  for (const [gate, reason] of [
    ['running', COMPACT_REASONS.running],
    ['unread', COMPACT_REASONS.unread],
    ['switching', COMPACT_REASONS.switching],
    ['readOnly', COMPACT_REASONS.readonly],
  ] as const) {
    const input = deps({ [gate]: () => true })
    assert.deepEqual(await createContextCompact(input)('s'), { compacted: false, reason })
    assert.deepEqual(input.calls, [])
  }
})

test('no engine and a condense that does not make room never claim success', async () => {
  const missing = deps({ engine: () => false })
  assert.deepEqual(await createContextCompact(missing)('s'), { compacted: false, reason: COMPACT_REASONS['no-engine'] })
  assert.deepEqual(missing.calls, ['resolve', 'prepare'])

  const unchanged = deps({ condense: async () => false })
  assert.deepEqual(await createContextCompact(unchanged)('s'), { compacted: false, reason: COMPACT_REASONS.unchanged })
  const busy = deps({ condense: async () => undefined })
  assert.deepEqual(await createContextCompact(busy)('s'), { compacted: false, reason: COMPACT_REASONS.busy })
})

test('a second ask while the first is still condensing is refused', async () => {
  let release: (value: boolean) => void = () => {}
  const gate = new Promise<boolean>(resolve => { release = resolve })
  let started = false
  const input = deps({
    condense: () => { started = true; return gate },
  })
  const compact = createContextCompact(input)
  const first = compact('s')
  // The first ask reaches condense on a later turn; the second must see it in flight.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, true)
  assert.deepEqual(await compact('s'), { compacted: false, reason: COMPACT_REASONS.busy })
  release(true)
  assert.deepEqual(await first, { compacted: true })
})

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', sessionId: 'm1c', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
  },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

function start(compaction?: { compactNow: () => Promise<unknown> }) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-compact-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const services: Record<string, unknown> = {
    tokenMeter: { measure: () => ({ totalTokens: 10 }) },
  }
  if (compaction !== undefined) services.compaction = { summarize() {}, compactIfNeeded: async () => null, compactNow: compaction.compactNow, compactRegion: async () => {} }
  const ctx = fakeContext({ services })
  ctx.sessionController = {
    resolveAgent: async (sessionId: string) => ({ agent: { id: sessionId, session: { id: sessionId, seq: 2 } } }),
  }
  const routes: Record<string, { fetch: (request: Request) => Promise<Response> }> = {}
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options: { path: string, fetch: (request: Request) => Promise<Response> }) => {
    routes[options.path] = options
    return register(options)
  }
  const rt = createRuntime(ctx, { home }) as {
    live: Map<string, { turn?: unknown }>
    unreadOf: (sessionId: string) => readonly unknown[]
  }
  const call = async (endpoint: string, payload?: unknown) => {
    const response = await routes['/api/bot']!.fetch(new Request('http://localhost/api/bot', {
      method: 'POST', body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json() as Promise<{ ok: boolean, value?: { compacted?: boolean, reason?: string }, error?: { code?: string } }>
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { rt, call, stop }
}

test('the endpoint refuses a running turn and an unread delivery without condensing', async (t) => {
  let condensed = 0
  const { rt, call, stop } = start({ compactNow: async () => { condensed += 1; return {} } })
  t.after(stop)
  await call('state')
  rt.live.set('m1c', { turn: true })
  const running = await call('context-compact', { botId: 'm1' })
  assert.equal(running.value?.reason, COMPACT_REASONS.running)
  rt.live.delete('m1c')
  rt.unreadOf = () => [{ to: 'm1', text: 'still waiting' }]
  const unread = await call('context-compact', { botId: 'm1' })
  assert.equal(unread.value?.reason, COMPACT_REASONS.unread)
  assert.equal(condensed, 0)
  assert.equal((await call('context-compact', { botId: 'nobody' })).error?.code, 'bot/not-found')
})

test('without a compaction engine the endpoint says so, and with one it condenses in place', async (t) => {
  const bare = start()
  t.after(bare.stop)
  await bare.call('state')
  const refused = await bare.call('context-compact', { botId: 'm1' })
  assert.deepEqual(refused.value, { compacted: false, reason: COMPACT_REASONS['no-engine'] })

  let condensed = 0
  const wired = start({ compactNow: async () => { condensed += 1; return {} } })
  t.after(wired.stop)
  await wired.call('state')
  const done = await wired.call('context-compact', { botId: 'm1' })
  assert.deepEqual(done.value, { compacted: true })
  assert.equal(condensed, 1)
})

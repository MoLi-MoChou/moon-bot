// A message the chat accepted shows its Bot working from that moment on, before the
// engine has said anything: the window drew no work at all for a slow or failing model,
// which read as a frozen app. The turn's own events then take over, and a failed turn
// clears the mark like any other end.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

// Chief in its own chat 'a', with a model route the fake llm knows.
const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', model: 'custom/mock-1', createdAt: 1 } },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
})

interface TestRuntime {
  readonly live: Map<string, { readonly sentAt?: number | undefined }>
  /** Per Bot, the turn it runs or the send it has accepted: keyed by Bot id. */
  workView(): Record<string, { readonly since?: number | undefined }>
  turnsView(): Record<string, number>
  liveChanged?: () => void
}

// One host over a temp home; `send` goes through the channel route the window uses, and
// the engine's events are fed in by hand the way the fanout would.
function start(t: { after: (fn: () => void) => void }, prompt: () => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-sent-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async (path: string) => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async (sessionId: string) => ({ agent: { session: { id: sessionId }, followup() {}, steer() {}, cancel() {}, inbox: { nextStep: [], nextTurn: [], remove: () => false } } }),
      selectModel: async () => {},
      prompt,
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route: { fetch: (request: Request) => Promise<Response> } | undefined
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options: { fetch: (request: Request) => Promise<Response> }) => {
    route = options
    return register(options)
  }
  const rt = createRuntime(ctx as never, { home }) as unknown as TestRuntime
  // The host's effects settle before its home goes away, or a late write recreates it.
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  let seq = 0
  const emit = (id: string, type: string, data: unknown): void => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2) listener({ id }, { type, seq: (seq += 1), data })
    }
  }
  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    assert.ok(route !== undefined, 'the channel route is installed')
    return (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  }
  return { rt, ctx, call, emit, home }
}

test('a send marks the Bot working at once, and the turn takes the mark over', async (t) => {
  // The engine never starts a turn here: only the accepted message moves the view.
  const { rt, call, emit } = start(t, async () => {})
  const notices: number[] = []
  rt.liveChanged = () => notices.push(Date.now())

  const sent = await call('send', { sessionId: 'a', text: 'start the launch' })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  // Working already, before turn/start: the window has something to draw from the send on.
  assert.deepEqual(Object.keys(rt.workView()), ['a'])
  assert.equal(typeof rt.workView().a?.since, 'number')
  assert.equal(typeof rt.turnsView().a, 'number')
  assert.equal(notices.length, 1, 'the feed is asked to refresh')

  emit('a', 'turn/start', { turn: 1 })
  assert.equal(rt.live.get('a')?.sentAt, undefined, 'the turn replaced the send mark')
  assert.equal(typeof rt.workView().a?.since, 'number', 'still working while the turn runs')

  emit('a', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.deepEqual(rt.workView(), {})
  assert.deepEqual(rt.turnsView(), {})
})

test('a send the engine turned away is not left looking like work', async (t) => {
  const { rt, call } = start(t, async () => { throw new Error('the session is gone') })
  const sent = await call('send', { sessionId: 'a', text: 'start the launch' })
  assert.notEqual(sent.ok, true)
  assert.deepEqual(rt.workView(), {})
})

test('a failed turn ends the work like a finished one', async (t) => {
  const { rt, call, emit } = start(t, async () => {})
  await call('send', { sessionId: 'a', text: 'start the launch' })
  emit('a', 'turn/start', { turn: 1 })
  emit('a', 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'Connection error.' } } })
  assert.deepEqual(rt.workView(), {})
})

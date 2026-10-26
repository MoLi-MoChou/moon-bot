// Loop boundary contracts, frozen while DSH still runs the loop (plan
// docs/plans/2026-10-24-standalone-personal-agent.md §阶段 0). Whatever engine replaces
// it must keep these observable behaviors at the session/event boundary:
//   - a tool call whose result never arrives (timeout, crash) leaves nothing stuck;
//   - the same events replayed (a reconnect, a restart double-read) charge nothing twice;
//   - a turn that answers a request is marked once however its events repeat;
//   - a stream interrupted mid-turn surfaces as aborted, not as a hang.
// The engine-side halves of these contracts (what event sequences a loop produces)
// are pinned by test/pi-proto.test.js against the pi kernel.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

async function start(home) {
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = (sessionId) => {
    if (!agents.has(sessionId)) {
      const calls = []
      const inbox = { nextStep: [], nextTurn: [], remove: () => false }
      const keep = (message) => { calls.push(message) }
      agents.set(sessionId, { session: { id: sessionId }, calls, inbox, followup: keep, steer: keep, cancel() {} })
    }
    return agents.get(sessionId)
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: agentOf(sessionId) }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  let seq = 0
  const emit = (id, type, data) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2) listener({ id }, { type, seq: ++seq, data })
    }
  }
  const tool = (name, args, sessionId, exec = {}) => ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec })
  await tool('list_bots', {}, 'a')
  const call = async (endpoint, payload = {}) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  return { ctx, agentOf, emit, tool, call, stop: () => ctx.dispose() }
}

const freshHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-loop-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  return home
}
// Stops the host and only then removes its home: resume writes may still land.
const withHost = (t, home, host) => {
  t.after(async () => {
    await host.stop()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return host
}
const settle = async (check, budget = 4000) => {
  const until = Date.now() + budget
  while (!check() && Date.now() < until) await new Promise(resolve => setImmediate(resolve))
  assert.ok(check(), 'condition not reached')
}
const text = message => message.content.map(block => block.text ?? '').join('\n')
const run = (host, sessionId, turn, message) => {
  host.emit(sessionId, 'turn/start', { turn })
  host.emit(sessionId, 'user/message', { content: message.content, source: message.source })
}

test('a tool call whose result never arrives leaves nothing stuck for the next turn', async (t) => {
  const home = freshHome()
  const host = withHost(t, home, await start(home))
  // The live view while the call runs: the Bot is doing that tool.
  run(host, 'b', 1, { content: [{ type: 'text', text: 'move the docs' }], source: { kind: 'user' } })
  host.emit('b', 'assistant/message', { message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool-call', id: 'k1', name: 'pwsh', arguments: '{}' }] } })
  host.emit('b', 'tool/call', { callId: 'k1', name: 'pwsh', arguments: '{}' })
  await settle(async () => (await host.call('state')).value.work.bots.b?.tool === 'pwsh')
  // The turn dies without a tool/result (a timeout or a crash in the loop): the live
  // view lets go of the dead call at once, so the next turn starts from a clean slate.
  host.emit('b', 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'tool timed out' } } })
  await settle(async () => (await host.call('state')).value.work.bots.b === undefined)
  // And a later turn's calls still show and clear the same way.
  host.emit('b', 'turn/start', { turn: 2 })
  host.emit('b', 'user/message', { content: [{ type: 'text', text: 'once more' }], source: { kind: 'user' } })
  host.emit('b', 'tool/call', { callId: 'k9', name: 'read', arguments: '{}' })
  await settle(async () => (await host.call('state')).value.work.bots.b?.tool === 'read')
  host.emit('b', 'tool/result', { callId: 'k9' })
  host.emit('b', 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  await settle(async () => (await host.call('state')).value.work.bots.b === undefined)
})

test('replayed events charge nothing twice: a request turn is marked once, its failure noticed once', async (t) => {
  const home = freshHome()
  const host = withHost(t, home, await start(home))
  const readTurns = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).exchangeTurns.b ?? []
  // A request from Chief opens a marked exchange turn on Writer.
  run(host, 'b', 7, { content: [{ type: 'text', text: '[Message from Chief]\nDraft' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x1', senderName: 'Chief', senderSessionId: 'a', hop: 0 } })
  await settle(() => readTurns().length === 1)
  // The same trigger replayed (a double delivery after a reconnect) is already claimed.
  host.emit('b', 'user/message', { content: [{ type: 'text', text: '[Message from Chief]\nDraft' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x1', senderName: 'Chief', senderSessionId: 'a', hop: 0 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(readTurns(), [7])
  // The turn ends in failure; the same end event replayed tells the sender once.
  const reason = { kind: 'error', error: { code: 'SERVER', status: 503, message: 'upstream busy' } }
  host.emit('b', 'turn/end', { turn: 7, reason })
  await settle(() => host.agentOf('a').followup !== undefined && host.agentOf('a').calls.length >= 1)
  const told = host.agentOf('a').calls.filter(call => text(call).includes('could not answer')).length
  host.emit('b', 'turn/end', { turn: 7, reason })
  await new Promise(resolve => setImmediate(resolve))
  const toldAgain = host.agentOf('a').calls.filter(call => text(call).includes('could not answer')).length
  assert.equal(told, 1)
  assert.equal(toldAgain, told)
})

test('a mid-turn stream interruption surfaces as an aborted end, and the waiting sender is told once', async (t) => {
  const home = freshHome()
  const host = withHost(t, home, await start(home))
  // Writer already said half of it when the stream is cut: what was said goes to the
  // sender as the answer, exactly once, and the half-said text is not lost.
  run(host, 'b', 1, { content: [{ type: 'text', text: '[Message from Chief]\nDraft' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x9', senderName: 'Chief', senderSessionId: 'a', hop: 0 } })
  host.emit('b', 'assistant/message', { message: { content: [{ type: 'text', text: 'Half of it…' }] } })
  host.emit('b', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
  await settle(() => host.agentOf('a').calls.some(call => text(call).includes('Half of it')))
  assert.equal(host.agentOf('a').calls.filter(call => text(call).includes('Half of it')).length, 1)
  // The same end replayed does not tell the sender twice.
  host.emit('b', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.agentOf('a').calls.filter(call => text(call).includes('Half of it')).length, 1)

  // Aborted before anything was said: the sender gets the stopped line, not silence.
  run(host, 'b', 2, { content: [{ type: 'text', text: '[Message from Chief]\nAgain' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x10', senderName: 'Chief', senderSessionId: 'a', hop: 0 } })
  host.emit('b', 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await settle(() => host.agentOf('a').calls.some(call => text(call).includes('was stopped before')))
  assert.equal(host.agentOf('a').calls.filter(call => text(call).includes('was stopped before')).length, 1)
})

// The remote-agents acceptance (plan 2026-10-27): a Bot whose engine is `acp-remote`
// runs its turns in an agent that dialed in over the relay — the same wire protocol as
// the local ACP child, carried by a relay connection instead of stdio. The invites,
// the registry's pairing, and a full turn (plus a replaced connection) run here
// in-process: the fake socket speaks ACP like the scripted child of acp-bot.test.ts.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { fakeContext } from './fake-ctx.ts'
import { wireService } from '../src/service/engine.ts'
import { RelayRegistry, RELAY_CLOSE_REPLACED, type RelaySocket } from '../src/service/relay.ts'
import { RelayTransport } from '../src/engine/acp/transport.ts'
import { openStore } from '../src/store/db.ts'
import { newInviteToken } from '../src/store/relay.ts'
import { FileSettings } from '../src/service/settings.ts'
import type { StandaloneLlm } from '../src/service/llm.ts'
import type { BridgeAgent } from '../src/engine/builtin/bridge.ts'

const NL = String.fromCharCode(10)

/** A relay socket whose peer is a scripted ACP agent, all in-process. */
class FakeAgentSocket implements RelaySocket {
  private readonly messageListeners: ((data: unknown) => void)[] = []
  private readonly closeListeners: ((code: number, reason: Buffer) => void)[] = []
  private readonly errorListeners: ((error: Error) => void)[] = []
  /** What the host wrote to the wire, and what the agent answered, for assertions. */
  readonly received: string[] = []
  readonly said: string[] = []
  private nextSession = 0
  closedWith: { code: number, reason: string } | undefined

  send(data: string): void {
    this.received.push(data)
    const message = JSON.parse(data) as { id?: number, method?: string, params?: { sessionId?: string, prompt?: { text?: string }[] } }
    const reply = (object: Record<string, unknown>): void => {
      const line = JSON.stringify(object)
      this.said.push(line)
      // The peer's answer arrives on the wire, as the CLI would deliver it.
      for (const listener of [...this.messageListeners]) listener(line)
    }
    if (message.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1', capabilities: {}, serverInfo: { name: 'relay-fixture', version: '1.0' } } })
    } else if (message.method === 'session/new') {
      reply({ jsonrpc: '2.0', id: message.id, result: { sessionId: `acp-${++this.nextSession}` } })
    } else if (message.method === 'session/prompt') {
      const text = (message.params?.prompt ?? []).map(block => block.text ?? '').join('')
      reply({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params?.sessionId, update: { sessionUpdate: 'agent_message', content: [{ type: 'text', text: `Relay did it: ${text.slice(0, 40)}` }] } } })
      reply({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    } else if (message.id !== undefined) {
      reply({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  }

  close(code?: number, reason?: string): void {
    if (this.closedWith !== undefined) return
    this.closedWith = { code: code ?? 0, reason: reason ?? '' }
    for (const listener of [...this.closeListeners]) listener(this.closedWith.code, Buffer.from(this.closedWith.reason))
  }

  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: string, listener: (...args: never[]) => unknown): unknown {
    if (event === 'message') this.messageListeners.push(listener as (data: unknown) => void)
    else if (event === 'close') this.closeListeners.push(listener as (code: number, reason: Buffer) => void)
    else if (event === 'error') this.errorListeners.push(listener as (error: Error) => void)
    return this
  }
}

test('invites: create, verify, revoke, re-invite, and survive a reopen', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-store-'))
  t1(home)
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

function t1(home: string): void {
  const store = openStore(home)
  const created = store.relayInvites.create('kai-laptop')
  assert.ok(created.token.length >= 32, 'the token is long')
  assert.notEqual(created.token, newInviteToken(), 'the token is random')
  assert.equal(store.relayInvites.verify(created.token), 'kai-laptop')
  assert.equal(store.relayInvites.verify('no-such-token'), undefined, 'an unknown token names nothing')
  store.close()

  const reopened = openStore(home)
  assert.equal(reopened.relayInvites.verify(created.token), 'kai-laptop', 'the invite survives a reopen')
  assert.equal(reopened.relayInvites.revoke('kai-laptop'), true)
  assert.equal(reopened.relayInvites.verify(created.token), undefined, 'a revoked token names nothing')
  const again = reopened.relayInvites.create('kai-laptop')
  assert.equal(reopened.relayInvites.verify(again.token), 'kai-laptop', 're-inviting the same id works')
  assert.notEqual(again.token, created.token, 'the re-invite is a new token')
  reopened.close()
}

test('the registry: pairing, replacement, and the relay transport over it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-reg-'))
  try {
    await t2(home)
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

async function t2(home: string): Promise<void> {
  const store = openStore(home)
  const registry = new RelayRegistry(store.relayInvites)
  const { token } = store.relayInvites.create('kai-laptop')

  assert.equal(registry.admit(new FakeAgentSocket(), 'wrong'), undefined, 'a bad token is not admitted')
  const first = new FakeAgentSocket()
  assert.equal(registry.admit(first, token), 'kai-laptop')
  assert.deepEqual(registry.online(), ['kai-laptop'])

  // The transport attaches to the admitted connection and carries the wire both ways:
  // initialize goes out, the scripted fixture answers, the line comes back.
  const transport = new RelayTransport(registry, 'kai-laptop')
  const lines: string[] = []
  transport.onLine(line => { lines.push(line) })
  await transport.open()
  transport.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}')
  assert.ok(lines.some(line => line.includes('relay-fixture')), 'initialize crossed the relay both ways')

  // A newer connection replaces the older one; the old wire closes with 4000.
  const second = new FakeAgentSocket()
  assert.equal(registry.admit(second, token), 'kai-laptop')
  assert.equal(first.closedWith?.code, RELAY_CLOSE_REPLACED, 'the replaced socket closed with 4000')

  // The transport picked the replacement up: writes go to the new wire.
  transport.write('{"jsonrpc":"2.0","id":2,"method":"ping"}')
  assert.ok(second.received.some(line => line.includes('"id":2')), 'the replacement carries the write')
  assert.ok(!first.received.some(line => line.includes('"id":2')), 'the replaced wire is done')

  // Revoking cuts the live connection.
  registry.inviteRevoke('kai-laptop')
  assert.equal(second.closedWith?.code, 4403, 'the revoked agent was disconnected')
  assert.equal(registry.connect('kai-laptop'), undefined, 'nothing to connect to anymore')
  store.close()
}

interface Host {
  ctx: ReturnType<typeof fakeContext>
  tool(name: string, args: Record<string, unknown>, sessionId: string, exec?: Record<string, unknown>): Promise<unknown>
  agentOf(sessionId: string): BridgeAgent
}

async function startRemote(t: { after: (run: () => Promise<void> | void) => void }): Promise<{ host: Host, relay: RelayRegistry, token: string }> {
  const home = mkdtempSync(join(tmpdir(), 'relay-e2e-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1,
    mainBotIds: ['a'],
    bots: {
      a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'custom/mock-1' },
      b: { id: 'b', name: 'Atlas', role: 'Work', sessionId: 'b', createdAt: 2, engine: { kind: 'acp-remote' as const, agentId: 'kai-laptop' } },
    },
    rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'b', named: true, sessions: { b: 'gb' }, log: [], seq: 0, seen: {} } },
    agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
  }))

  // The built-in Chief runs on a scripted endpoint; the remote Bot never touches it.
  const mock = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: Record<string, unknown>): void => {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] })}${NL}${NL}`)
      }
      send({ role: 'assistant', content: '' })
      send({ content: 'From the built-in Chief.' })
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}${NL}${NL}`)
      res.write(`data: [DONE]${NL}${NL}`)
      res.end()
    })
  })
  const mockPort = await new Promise<number>(resolve => mock.listen(0, '127.0.0.1', () => resolve((mock.address() as { port: number }).port)))
  t.after(() => new Promise<void>(resolve => mock.close(() => resolve())))
  const mockUrl = `http://127.0.0.1:${mockPort}/v1`

  const settings = new FileSettings(home)
  const llm = {
    resolveRoute: async (provider: string) => provider === 'custom'
      ? { provider, api: 'openai-completions' as const, baseUrl: mockUrl, apiKey: 'sk', models: [{ id: 'mock-1' }] }
      : undefined,
  } as unknown as StandaloneLlm
  const wired = wireService({ home, llm, services: { settings } })

  const ctx = wired.context as unknown as ReturnType<typeof fakeContext>
  const agents = new Map<string, BridgeAgent>()
  const agentOf = (sessionId: string): BridgeAgent => {
    let agent = agents.get(sessionId)
    if (agent === undefined) agents.set(sessionId, agent = wired.agentOf(sessionId) as BridgeAgent)
    return agent
  }
  await (wired.runtime as unknown as { load(): Promise<unknown> }).load()
  const tool = (name: string, args: Record<string, unknown>, sessionId: string, exec: Record<string, unknown> = {}) =>
    ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec }) as Promise<unknown>
  t.after(async () => {
    await ctx.dispose()
    await wired.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })

  const { token } = wired.relay.inviteCreate('kai-laptop')
  return { host: { ctx, tool, agentOf }, relay: wired.relay, token }
}

test('a remote agent as a full Bot: a turn over the relay, then a replaced connection', async (t) => {
  const { host, relay, token } = await startRemote(t)
  const agent = new FakeAgentSocket()
  assert.equal(relay.admit(agent, token), 'kai-laptop')

  // Assigned work: Chief hands Atlas a task; the remote agent's answer comes back.
  const delivered: unknown[] = []
  const chief = host.agentOf('a')
  const originalPush = chief.calls.push.bind(chief.calls)
  chief.calls.push = (...items: unknown[]): number => {
    delivered.push(...items)
    return originalPush(...items)
  }
  await host.tool('message_bot', { to: 'Atlas', message: 'clean the pipeline logs' }, 'a')
  const untilReply = Date.now() + 20000
  while (!delivered.some(item => String(JSON.stringify(item)).includes('Relay did it')) && Date.now() < untilReply) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const answer = delivered.find(item => String(JSON.stringify(item)).includes('Relay did it'))
  assert.ok(answer, 'Chief received the remote agent\u2019s answer')
  assert.match(String(JSON.stringify(answer)), /\[Reply from Atlas\]/)

  // A newer CLI run takes the agentId over; the next piece of work still answers.
  const replacement = new FakeAgentSocket()
  assert.equal(relay.admit(replacement, token), 'kai-laptop')
  assert.equal(agent.closedWith?.code, RELAY_CLOSE_REPLACED)
  delivered.length = 0
  await host.tool('message_bot', { to: 'Atlas', message: 'rotate the keys' }, 'a')
  const untilSecond = Date.now() + 20000
  while (!delivered.some(item => String(JSON.stringify(item)).includes('Relay did it')) && Date.now() < untilSecond) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(delivered.some(item => String(JSON.stringify(item)).includes('Relay did it')), 'the replacement agent answered the next task')
})

// A failed turn is visible in the standalone stack: the chat gets one error line naming
// the reason, the user's own message stays in the transcript, and the Bot reads as
// working from the send on. Before this, a model that refused the key, could not be
// reached or was never configured left the window with the user's bubble and nothing
// else — the bug this file holds shut.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FileSettings } from '../src/service/settings.ts'
import { PI_AI_NS } from '../src/service/llm.ts'
import { startService, type StandaloneService } from '../src/service/server.ts'

type Call = (endpoint: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
interface FeedEvent {
  readonly event: string
  readonly data: Record<string, unknown>
}

// One HTTP endpoint the model call lands on: a refusal, or an answer after `delayMs`.
const endpoint = async (options: {
  readonly status?: number
  readonly body?: string
  readonly delayMs?: number
  readonly reply?: string
}) => {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (options.status !== undefined) {
        res.writeHead(options.status, { 'content-type': 'application/json' })
        res.end(options.body ?? '{}')
        return
      }
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const send = (delta: Record<string, unknown>) =>
          res.write(
            `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
          )
        send({ role: 'assistant', content: '' })
        send({ content: options.reply ?? '好了。' })
        res.write(
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
        )
        res.write('data: [DONE]\n\n')
        res.end()
      }, options.delayMs ?? 0)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const stateFile = {
  version: 1,
  mainBotIds: ['a'],
  bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', model: 'custom/mock-1', createdAt: 1 } },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
}

// A service over a fresh home, its feed events collected from the start.
async function start(
  t: { after: (fn: () => void | Promise<void>) => void },
  provider: string | undefined,
): Promise<{ service: StandaloneService; call: Call; feed: FeedEvent[] }> {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-visible-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(stateFile))
  if (provider !== undefined) {
    await new FileSettings(home).mutate(PI_AI_NS, [
      {
        op: 'set',
        path: ['providers', 'custom'],
        value: { api: 'openai-completions', baseURL: provider, models: [{ id: 'mock-1' }] },
      },
    ])
  }
  const service = await startService({ home })
  t.after(() => service.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const feed: FeedEvent[] = []
  const abort = new AbortController()
  t.after(() => abort.abort())
  const response = await fetch(`${service.url}/api/bot/feed`, { signal: abort.signal })
  const reader = response.body!.getReader()
  void (async (): Promise<void> => {
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const kind = /^event: (.+)$/m.exec(block)?.[1] ?? 'message'
        const data = /^data: (.+)$/m.exec(block)?.[1]
        if (data !== undefined) feed.push({ event: kind, data: JSON.parse(data) as Record<string, unknown> })
      }
    }
  })().catch(() => {
    /* the aborted feed closes the reader */
  })
  const call: Call = async (endpoint, payload) =>
    (
      await fetch(`${service.url}/api/bot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      })
    ).json() as Promise<Record<string, unknown>>
  return { service, call, feed }
}

const settle = async (check: () => boolean, budget = 15_000): Promise<void> => {
  const until = Date.now() + budget
  while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(check(), 'the condition was not reached')
}

const chatItems = async (call: Call): Promise<{ kind: string; text?: string; code?: string }[]> => {
  const chat = await call('chat', { botId: 'a' })
  assert.equal(chat.ok, true, JSON.stringify(chat))
  return (chat.value as { items?: { kind: string; text?: string; code?: string }[] } | undefined)?.items ?? []
}

test('a refused key leaves one error line in the chat, and the sent message', async t => {
  const server = await endpoint({
    status: 401,
    body: JSON.stringify({ error: { message: 'invalid api key sk-test-123456' } }),
  })
  t.after(() => void server.close())
  const { call, feed } = await start(t, server.url)

  const sent = await call('send', { sessionId: 'a', text: 'start the launch' })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  await settle(() =>
    feed.some(
      entry => entry.event === 'message' && (entry.data.item as { kind?: string } | undefined)?.kind === 'error',
    ),
  )

  // The live feed showed the failure while it happened...
  const live = feed.find(
    entry => entry.event === 'message' && (entry.data.item as { kind?: string } | undefined)?.kind === 'error',
  )
  const liveItem = live?.data.item as { kind?: string; code?: string; text?: string } | undefined
  assert.deepEqual([liveItem?.kind, liveItem?.code, liveItem?.text], ['error', 'AUTH', undefined])
  // ...and the window's own history has it after a reload.
  assert.deepEqual(
    (await chatItems(call)).map(item => [item.kind, item.code, item.text]),
    [
      ['user', undefined, 'start the launch'],
      ['error', 'AUTH', undefined],
    ],
  )
})

test('a Bot whose route is not set up says exactly that', async t => {
  const { call, feed } = await start(t, undefined)
  await call('send', { sessionId: 'a', text: 'start the launch' })
  await settle(() => feed.some(entry => (entry.data.item as { kind?: string } | undefined)?.kind === 'error'))
  const items = await chatItems(call)
  assert.deepEqual(
    items.map(item => [item.kind, item.code]),
    [
      ['user', undefined],
      ['error', 'NO-MODEL'],
    ],
  )
  // The window was told the Bot stopped working, rather than left drawing it as such.
  await settle(() => feed.some(entry => entry.event === 'live'))
})

test('the sent message reads as work before the model answers', async t => {
  const server = await endpoint({ delayMs: 700, reply: 'At your service.' })
  t.after(() => void server.close())
  const { call, feed } = await start(t, server.url)

  await call('send', { sessionId: 'a', text: 'start the launch' })
  // Before the reply lands: the Bot is working, and the chat has no answer yet.
  const state = await call('state', {})
  const work = (state.value as { work?: { bots?: Record<string, { since?: number }> } } | undefined)?.work?.bots ?? {}
  assert.equal(typeof work.a?.since, 'number', JSON.stringify(state))
  // The live frame travels over the SSE connection, so it is not in the buffer the instant
  // send answers; wait for the barrier instead of racing the socket (CI lost that race).
  await settle(() => feed.some(entry => entry.event === 'live'))
  assert.ok(
    feed.some(entry => entry.event === 'live'),
    'the window is told to read the live figures',
  )

  await settle(() =>
    feed.some(entry => entry.event === 'message' && (entry.data.item as { kind?: string } | undefined)?.kind === 'bot'),
  )
  const done = await call('state', {})
  assert.deepEqual((done.value as { work?: { bots?: Record<string, unknown> } } | undefined)?.work?.bots, {})
})

// A group chat's own Session runs the relay, not a member's work; it matches no Bot. It used
// to resolve no model, so the engine ended every round as NO-MODEL before the relay could
// run, and a group never answered. The room now borrows its admin's model, or its first
// member's. This asserts the resolution directly: it is the condition that failed, and it
// does not wait on a running turn to observe it.
test("a group chat's own Session resolves the model its admin uses", async t => {
  const server = await endpoint({ reply: 'noticed.' })
  t.after(() => void server.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-room-model-'))
  writeFileSync(
    join(home, 'state.json'),
    JSON.stringify({
      ...stateFile,
      bots: {
        a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', model: 'custom/mock-1', createdAt: 1 },
        b: { id: 'b', name: 'Writer', role: 'Writer', sessionId: 'b', model: 'custom/mock-1', createdAt: 2 },
      },
      rooms: {
        r1: {
          id: 'r1',
          name: 'Ops',
          named: true,
          members: ['a', 'b'],
          admin: 'a',
          mode: 'admin',
          notice: '',
          createdAt: 3,
          createdBy: null,
        },
      },
    }),
  )
  await new FileSettings(home).mutate(PI_AI_NS, [
    {
      op: 'set',
      path: ['providers', 'custom'],
      value: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'mock-1' }] },
    },
  ])
  const service = await startService({ home })
  t.after(() => service.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const call: Call = async (endpoint, payload) =>
    (
      await fetch(`${service.url}/api/bot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      })
    ).json() as Promise<Record<string, unknown>>

  // The session the room runs its relay in is the room id itself. Send, and make sure the
  // round is not ended for want of a model.
  assert.equal((await call('send', { sessionId: 'r1', text: 'Hello team.' })).ok, true)
  const diagnostics = await call('diagnostics', {})
  const entries = (diagnostics.value as { entries?: { code?: string; text?: string }[] } | undefined)?.entries ?? []
  const missing = entries.filter(entry => entry.code === 'NO-MODEL' || /no model is set/u.test(entry.text ?? ''))
  assert.deepEqual(missing, [], 'the room Session must resolve a model, or no round can relay')
})

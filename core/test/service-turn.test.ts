// The full stack over HTTP (plan §阶段 3): a provider route in the standalone settings,
// a Bot on its model, and a message sent over the channel — the engine runs the turn
// against the scripted endpoint and the answer arrives on the SSE feed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startService, type StandaloneService } from '../src/service/server.ts'
import { FileSettings } from '../src/service/settings.ts'
import { PI_AI_NS } from '../src/service/llm.ts'

const openaiMock = () => {
  const requests: { body: { messages?: { role: string, content: unknown }[] } }[] = []
  let script: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      requests.push({ body })
      const text = script.shift() ?? '好了。'
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: Record<string, unknown>) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      send({ role: 'assistant', content: '' })
      send({ content: text })
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return {
    requests,
    reply(...texts: string[]) { script.push(...texts) },
    listen: () => new Promise<{ port: number }>(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port }))),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

test('a message over HTTP runs its turn on the engine and answers on the feed', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-stack-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1,
    mainBotIds: ['a'],
    bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', model: 'custom/mock-1', createdAt: 1 } },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
  }))
  // The provider route, as the providers page writes it.
  const settings = new FileSettings(home)
  await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', 'custom'], value: {
    displayName: 'Custom', api: 'openai-completions', baseURL: `http://127.0.0.1:${port}/v1`,
    models: [{ id: 'mock-1', name: 'Mock One' }],
  } }])

  mock.reply('At your service. The plan is ready.')
  const service: StandaloneService = await startService({ home })
  t.after(() => service.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const base = service.url

  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    (await fetch(`${base}/api/bot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })).json()

  // The feed before the turn, so its events are read from the start.
  const feedAbort = new AbortController()
  t.after(() => feedAbort.abort())
  const feed = await fetch(`${base}/api/bot/feed`, { signal: feedAbort.signal })
  const reader = feed.body!.getReader()
  const events: { event: string, data: Record<string, unknown> }[] = []
  // The feed is read in the background; the test polls `events` and aborts it at the end.
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
        if (data !== undefined) events.push({ event: kind, data: JSON.parse(data) })
      }
    }
  })().catch(() => { /* the aborted feed closes the reader */ })

  const sent = await call('send', { sessionId: 'a', text: 'prepare the plan' })
  assert.equal(sent.ok, true, JSON.stringify(sent))

  // The answer lands on the feed as the chat item of the Bot's own session.
  const until = Date.now() + 15000
  while (Date.now() < until && !events.some(item => item.event === 'message' && JSON.stringify(item.data).includes('plan is ready'))) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(events.some(item => item.event === 'message' && JSON.stringify(item.data).includes('plan is ready')), `feed saw: ${JSON.stringify(events.slice(0, 6))}`)

  // The turn really ran on the engine: the request carried the prompt sections and the
  // Bot's model, and the transcript is in SQLite.
  const wire = JSON.stringify(mock.requests[0]?.body.messages ?? [])
  assert.match(wire, /prepare the plan/)
  assert.equal(mock.requests[0]?.body.messages?.filter(m => m.role === 'system').length, 1)

  const state = await call('state', {})
  assert.ok(state.ok)

  // The chat's history pages from the store: the sent line and the answer.
  const chat = await call('chat', { botId: 'a' })
  assert.equal(chat.ok, true, JSON.stringify(chat))
  const items = (chat.value?.items ?? []) as { kind: string, text?: string }[]
  assert.ok(items.some(item => item.kind === 'user' && (item.text ?? '').includes('prepare the plan')), JSON.stringify(items))
  assert.ok(items.some(item => item.kind === 'bot' && (item.text ?? '').includes('plan is ready')), JSON.stringify(items))
  feedAbort.abort()
  await reader.cancel().catch(() => {})
})

test('a relevant memory surfaces itself into the next request, unprompted', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-mem-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1,
    mainBotIds: ['a'],
    bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', model: 'custom/mock-1', createdAt: 1 } },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
  }))
  // The Bot's own memory, as the remember tool would have written it.
  mkdirSync(join(home, 'memory', 'bots', 'a'), { recursive: true })
  writeFileSync(join(home, 'memory', 'bots', 'a', 'MEMORY.md'), '# Memory\n\n## Notes\n\n- the launch checklist lives in ops/launch.md and needs the sign-off first\n')
  const settings = new FileSettings(home)
  await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', 'custom'], value: {
    api: 'openai-completions', baseURL: `http://127.0.0.1:${port}/v1`, models: [{ id: 'mock-1' }],
  } }])

  mock.reply('On it — I will follow the checklist.')
  const service = await startService({ home })
  t.after(() => service.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> =>
    (await fetch(`${service.url}/api/bot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })).json()

  await call('send', { sessionId: 'a', text: 'prepare the launch checklist' })
  const until = Date.now() + 15000
  while (Date.now() < until && mock.requests.length === 0) await new Promise(resolve => setTimeout(resolve, 25))

  // The request carried the surfaced memory in its dynamic segment — after the frozen
  // one, so the stable prefix the memory section froze never moved.
  const wire = JSON.stringify(mock.requests[0]?.body.messages ?? [])
  assert.match(wire, /From memory/, 'the segment rode along')
  assert.match(wire, /ops\/launch\.md/, 'the relevant entry surfaced')
  const systemAt = wire.indexOf('From memory')
  const frozenAt = wire.lastIndexOf('You are')
  assert.ok(systemAt > frozenAt, 'the dynamic segment follows the system base')
})

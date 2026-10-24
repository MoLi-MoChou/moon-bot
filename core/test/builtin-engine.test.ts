// The built-in engine end-to-end (plan §阶段 2): one runtime, a scripted OpenAI-compatible
// endpoint, a gated tool, and the SQLite transcript. What the acceptance asks — 进程内
// 对话+工具 — runs here: turns queue per session, the gate allows/denies/holds calls, a
// cancel lands mid-stream, and everything said lands in the store in order.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { EngineEvent } from '../src/engine/events.ts'
import type { TurnInput } from '../src/engine/runtime.ts'
import { BuiltinRuntime } from '../src/engine/builtin/runtime.ts'
import type { EngineServices, GateDecision, ToolDefinition } from '../src/engine/builtin/services.ts'
import { openStore } from '../src/store/db.ts'
import { sqliteTranscriptOf } from '../src/engine/builtin/transcript.ts'

const openaiMock = () => {
  const requests: { url: string, auth: string | undefined, body: { system?: unknown, messages?: { role: string, content: unknown }[] } }[] = []
  let script: { tool_calls?: unknown[], content?: string, stall?: number }[][] = []
  const server = createServer((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      requests.push({ url: req.url, auth: req.headers.authorization, body })
      const reply = script.shift() ?? [{ content: 'ok' }]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const closed = new Promise<void>(resolve => res.on('close', resolve))
      const id = `chatcmpl-${requests.length}`
      const send = (delta: Record<string, unknown>) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      send({ role: 'assistant', content: '' })
      for (const delta of reply) {
        if (delta.stall !== undefined) await Promise.race([new Promise(resolve => setTimeout(resolve, delta.stall)), closed])
        else send(delta as Record<string, unknown>)
      }
      const tools = reply.some(delta => delta.tool_calls !== undefined)
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return {
    requests,
    reply(...deltas: { tool_calls?: unknown[], content?: string, stall?: number }[]) { script.push(deltas) },
    listen: () => new Promise<{ port: number }>(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port }))),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const call = (index: number, id: string, name: string) => ({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: '{}' } }] })

test('a turn runs in-process with a gated tool and lands in the transcript', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-engine-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const store = openStore(home)
  t.after(() => store.close())
  store.sessions.upsertSession({ id: 'b1', kind: 'bot', ownerId: 'bot-1' })

  const decisions = new Map<string, GateDecision>()
  const saw: string[] = []
  const note: ToolDefinition = {
    name: 'note', description: 'write a note',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ content: [{ type: 'text', text: 'noted' }] }),
  }
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-engine' }) },
    prompt: { base: async () => 'You are Moon Bot.', frozen: async () => '## Frozen memory\nlikes: tea', dynamic: async () => '## Now\n10:00' },
    gate: { check: async (_session, tool) => { saw.push(tool); return decisions.get(tool) ?? { kind: 'allow' } } },
    transcript: {
      async history() { return [] },
      async append(sessionId, message) {
        store.sessions.appendMessage({ sessionId, role: message.role, content: message.content, ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}), ...(message.turn !== undefined ? { turn: message.turn } : {}) })
      },
    },
    toolsFor: () => ['note'],
    definitions: [note],
  }
  const events: EngineEvent[] = []
  const engine = new BuiltinRuntime({ services, emit: (_id, event) => events.push(event) })

  mock.reply({ content: 'One moment.' }, call(0, 'k1', 'note'))
  mock.reply({ content: 'Noted.' })
  const input: TurnInput = { sessionId: 'b1', message: { content: [{ type: 'text', text: 'take a note' }], source: { kind: 'user' } } }
  const collected: EngineEvent[] = []
  for await (const event of engine.runTurn(input)) collected.push(event)

  // The turn's event vocabulary, in order, through both the iterator and the fanout.
  assert.deepEqual(collected.map(event => event.type), ['turn/start', 'user/message', 'assistant/stream', 'assistant/message', 'tool/call', 'tool/result', 'assistant/stream', 'assistant/message', 'turn/end'])
  assert.deepEqual(events.map(event => event.type), collected.map(event => event.type))
  const end = collected.at(-1)
  assert.deepEqual(end && end.type === 'turn/end' ? end.reason : undefined, { kind: 'completed' })

  // The prompt order is ours: base, frozen memory, dynamic.
  const system = mock.requests[0]?.body.messages?.filter(message => message.role === 'system').map(message => String(message.content)).join('\n') ?? ''
  assert.ok(system.indexOf('You are Moon Bot.') < system.indexOf('## Frozen memory'), 'base before frozen')
  assert.ok(system.indexOf('## Frozen memory') < system.indexOf('## Now'), 'frozen before dynamic')

  // The transcript holds the trigger, both steps, and the tool ran through the gate.
  assert.deepEqual(saw, ['note'])
  const rows = store.sessions.page('b1', 10)
  assert.deepEqual(rows.map(row => [row.role, row.turn]), [['user', 1], ['assistant', 1], ['toolResult', 1], ['assistant', 1]])
  const text = JSON.stringify(rows)
  assert.match(text, /One moment\./)
  assert.match(text, /Noted\./)
})

test('the gate denies a call and the model sees the refusal', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'base', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'deny', reason: 'not permitted by policy' }) },
    transcript: { async history() { return [] }, async append() {} },
    toolsFor: () => ['note'],
    definitions: [{
      name: 'note', description: 'note', parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => { throw new Error('must not run') },
    }],
  }
  const engine = new BuiltinRuntime({ services, emit: () => {} })
  mock.reply(call(0, 'k1', 'note'))
  mock.reply({ content: 'Understood, I will not.' })
  const collected: EngineEvent[] = []
  for await (const event of engine.runTurn({ sessionId: 'b1', message: { content: [{ type: 'text', text: 'note it' }] } })) collected.push(event)
  assert.deepEqual(collected.map(event => event.type), ['turn/start', 'user/message', 'assistant/message', 'tool/call', 'tool/result', 'assistant/stream', 'assistant/message', 'turn/end'])
  const refused = mock.requests.at(-1)?.body.messages?.find(message => String(message.content).includes('not permitted by policy'))
  assert.ok(refused, 'the refusal reached the model')
})

test('two turns on one session queue, and a steer joins the running turn', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const gate = { check: async () => ({ kind: 'allow' }) as GateDecision }
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'base', frozen: async () => '' },
    gate,
    transcript: { async history() { return [] }, async append() {} },
    toolsFor: () => [],
    definitions: [],
  }
  const engine = new BuiltinRuntime({ services, emit: () => {} })
  mock.reply({ content: 'first' }, { stall: 250 })
  mock.reply({ content: 'second' })
  const first: EngineEvent[] = []
  const firstRun = (async () => { for await (const event of engine.runTurn({ sessionId: 's1', message: { content: [{ type: 'text', text: 'one' }] } })) first.push(event) })()
  // A second trigger while the first runs waits for its slot.
  const second: EngineEvent[] = []
  const secondRun = (async () => { for await (const event of engine.runTurn({ sessionId: 's1', message: { content: [{ type: 'text', text: 'two' }] } })) second.push(event) })()
  // A steer joins the running turn instead of queueing; it may land a tick before the
  // turn's preamble finishes, so wait for its start event.
  const steered = await (async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await engine.steer('s1', { content: [{ type: 'text', text: 'also this' }] })) return true
      await new Promise(resolve => setImmediate(resolve))
    }
    return false
  })()
  assert.equal(steered, true)
  await Promise.all([firstRun, secondRun])
  const turns = first.filter(event => event.type === 'turn/start').length + second.filter(event => event.type === 'turn/start').length
  assert.equal(turns, 2, 'two turns, one after the other')
  // The steer was heard inside the first turn's request.
  const wire = mock.requests.map(request => JSON.stringify(request.body.messages)).join('\n')
  assert.match(wire, /also this/)
  assert.equal(await engine.steer('s1', { content: [] }), false, 'no turn runs afterwards')
})

test('a cancel mid-stream ends the turn as aborted, and the turn count survives', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'base', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: { async history() { return [] }, async append() {} },
    toolsFor: () => [],
    definitions: [],
  }
  const engine = new BuiltinRuntime({ services, emit: () => {} })
  mock.reply({ content: 'half' }, { stall: 8000 }, { content: ' and more' })
  const collected: EngineEvent[] = []
  const run = (async () => { for await (const event of engine.runTurn({ sessionId: 's1', message: { content: [{ type: 'text', text: 'go' }] } })) collected.push(event) })()
  await new Promise(resolve => setTimeout(resolve, 60))
  await engine.cancelTurn('s1', 'user')
  await run
  const end = collected.at(-1)
  assert.equal(end?.type, 'turn/end')
  assert.deepEqual(end?.type === 'turn/end' ? end.reason : undefined, { kind: 'aborted' })
  // The next turn on the same session still runs, numbered after the aborted one.
  mock.reply({ content: 'fine' })
  const again: EngineEvent[] = []
  for await (const event of engine.runTurn({ sessionId: 's1', message: { content: [{ type: 'text', text: 'again' }] } })) again.push(event)
  const start = again.find(event => event.type === 'turn/start')
  assert.equal(start?.type === 'turn/start' ? start.turn : undefined, 2)
})

test('a model resolution failure ends the turn with an error, not a hang', async () => {
  const services: EngineServices = {
    models: { resolve: async () => undefined },
    prompt: { base: async () => 'base', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: { async history() { return [] }, async append() {} },
    toolsFor: () => [],
    definitions: [],
  }
  const engine = new BuiltinRuntime({ services, emit: () => {} })
  const collected: EngineEvent[] = []
  for await (const event of engine.runTurn({ sessionId: 's1', message: { content: [{ type: 'text', text: 'go' }] } })) collected.push(event)
  const end = collected.at(-1)
  assert.equal(end?.type, 'turn/end')
  assert.equal(end?.type === 'turn/end' ? end.reason.kind : '', 'error')
})


test('the second turn replays the first: history, tools, and the raw kernel messages', async (t) => {
  const mock = openaiMock()
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-engine-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const store = openStore(home)
  t.after(() => store.close())
  store.sessions.upsertSession({ id: 'b1', kind: 'bot', ownerId: 'bot-1' })
  const transcript = sqliteTranscriptOf(store.sessions)
  const note: ToolDefinition = {
    name: 'note', description: 'write a note',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ content: [{ type: 'text', text: 'noted' }] }),
  }
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk' }) },
    prompt: { base: async () => 'You are Moon Bot.', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript,
    toolsFor: () => ['note'],
    definitions: [note],
  }
  const engine = new BuiltinRuntime({ services, emit: () => {} })

  // First turn: a tool call, then the answer.
  mock.reply({ content: 'One moment.' }, call(0, 'k1', 'note'))
  mock.reply({ content: 'The note is written.' })
  for await (const event of engine.runTurn({ sessionId: 'b1', message: { content: [{ type: 'text', text: 'take a note about the launch' }] } })) void event

  // Second turn on the same session: the request must carry the whole first turn.
  mock.reply({ content: 'As noted, the launch is ready.' })
  for await (const event of engine.runTurn({ sessionId: 'b1', message: { content: [{ type: 'text', text: 'what did you note?' }] } })) void event

  const second = mock.requests.at(-1)?.body.messages ?? []
  const wire = JSON.stringify(second)
  assert.match(wire, /take a note about the launch/, 'the first trigger replays')
  assert.match(wire, /The note is written\./, 'the first answer replays')
  assert.match(wire, /noted/, 'the tool result replays')
  assert.ok(second.some(message => message.role === 'system'), 'the system prompt leads')
  assert.match(JSON.stringify(mock.requests.at(-1)?.body.tools ?? []), /note/, 'the tools are offered again')

  // The store holds the raw kernel messages for verbatim replay.
  const raws = store.sessions.page('b1', 10).filter(row => row.raw !== null && row.raw !== undefined)
  assert.ok(raws.length >= 3, 'assistant steps and tool results kept raw')
})

// A model call that failed: the code the chat reads its words from, and the transcript
// line a failed turn leaves behind. Before this, a failed turn ended quietly — the chat
// showed the user's own message and nothing else, which read as a frozen window.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineEvent } from '../src/engine/events.ts'
import type { TurnInput } from '../src/engine/runtime.ts'
import { endEventOf } from '../src/engine/builtin/adapter.ts'
import { BuiltinRuntime } from '../src/engine/builtin/runtime.ts'
import type { EngineServices, ResolvedModel } from '../src/engine/builtin/services.ts'
import { sqliteTranscriptOf } from '../src/engine/builtin/transcript.ts'
import { callFailureOf, failureCodeOf, failureNeedsUser } from '../src/engine/failure.ts'
import { openStore } from '../src/store/db.ts'

const unreachable = 'http://127.0.0.1:9/v1'

// One endpoint that answers a fixed HTTP error, as a provider with a bad key does.
const errorServer = async (status: number, body: string) => {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

// The engine over a store, with a model source the test decides.
function engineOver(store: ReturnType<typeof openStore>, resolve: () => ResolvedModel | undefined) {
  const events: EngineEvent[] = []
  const services: EngineServices = {
    models: { resolve: async () => resolve() },
    prompt: { base: async () => 'You are Moon Bot.', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: sqliteTranscriptOf(store.sessions as unknown as Parameters<typeof sqliteTranscriptOf>[0]),
    toolsFor: () => [],
    definitions: [],
  }
  const engine = new BuiltinRuntime({ services, emit: (_id, event) => events.push(event) })
  return { engine, events }
}

const input: TurnInput = { sessionId: 's1', message: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } }

const runTurn = async (engine: BuiltinRuntime): Promise<EngineEvent[]> => {
  const collected: EngineEvent[] = []
  for await (const event of engine.runTurn(input)) collected.push(event)
  return collected
}

const reasonOf = (events: readonly EngineEvent[]) => {
  const end = events.at(-1)
  assert.equal(end?.type, 'turn/end')
  return end !== undefined && end.type === 'turn/end' ? end.reason : undefined
}

// The rows a failed turn left: the user's own line and the failure's system row.
const rowsOf = (store: ReturnType<typeof openStore>) => store.sessions.page('s1', 10).map(row => ({
  role: row.role,
  turn: row.turn,
  text: row.content.map(block => (block.type === 'text' ? block.text : '')).join(''),
  kind: (row.source as { kind?: string } | null)?.kind,
}))

const withStore = (t: { after: (fn: () => void) => void }) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-failure-'))
  const store = openStore(home)
  t.after(() => store.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  store.sessions.upsertSession({ id: 's1', kind: 'bot', ownerId: 'bot-1' })
  return store
}

test('a refused key ends the turn with AUTH and leaves the chat the key-free reason', async (t) => {
  const server = await errorServer(401, JSON.stringify({ error: { message: 'invalid api key sk-live-abcdef123456' } }))
  t.after(() => void server.close())
  const store = withStore(t)
  const { engine, events } = engineOver(store, () => ({ id: 'mock-1', baseUrl: server.url, api: 'openai-completions', apiKey: 'sk-test-abcdef123456' }))

  const collected = await runTurn(engine)
  assert.deepEqual(events.map(event => event.type), collected.map(event => event.type))
  const reason = reasonOf(collected)
  assert.equal(reason?.kind, 'error')
  assert.equal(reason?.kind === 'error' ? reason.error.code : undefined, 'AUTH')
  // A provider may echo part of the key; the failure's words never carry one.
  assert.equal(reason?.kind === 'error' ? reason.error.message : 'kept', undefined)

  // The user's line and the failure's line are both in the transcript, in that order.
  // pi also keeps its failed assistant step; the failure's own line comes last.
  assert.deepEqual(rowsOf(store).map(row => [row.role, row.kind]), [['user', 'user'], ['assistant', undefined], ['system', 'turn-error']])
  const failure = store.sessions.page('s1', 10).at(-1)?.source as { kind?: string; code?: string } | null
  assert.equal(failure?.code, 'AUTH')
})

test('an endpoint that cannot be reached is TRANSPORT, and says so', async (t) => {
  const store = withStore(t)
  const { engine } = engineOver(store, () => ({ id: 'mock-1', baseUrl: unreachable, api: 'openai-completions', apiKey: 'sk-test' }))
  const reason = reasonOf(await runTurn(engine))
  assert.equal(reason?.kind, 'error')
  assert.equal(reason?.kind === 'error' ? reason.error.code : undefined, 'TRANSPORT')
  assert.deepEqual(rowsOf(store).map(row => [row.role, row.kind]), [['user', 'user'], ['assistant', undefined], ['system', 'turn-error']])
})

test('a Bot with no model ends in NO-MODEL, and its message is still in the chat', async (t) => {
  const store = withStore(t)
  const { engine } = engineOver(store, () => undefined)
  const reason = reasonOf(await runTurn(engine))
  assert.equal(reason?.kind === 'error' ? reason.error.code : undefined, 'NO-MODEL')
  assert.deepEqual(rowsOf(store), [
    { role: 'user', turn: 1, text: 'hello', kind: 'user' },
    { role: 'system', turn: 1, text: 'no model is set for this Bot', kind: 'turn-error' },
  ])
})

test('the failure code is read from what the wire said', () => {
  assert.equal(failureCodeOf('401 {"type":"error","error":{"type":"authentication_error"}}'), 'AUTH')
  assert.equal(failureCodeOf('403 Forbidden'), 'AUTH')
  assert.equal(failureCodeOf('429 rate limited, retry later'), 'RATE_LIMIT')
  assert.equal(failureCodeOf('prompt is too long: maximum context length exceeded'), 'CONTEXT_WINDOW_EXCEEDED')
  assert.equal(failureCodeOf('502 Bad Gateway'), 'SERVER')
  assert.equal(failureCodeOf('402 payment required, credit balance is too low'), 'QUOTA')
  assert.equal(failureCodeOf('the model is overloaded'), 'OVERLOADED')
  assert.equal(failureNeedsUser('QUOTA'), true)
  assert.equal(failureNeedsUser('OVERLOADED'), false)
  assert.equal(failureNeedsUser('RATE_LIMIT'), false)
  assert.equal(failureCodeOf('Connection error.'), 'TRANSPORT')
  assert.equal(failureCodeOf('socket hang up'), 'TRANSPORT')
  assert.equal(failureCodeOf('the model wrote something odd'), undefined)
  // A thrown error keeps a code it already has, and the message is masked.
  assert.deepEqual(callFailureOf({ code: 'SESSION', message: 'its conversation could not open' }), { code: 'SESSION', message: 'its conversation could not open' })
  assert.deepEqual(callFailureOf('bad key sk-live-abcdef123456'), { code: 'UNKNOWN', message: 'bad key sk-[hidden]' })
})

test('the end event carries the code the chat reads', () => {
  const end = endEventOf(3, { stopReason: 'error', errorMessage: '429 too many requests' })
  assert.deepEqual(end, { type: 'turn/end', turn: 3, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: '429 too many requests' } } })
})

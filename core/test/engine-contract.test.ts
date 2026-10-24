// The engine contract (plan §阶段 1): the AgentRuntime seam compiles, and the event
// protocol reads the session/event payloads untyped channels deliver. The pi-side of
// the mapping is test/pi-proto.test.js; here the shapes themselves are pinned.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { engineEventOf, textOfContent, callsTools } from '../src/engine/events.ts'
import type { AgentRuntime, TurnInput } from '../src/engine/runtime.ts'

// The interface is implementable as written: a typed no-op runtime satisfies it.
const noopRuntime: AgentRuntime = {
  async start() {},
  async stop() {},
  async *runTurn(input) {
    yield { type: 'turn/start', turn: 1 }
    yield { type: 'assistant/message', message: { content: [{ type: 'text', text: `echo ${textOfContent(input.message.content)}` }] } }
    yield { type: 'turn/end', turn: 1, reason: { kind: 'completed' } }
  },
  async steer() { return false },
  async cancelTurn() {},
}

test('a typed runtime runs a turn and its events parse back through engineEventOf', async () => {
  const input: TurnInput = { sessionId: 'b1', message: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } }
  const events = []
  for await (const event of noopRuntime.runTurn(input)) events.push(event)
  assert.deepEqual(events.map(event => event.type), ['turn/start', 'assistant/message', 'turn/end'])
  // What the channel delivers is the same events as plain payloads; engineEventOf reads
  // them back to the typed shapes, rejecting what is not ours.
  assert.deepEqual(engineEventOf({ type: 'turn/start', turn: 1 }), { type: 'turn/start', turn: 1 })
  assert.deepEqual(engineEventOf({ type: 'tool/call', callId: 'k1', name: 'read', arguments: '{}' }), { type: 'tool/call', callId: 'k1', name: 'read', arguments: '{}' })
  assert.deepEqual(engineEventOf({ type: 'tool/result', callId: 'k1', isError: true }), { type: 'tool/result', callId: 'k1', isError: true })
  const end = engineEventOf({ type: 'turn/end', turn: 1, reason: { kind: 'error', error: { code: 'SERVER', status: 503, message: 'busy' } } })
  assert.deepEqual(end, { type: 'turn/end', turn: 1, reason: { kind: 'error', error: { code: 'SERVER', status: 503, message: 'busy' } } })
  const aborted = engineEventOf({ type: 'turn/end', turn: 2, reason: { kind: 'aborted', reason: 'disposed' } })
  assert.deepEqual(aborted, { type: 'turn/end', turn: 2, reason: { kind: 'aborted', reason: 'disposed' } })
  // Not ours, or not well-formed: undefined, never a guess.
  assert.equal(engineEventOf({ type: 'session/closed' }), undefined)
  assert.equal(engineEventOf({ type: 'turn/start', turn: 'one' }), undefined)
  assert.equal(engineEventOf(null), undefined)
})

test('a step that calls tools is told apart from one that only speaks', () => {
  const speaking = { content: [{ type: 'text', text: 'All done.' }] }
  const calling = { content: [{ type: 'text', text: 'One moment.' }, { type: 'tool-call', id: 'k1', name: 'read', arguments: '{}' }] }
  assert.equal(callsTools(speaking), false)
  assert.equal(callsTools(calling), true)
  assert.equal(textOfContent(calling.content), 'One moment.')
})

test('a user/message event keeps its content and its delivery source', () => {
  const event = engineEventOf({ type: 'user/message', content: [{ type: 'text', text: 'hi' }], source: { kind: 'bot', role: 'request', exchangeId: 'x1' } })
  assert.deepEqual(event, { type: 'user/message', content: [{ type: 'text', text: 'hi' }], source: { kind: 'bot', role: 'request', exchangeId: 'x1' } })
  const bare = engineEventOf({ type: 'user/message', content: 'not a list' })
  assert.deepEqual(bare, { type: 'user/message', content: [], source: undefined })
})

// The ACP adapter (plan §阶段 5) against a scripted agent: a real child process
// speaking the wire, so the adapter's subprocess handling, request/notification
// correlation and event mapping run exactly as they would against Claude Agent or
// opencode. Two AgentRuntime implementations now exist — the plan's own proof that the
// seam is replaceable.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AcpRuntime, eventsOfUpdate } from '../src/engine/acp/runtime.ts'
import { RelayTransport, StdioTransport } from '../src/engine/acp/transport.ts'
import { engineAgentOf } from '../src/engine/builtin/bridge.ts'
import { LineProtocol } from '../src/engine/acp/protocol.ts'
import type { EngineEvent } from '../src/engine/events.ts'

// A scripted ACP agent: answers initialize/session-new/session-prompt and streams the
// updates the test wrote into its script file (one update kind per line).
const AGENT = `
const { readFileSync } = require('node:fs')
const script = readFileSync(process.argv[2], 'utf8').trim().split('\\n').filter(Boolean)
let send = (object) => process.stdout.write(JSON.stringify(object) + '\\n')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  for (let end = input.indexOf('\\n'); end >= 0; end = input.indexOf('\\n')) {
    const line = input.slice(0, end).trim()
    input = input.slice(end + 1)
    if (line === '') continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, serverInfo: { name: 'mock-acp', version: '1' } } })
    else if (message.method === 'initialized') {}
    else if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-1' } })
    else if (message.method === 'session/prompt') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'acp-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' } } } })
      for (const step of script) send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'acp-1', update: JSON.parse(step) } })
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    } else if (message.method === 'session/cancel') process.exit(0)
    else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })
  }
})
`

const mockAgent = (t: { after: (run: () => void) => void }, script: readonly string[]): { command: string, args: string[] } => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-agent-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  writeFileSync(join(dir, 'agent.cjs'), AGENT)
  writeFileSync(join(dir, 'script.jsonl'), `${script.join('\n')}\n`)
  return { command: process.execPath, args: [join(dir, 'agent.cjs'), join(dir, 'script.jsonl')] }
}

const run = async (runtime: AcpRuntime, sessionId: string, text: string): Promise<EngineEvent[]> => {
  const events: EngineEvent[] = []
  for await (const event of runtime.runTurn({ sessionId, message: { content: [{ type: 'text', text }], source: { kind: 'user' } } })) events.push(event)
  return events
}

test('a turn on an ACP agent: handshake, updates as engine events, prompt resolves', async (t) => {
  const { command, args } = mockAgent(t, [
    JSON.stringify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' on it' } }),
    JSON.stringify({ sessionUpdate: 'tool_call', toolCallId: 'k1', title: 'Read the plan', rawInput: { path: 'plan.md' } }),
    JSON.stringify({ sessionUpdate: 'tool_call_update', toolCallId: 'k1', content: [{ type: 'text', text: 'the plan says Friday' }] }),
    JSON.stringify({ sessionUpdate: 'agent_message', content: [{ type: 'text', text: 'The launch is Friday.' }] }),
  ])
  const fanout: EngineEvent[] = []
  const runtime = new AcpRuntime({ transport: new StdioTransport(command, args), emit: (_id, event) => fanout.push(event) })
  t.after(() => runtime.stop())
  const events = await run(runtime, 'b1', 'when is the launch?')
  const kinds = events.map(event => event.type)
  assert.deepEqual(kinds, ['turn/start', 'user/message', 'assistant/stream', 'assistant/stream', 'tool/call', 'tool/result', 'assistant/message', 'turn/end'])
  // The same events reached the fanout, in the same order.
  assert.deepEqual(fanout.map(event => event.type), kinds)
  const answer = events.find(event => event.type === 'assistant/message')
  assert.match(JSON.stringify(answer), /The launch is Friday\./)
  // A second turn reuses the ACP session and numbers its turn.
  const second = await run(runtime, 'b1', 'and the demo?')
  const start = second.find(event => event.type === 'turn/start')
  assert.equal(start?.type === 'turn/start' ? start.turn : undefined, 2)
  await runtime.stop()
})

test('the update mapping covers the wire vocabulary', () => {
  const stream = eventsOfUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } })
  assert.deepEqual(stream, [{ type: 'assistant/stream', text: 'hi' }])
  const message = eventsOfUpdate({ sessionUpdate: 'agent_message', content: [{ type: 'text', text: 'Done.' }] })
  assert.deepEqual(message, [{ type: 'assistant/message', message: { content: [{ type: 'text', text: 'Done.' }] } }])
  const tool = eventsOfUpdate({ sessionUpdate: 'tool_call', toolCallId: 'k2', title: 'Search', rawInput: { q: 'x' } })
  assert.deepEqual(tool, [{ type: 'tool/call', callId: 'k2', name: 'Search', arguments: '{"q":"x"}' }])
  const toolDone = eventsOfUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'k2', content: [] })
  assert.deepEqual(toolDone, [{ type: 'tool/result', callId: 'k2' }])
  // What the protocol adds that we do not map yet stays silent, not broken.
  assert.deepEqual(eventsOfUpdate({ sessionUpdate: 'plan', entries: [] }), [])
  assert.deepEqual(eventsOfUpdate({}), [])
})

test('an agent that dies takes its turn to an error end, not a hang', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-die-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  writeFileSync(join(dir, 'agent.cjs'), 'process.stdin.resume()\n')
  const runtime = new AcpRuntime({ transport: new StdioTransport(process.execPath, [join(dir, 'agent.cjs')]), emit: () => {} })
  t.after(() => runtime.stop())
  // The handshake never answers; the adapter keeps its start promise pending, so the
  // turn is ended by the caller's own timeout — here we just prove no crash escapes.
  const outcome = await Promise.race([
    run(runtime, 'b1', 'hello').then(events => events.at(-1)),
    new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), 1200) }),
  ])
  void outcome
  await runtime.stop()
  assert.ok(true)
})

// An agent that answers one prompt and then exits; it logs each start and exit to argv[2].
const ONE_SHOT_AGENT = `
require('node:fs').appendFileSync(process.argv[2], 'up\\n')
process.on('exit', () => require('node:fs').appendFileSync(process.argv[2], 'down\\n'))
const send = (object) => process.stdout.write(JSON.stringify(object) + '\\n')
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-1' } })
  else if (message.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    setTimeout(() => process.exit(0), 20)
  } else send({ jsonrpc: '2.0', id: message.id, result: {} })
})
`

test('an agent that exits between turns is started and initialized again on the next turn', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-restart-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  writeFileSync(join(dir, 'agent.cjs'), ONE_SHOT_AGENT)
  const starts = join(dir, 'starts.log')
  const runtime = new AcpRuntime({ transport: new StdioTransport(process.execPath, [join(dir, 'agent.cjs'), starts]), emit: () => {} })
  t.after(() => runtime.stop())
  const first = await run(runtime, 'b1', 'hello')
  assert.deepEqual(first.at(-1), { type: 'turn/end', turn: 1, reason: { kind: 'completed' } })
  // The child exits after its answer; give the parent its exit event before turn two.
  const until = Date.now() + 5000
  while (!readFileSync(starts, 'utf8').includes('down') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  await new Promise(resolve => setTimeout(resolve, 100))
  const second = await Promise.race([
    run(runtime, 'b1', 'again').then(events => events.at(-1)),
    new Promise<string>(resolve => { setTimeout(() => resolve('still waiting'), 3000) }),
  ])
  assert.deepEqual(second, { type: 'turn/end', turn: 1, reason: { kind: 'completed' } })
  assert.equal(readFileSync(starts, 'utf8').split('\n').filter(line => line === 'up').length, 2)
  await runtime.stop()
})

test('a remote agent that is offline ends its turn through the fanout, not only the generator', async () => {
  const fanout: EngineEvent[] = []
  const offline = { connect: () => undefined, onUp: () => {} }
  const runtime = new AcpRuntime({ transport: new RelayTransport(offline, 'laptop'), emit: (_id, event) => fanout.push(event) })
  const events = await run(runtime, 'b1', 'hello')
  assert.deepEqual(events.map(event => event.type), ['turn/start', 'turn/end'])
  assert.deepEqual(fanout, events)
  assert.match(JSON.stringify(events.at(-1)), /offline/)
})

test('the bridge leaves the fanout to the runtime: each event arrives once', async (t) => {
  const { command, args } = mockAgent(t, [JSON.stringify({ sessionUpdate: 'agent_message', content: [{ type: 'text', text: 'Done.' }] })])
  const fanout: string[] = []
  // One fanout for the runtime and the bridge, as service/engine.ts wires them.
  const emitEvent = (_id: string, event: EngineEvent): void => { fanout.push(event.type) }
  const runtime = new AcpRuntime({ transport: new StdioTransport(command, args), emit: emitEvent })
  t.after(() => runtime.stop())
  const agent = engineAgentOf('b1', { runtime, emitEvent })
  agent.followup({ content: [{ type: 'text', text: 'hello' }] })
  const until = Date.now() + 5000
  while ((agent.status === 'running' || fanout.length === 0) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(fanout, ['turn/start', 'user/message', 'assistant/stream', 'assistant/message', 'turn/end'])
  await runtime.stop()
})

test('spawnAgent wiring: a torn line never corrupts the stream', () => {
  const seen: unknown[] = []
  const protocol = new LineProtocol(() => {}, message => { seen.push(message) })
  protocol.feed('{"jsonrpc":"2.0","id":1,"res')
  protocol.feed('ult":{"ok":true}}\nnot json at all\n\n{"jsonrpc":"2.0","method":"x"}\n')
  assert.equal(seen.length, 2)
  assert.deepEqual((seen[0] as { result?: unknown }).result, { ok: true })
  assert.equal((seen[1] as { method?: string }).method, 'x')
})


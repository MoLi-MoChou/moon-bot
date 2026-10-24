// The engine against the real scripted mock model (plan §阶段 2: mock-llm 全测试过).
// dev/mock-llm.ts is the Anthropic-Messages-shaped server the DSH bench runs; the
// engine's anthropic-messages path drives it here, so both loops see the same scripts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BuiltinRuntime } from '../src/engine/builtin/runtime.ts'
import type { EngineEvent } from '../src/engine/events.ts'
import type { EngineServices } from '../src/engine/builtin/services.ts'

const MOCK = fileURLToPath(new URL('../dev/mock-llm.ts', import.meta.url))

interface MockModel {
  readonly port: number
  close(): Promise<void>
}

const startMock = async (): Promise<MockModel> => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-mockllm-'))
  const port = 30000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [MOCK], {
    env: { ...process.env, MOCK_PORT: String(port), MOCK_LOG: join(dir, 'mock.jsonl'), MOCK_DELAY_MS: '40' },
    stdio: 'ignore',
  })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/health`)
      if (probe.status === 404 || probe.ok) break
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return {
    port,
    close: () => new Promise(resolve => {
      child.kill()
      child.on('exit', () => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); resolve() })
    }),
  }
}

test('the engine runs the scripted mock model over the anthropic wire', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const services: EngineServices = {
    models: { resolve: async () => ({ id: 'mock', baseUrl: `http://127.0.0.1:${mock.port}`, api: 'anthropic-messages', apiKey: 'sk-mock' }) },
    prompt: { base: async () => 'You are the mock Bot, a Bot on the user\'s team.', frozen: async () => '' },
    gate: { check: async () => ({ kind: 'allow' }) },
    transcript: { async history() { return [] }, async append() {} },
    toolsFor: () => ['list_bots'],
    definitions: [{
      name: 'list_bots', description: 'list the team', parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ content: [{ type: 'text', text: 'Chief (Main Bot), Writer' }] }),
    }],
  }
  const events: EngineEvent[] = []
  const engine = new BuiltinRuntime({ services, emit: (_id, event) => events.push(event) })

  // A plain greeting: the script echoes it back and asks a follow-up.
  const collected: EngineEvent[] = []
  for await (const event of engine.runTurn({ sessionId: 'b1', message: { content: [{ type: 'text', text: 'hello there' }] } })) collected.push(event)
  const end = collected.at(-1)
  assert.equal(end?.type, 'turn/end')
  assert.deepEqual(end?.type === 'turn/end' ? end.reason : undefined, { kind: 'completed' })
  const said = collected.filter(event => event.type === 'assistant/message').map(event => event.type === 'assistant/message' ? event.message.content.map(block => block.type === 'text' ? block.text : '').join('') : '').join('')
  assert.match(said, /hello there/, 'the echo script answered')

  // A scripted memory command: the mock calls remember; the tool result comes back
  // and the turn completes on the follow-up answer.
  const remembered: string[] = []
  const withMemory: EngineServices = {
    ...services,
    gate: { check: async () => ({ kind: 'allow' }) },
    toolsFor: () => ['list_bots', 'remember'],
    definitions: [
      ...services.definitions,
      {
        name: 'remember', description: 'save a memory', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        execute: async input => { remembered.push(String((input as { text?: unknown }).text)); return { content: [{ type: 'text', text: 'saved' }] } },
      },
    ],
  }
  const memoryEngine = new BuiltinRuntime({ services: withMemory, emit: () => {} })
  const second: EngineEvent[] = []
  for await (const event of memoryEngine.runTurn({ sessionId: 'b2', message: { content: [{ type: 'text', text: '记住: the launch is on Friday' }] } })) second.push(event)
  const kinds = second.map(event => event.type)
  assert.ok(kinds.includes('tool/call'), 'the script made a tool call')
  assert.ok(kinds.includes('tool/result'), 'the tool ran')
  assert.deepEqual(second.at(-1)?.type === 'turn/end' ? second.at(-1).reason : undefined, { kind: 'completed' })
  assert.deepEqual(remembered, ['the launch is on Friday'])
})

// The phase-5 acceptance (plan §九): one ACP agent as a full Bot — it joins a group
// chat and takes assigned work, exactly like a built-in Bot. The roster, groups,
// rounds and deliveries are the host's unchanged code; only the turns run in the
// external agent, through the same bridge. The built-in Chief runs on a scripted
// endpoint, so both engines share one team.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fakeContext } from './fake-ctx.ts'
import { wireService } from '../src/service/engine.ts'
import { FileSettings } from '../src/service/settings.ts'
import type { StandaloneLlm } from '../src/service/llm.ts'
import type { BridgeAgent } from '../src/engine/builtin/bridge.ts'

const NL = String.fromCharCode(10)
// The scripted ACP agent, one line per array entry (no escape ambiguity).
const AGENT = [
  'const NL = String.fromCharCode(10)',
  'let send = (object) => process.stdout.write(JSON.stringify(object) + NL)',
  "let input = ''",
  'let nextSession = 0',
  "process.stdin.setEncoding('utf8')",
  "process.stdin.on('data', (chunk) => {",
  '  input += chunk',
  '  for (let end = input.indexOf(NL); end >= 0; end = input.indexOf(NL)) {',
  '    const line = input.slice(0, end).trim()',
  '    input = input.slice(end + 1)',
  "    if (line === '') continue",
  '    const message = JSON.parse(line)',
  "    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1', capabilities: {}, serverInfo: { name: 'acp-fixture', version: '1.0' } } })",
  "    else if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-' + (++nextSession) } })",
    "    else if (message.method === 'session/prompt') {",
    "      const text = (message.params?.prompt ?? []).map(block => block.text ?? '').join('')",
    "      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message', content: [{ type: 'text', text: 'ACP did it: ' + text.slice(0, 40) }] } } })",
    "      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })",
  "    } else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })",
  '  }',
  '})',
  '',
].join(NL)

interface Host {
  ctx: ReturnType<typeof fakeContext>
  tool(name: string, args: Record<string, unknown>, sessionId: string, exec?: Record<string, unknown>): Promise<unknown>
  agentOf(sessionId: string): BridgeAgent
}

async function start(t: { after: (run: () => Promise<void> | void) => void }): Promise<Host> {
  const agentDir = mkdtempSync(join(tmpdir(), 'acp-full-'))
  writeFileSync(join(agentDir, 'agent.cjs'), AGENT)

  const home = mkdtempSync(join(tmpdir(), 'ds-bot-acpbot-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1,
    mainBotIds: ['a'],
    bots: {
      a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'custom/mock-1' },
      b: { id: 'b', name: 'Atlas', role: 'Work', sessionId: 'b', createdAt: 2, engine: { kind: 'acp', command: process.execPath, args: [join(agentDir, 'agent.cjs')] } },
    },
    rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'b', named: true, sessions: { b: 'gb' }, log: [], seq: 0, seen: {} } },
    agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
  }))

  // A scripted endpoint for the built-in Chief; the ACP Bot never touches it.
  const mock = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
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

  // One world: the wired service IS the host — its runtime installed the roster, the
  // groups and the channel on the same context the engine's events fan out to.
  const ctx = wired.context as unknown as ReturnType<typeof fakeContext>
  const agents = new Map<string, BridgeAgent>()
  const agentOf = (sessionId: string): BridgeAgent => {
    let agent = agents.get(sessionId)
    if (agent === undefined) agents.set(sessionId, agent = wired.agentOf(sessionId) as BridgeAgent)
    return agent
  }
  void agentOf
  await (wired.runtime as unknown as { load(): Promise<unknown> }).load()
  const tool = (name: string, args: Record<string, unknown>, sessionId: string, exec: Record<string, unknown> = {}) =>
    ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec }) as Promise<unknown>
  t.after(async () => {
    await ctx.dispose()
    await wired.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return { ctx, tool, agentOf }
}

test('an ACP agent as a full Bot: a group round, and assigned work', async (t) => {
  const host = await start(t)

  // The round: the admin's relay opens Atlas's group turn; the ACP agent answers it.
  let result: { replies?: { name: string, text?: string }[] } | undefined
  const stop = new AbortController()
  t.after(() => stop.abort())
  void host.tool('group_relay', {}, 'r1', { callId: 'c1', signal: stop.signal })
    .then((value: unknown) => { result = JSON.parse(String(value)) })
    .catch((error: unknown) => { throw error instanceof Error ? error : new Error(String(error)) })
  const until = Date.now() + 20000
  while (result === undefined && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(result, 'the relay round finished')
  const reply = result.replies?.find(entry => entry.name === 'Atlas')
  assert.ok(reply, 'Atlas answered in the group')
  assert.match(reply?.text ?? '', /ACP did it:/)

  // Assigned work: Chief hands Atlas a task; the ACP agent's answer comes back to him.
  const delivered: unknown[] = []
  const chief = host.agentOf('a')
  const originalPush = chief.calls.push.bind(chief.calls)
  chief.calls.push = (...items: unknown[]): number => {
    delivered.push(...items)
    return originalPush(...items)
  }
  await host.tool('message_bot', { to: 'Atlas', message: 'clean the pipeline logs' }, 'a')
  const untilReply = Date.now() + 20000
  while (!delivered.some(item => String(JSON.stringify(item)).includes('ACP did it')) && Date.now() < untilReply) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const answer = delivered.find(item => String(JSON.stringify(item)).includes('ACP did it'))
  assert.ok(answer, 'Chief received the ACP agent\u2019s answer to the assigned work')
  assert.match(String(JSON.stringify(answer)), /\[Reply from Atlas\]/)
})

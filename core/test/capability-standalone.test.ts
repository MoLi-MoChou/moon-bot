// Standalone capability mounting (plan §阶段 6): with no DSH plugin host, a Bot's MCP
// capability mounts through the connector into the tool registry the engine serves —
// namespaced, so the policy classifies it L3 — and unmounts when the Bot drops it.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { ruleOf } from '../src/engine/policy.ts'

const ECHO = fileURLToPath(new URL('../dev/mcp-echo-server.mjs', import.meta.url))

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, capabilities: ['echo'] } },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, revision: 1,
  capabilities: { items: {
    echo: { name: 'echo', kind: 'mcp', description: 'Echo service', transport: 'stdio', command: process.execPath, args: [ECHO], env: {}, approved: true },
  } },
})

test('a standalone Bot mounts an MCP capability into the registry, L3 by policy', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-cap-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))

  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, calls: [], inbox: { nextStep: [], nextTurn: [], remove: () => false }, followup() {}, steer() {}, cancel() {} } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  t.after(() => ctx.dispose())

  // A session's agent is created by the runtime; the capability mounts on that event,
  // exactly as the standalone service's bridge agent does.
  const agent = { session: { id: 'a' } }
  for (const listener of ctx.listeners.get('agent/created') ?? []) await listener({ agent })
  // The mount is asynchronous (it starts a real child process), so wait for it.
  const names = (): readonly string[] => rt.toolRegistry.names()
  const until = Date.now() + 20000
  while (Date.now() < until && !names().some(name => name.startsWith('mcp__'))) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const mounted = names().filter(name => name.startsWith('mcp__'))
  assert.deepEqual(mounted, ['mcp__echo__echo'], `registry: ${names().join(', ')}`)
  // The policy sees a connector tool as L3, so calls run inside the budget flow.
  assert.equal(ruleOf(mounted[0] as string).level, 3)
  // The status view says the capability is ready.
  assert.equal(rt.capabilityStatusesView().a?.echo?.state, 'ready')
  const definition = rt.toolRegistry.definitions([mounted[0] as string])[0]
  const outcome = await definition.execute({ text: 'mounted standalone' }, { sessionId: 'a', callId: 'c1' })
  assert.equal(outcome.content[0]?.type === 'text' ? outcome.content[0].text : '', 'mounted standalone')
})

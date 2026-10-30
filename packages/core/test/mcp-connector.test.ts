// The MCP connector (plan §阶段 5) against the repo's own echo server: a real stdio
// MCP server through the real SDK client. The namespaced tools mount into the registry,
// the policy gate classifies them L3 (unknown names — every connector call runs inside
// the budget flow), results are verified and bounded, and a dropped connection is
// retried once before the call fails.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { McpConnector } from '../src/engine/connectors/mcp.ts'
import { ToolRegistry } from '../src/engine/registry.ts'
import { ruleOf } from '../src/engine/policy.ts'

const ECHO = fileURLToPath(new URL('../dev/mcp-echo-server.mjs', import.meta.url))

test("a mounted server's tools join the registry and answer through the SDK", async t => {
  const connector = new McpConnector({ id: 'echo', command: process.execPath, args: [ECHO] })
  t.after(() => void connector.entries)

  const registry = new ToolRegistry()
  t.after(() => {
    void registry
  })
  const unmount = await connector.mount(registry)
  t.after(() => {
    unmount()
  })

  assert.deepEqual(registry.names(), ['mcp__echo__echo'])
  // The policy classifies the namespaced name as L3 — budget-gated, not free.
  assert.equal(ruleOf('mcp__echo__echo').level, 3)

  const definition = registry.definitions(['mcp__echo__echo'])[0]
  assert.ok(definition, 'the registry serves a validated definition')
  const outcome = await definition.execute({ text: 'hello connector' }, { sessionId: 's', callId: 'c' })
  const text = outcome.content[0]?.type === 'text' ? outcome.content[0].text : ''
  assert.equal(text, 'hello connector')
  assert.equal(outcome.isError, undefined)
})

test('results are bounded, errors keep their flag, and a dropped connection retries once', async () => {
  // A scripted surface: a huge result, an erroring tool, then a dead-then-alive one.
  let flakyCalls = 0
  const connector = new McpConnector(
    { id: 'stub', command: 'x' },
    {
      list: async () => ({ tools: [{ name: 'huge' }, { name: 'broken' }, { name: 'flaky' }] }),
      callTool: async input => {
        const name = (input as { name: string }).name
        if (name === 'huge') return { content: [{ type: 'text', text: 'x'.repeat(40_000) }] }
        if (name === 'broken') return { content: [{ type: 'text', text: 'the server refused' }], isError: true }
        flakyCalls += 1
        if (flakyCalls === 1) throw new Error('connection dropped')
        return { content: [{ type: 'text', text: 'recovered' }] }
      },
      close: async () => {},
    },
  )
  const entries = await connector.entries()
  const byName = new Map(entries.map(entry => [entry.name.split('__').at(-1) as string, entry]))

  // A tool's outcome as the assertions read it: content blocks or an error flag.
  type Outcome = { content?: { type: string; text?: string }[]; isError?: boolean } | undefined
  const run = (name: string) =>
    byName.get(name)?.execute({}, { sessionId: 's', callId: 'c' }) as unknown as Promise<Outcome>

  const huge = await run('huge')
  const hugeText = huge?.content?.[0]?.type === 'text' ? huge.content[0].text : ''
  assert.ok(hugeText.length < 21_000, 'bounded')
  assert.match(hugeText, /more characters cut/)

  const broken = await run('broken')
  assert.equal(broken?.isError, true)

  const flaky = await run('flaky')
  const flakyText = flaky?.content?.[0]?.type === 'text' ? flaky.content[0].text : ''
  assert.equal(flakyText, 'recovered')
  assert.equal(flakyCalls, 2, 'the first failure was retried once')
})

// Standalone stdio MCP capabilities carry secrets the same way they always did: the args
// and env a Bot mounts with hold $DSH_SECRET_<NAME> references, resolved for that Bot
// only. The check is at the process boundary — a real MCP server child reports the argv
// and environment it was started with, so no file or view may hold the resolved value.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

// The fixture is a real MCP server: its `argv` and `env` tools report what the spawned
// process actually received.
const FIXTURE = fileURLToPath(new URL('./fixtures/mcp-test-server.mjs', import.meta.url))

const team = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Chief', capabilities: [], createdAt: 1 },
    worker: { id: 'worker', sessionId: 'worker', name: 'Worker', capabilities: [], createdAt: 2 },
  },
  rooms: {},
  agents: {},
  capabilities: { items: {} as Record<string, Record<string, unknown>> },
  exchanges: [],
  exchangeTurns: {},
  works: {},
  questions: {},
  prefs: {},
  revision: 1,
  whaleStored: true,
})

const secret = (name: string, value: string, scope: string | readonly string[] = 'all') => ({
  name,
  value,
  purpose: '',
  scope,
  requestedBy: null,
  createdAt: 1,
  updatedAt: 1,
})

function fakeAgent(sessionId: string) {
  const disposers: (() => void)[] = []
  return {
    session: { id: sessionId },
    ctx: {
      effect(execute: () => unknown) {
        const dispose = execute()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
      },
      dispose() {
        for (const dispose of disposers.splice(0).reverse()) dispose()
      },
    },
  }
}

async function setup({
  state = team(),
  secrets = [],
}: {
  state?: Record<string, unknown>
  secrets?: readonly Record<string, unknown>[]
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-stdio-secrets-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  if (secrets.length > 0) writeFileSync(join(home, 'secrets.json'), JSON.stringify({ secrets }))
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  ctx.sessionTitle = { rename: async () => {} }
  const agents = new Map<string, ReturnType<typeof fakeAgent>>()
  const agentFor = (sessionId: string) => {
    let agent = agents.get(sessionId)
    if (agent === undefined) {
      agent = fakeAgent(sessionId)
      agents.set(sessionId, agent)
    }
    return agent
  }
  rt.resolveAgent = async (sessionId: string) => agentFor(sessionId)
  await rt.load()
  return {
    home,
    ctx,
    rt,
    agentFor,
    async dispose() {
      await ctx.dispose()
      rmSync(home, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

const statusOf = (rt, botId, name) => rt.capabilityStatusesView()[botId]?.[name]
const textOf = outcome => {
  const content = outcome?.content ?? []
  return content[0]?.type === 'text' ? (content[0].text ?? '') : ''
}
const callTool = async (rt, name) => {
  const definition = rt.toolRegistry.definitions([name])[0]
  assert.ok(definition, `${name} is not in the registry`)
  return definition.execute({ names: ['MCP_TEST_ENV'] }, { sessionId: 'chief', callId: `call-${name}` })
}
const waitForState = async (rt, botId, name, wanted) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (statusOf(rt, botId, name)?.state === wanted) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(
    `timed out waiting for ${botId}.${name} to be ${wanted}; observed: ${JSON.stringify(statusOf(rt, botId, name))}`,
  )
}

// Saves a stdio MCP capability, allows it, attaches it to `botId`, and mounts it on that
// Bot's Agent — the same path the service uses when a Bot's Agent is created.
async function mountStdio(
  env,
  {
    name,
    args,
    env: envMap,
    botId = 'chief',
  }: { name: string; args: readonly string[]; env: Record<string, string>; botId?: string },
) {
  const { ctx, rt } = env
  await rt.capabilitySave(
    { name, kind: 'mcp', description: '', transport: 'stdio', command: process.execPath, args, env: envMap },
    { botId },
  )
  await rt.capabilityEndpoint('capability-approve', { name })
  await rt.changeCapabilityAttachment('attach', { name }, botId)
  ctx.emit('agent/created', { agent: env.agentFor(botId) })
  await rt.scheduleCapabilitiesReconcile()
}

test('stdio MCP args resolve secret references like env does, and the child process sees the values', async t => {
  const env = await setup({
    secrets: [secret('MCP_TOKEN', 'fake-dummy-secret-125'), secret('MCP_REGION', 'fake-region-125')],
  })
  t.after(() => env.dispose())
  await mountStdio(env, {
    name: 'echo',
    args: [
      FIXTURE,
      '--token',
      '$DSH_SECRET_MCP_TOKEN',
      'pre$DSH_SECRET_MCP_TOKEN/$DSH_SECRET_MCP_REGION-post',
      'plain',
    ],
    env: { MCP_TEST_ENV: '$DSH_SECRET_MCP_REGION' },
  })
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  // The child sees argv after its own program and script names: everything we passed.
  const argv = JSON.parse(textOf(await callTool(env.rt, 'mcp__echo__argv')))
  assert.deepEqual(argv, ['--token', 'fake-dummy-secret-125', 'prefake-dummy-secret-125/fake-region-125-post', 'plain'])
  const reported = JSON.parse(textOf(await callTool(env.rt, 'mcp__echo__env')))
  assert.deepEqual(reported, { MCP_TEST_ENV: 'fake-region-125' })
  // state.json and the views keep the references, never the resolved values.
  const saved = readFileSync(join(env.home, 'state.json'), 'utf8')
  assert.equal(saved.includes('fake-dummy-secret-125'), false)
  assert.equal(saved.includes('fake-region-125'), false)
  assert.equal(JSON.stringify(env.rt.capabilityLibraryView()).includes('fake-dummy-secret-125'), false)
  assert.equal(env.rt.capabilityStatusesView().chief.echo.state, 'ready')
})

test('a missing or forbidden secret in stdio args keeps the server from starting, without leaking values', async t => {
  const env = await setup({
    secrets: [secret('MCP_TOKEN', 'fake-dummy-secret-125', ['chief']), secret('OTHER_KEY', 'other-secret-125')],
  })
  t.after(() => env.dispose())
  // MCP_TOKEN is scoped to chief, so worker's mount must fail before the process starts.
  await mountStdio(env, { name: 'denied', args: [FIXTURE, '$DSH_SECRET_MCP_TOKEN'], env: {}, botId: 'worker' })
  await waitForState(env.rt, 'worker', 'denied', 'error')
  const denied = statusOf(env.rt, 'worker', 'denied')
  assert.match(denied.error, /MCP_TOKEN/)
  assert.equal(denied.error.includes('fake-dummy-secret-125'), false)
  assert.equal(denied.error.includes('other-secret-125'), false)
  assert.equal(
    env.rt.toolRegistry.names().some(name => name.startsWith('mcp__denied__')),
    false,
  )
  // A name that is not saved at all fails the same way.
  await mountStdio(env, { name: 'missing', args: [FIXTURE, 'x$DSH_SECRET_NO_SUCH_KEY'], env: {}, botId: 'chief' })
  await waitForState(env.rt, 'chief', 'missing', 'error')
  const missing = statusOf(env.rt, 'chief', 'missing')
  assert.match(missing.error, /NO_SUCH_KEY/)
  assert.equal(missing.error.includes('other-secret-125'), false)
  assert.equal(
    env.rt.toolRegistry.names().some(name => name.startsWith('mcp__missing__')),
    false,
  )
})

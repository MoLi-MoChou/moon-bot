// Standalone capabilities (plan §阶段 6): with no DSH plugin host, a capability mounts
// through our own MCP connector into the tool registry the engine serves — the tests drive
// a real MCP server child over stdio, or a loopback Streamable HTTP server, and never a
// fake plugin host.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../index.js'
import { expandCapabilityNames, validateCapabilityName } from '../src/host/capabilities.ts'
import { fakeContext } from './fake-ctx.js'
import { startMcpHttpServer } from './fixtures/mcp-http-server.ts'

const ECHO = fileURLToPath(new URL('../dev/mcp-echo-server.mjs', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/mcp-test-server.mjs', import.meta.url))

const makeHome = state => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-capabilities-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  return home
}
const team = (): Record<string, unknown> & { bots: Record<string, { capabilities?: unknown, [key: string]: unknown }> } => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief', name: 'Chief', capabilities: [], createdAt: 1 },
    worker: { id: 'worker', sessionId: 'worker', name: 'Worker', capabilities: [], createdAt: 2 },
    helper: { id: 'helper', sessionId: 'helper', name: 'Helper', capabilities: [], createdAt: 3 },
  },
  rooms: { room: { id: 'room', members: ['chief'], sessions: { chief: 'room-chief' }, admin: 'chief', mode: 'everyone' } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  capabilities: { items: {} as Record<string, Record<string, unknown>> },
  revision: 1,
})

// Every stdio item names the echo server: a mount must never spawn `node` with no script.
const mcp = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  kind: 'mcp',
  description: 'Echo service',
  transport: 'stdio',
  command: process.execPath,
  args: [ECHO],
  env: {},
  approved: true,
  createdBy: 'chief',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

// A minimal Agent: the mount tracks it and its ctx effect drops the mounts when it goes.
function fakeAgent(sessionId: string) {
  const disposers: (() => void)[] = []
  return {
    session: { id: sessionId },
    ctx: {
      effect(execute: () => unknown) {
        const dispose = execute()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
      },
      dispose() { for (const dispose of disposers.splice(0).reverse()) dispose() },
    },
  }
}

async function setup({ state = team(), secrets = [] }: { state?: Record<string, unknown>, secrets?: readonly Record<string, unknown>[] } = {}) {
  const home = makeHome(state)
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

const mcpNames = rt => rt.toolRegistry.names().filter(name => name.startsWith('mcp__'))
const statusOf = (rt, botId, name) => rt.capabilityStatusesView()[botId]?.[name]
const textOf = outcome => {
  const content = outcome?.content ?? []
  return content[0]?.type === 'text' ? content[0].text ?? '' : ''
}
const callTool = async (rt, name, input, sessionId = 'chief') => {
  const definition = rt.toolRegistry.definitions([name])[0]
  assert.ok(definition, `${name} is not in the registry`)
  return definition.execute(input, { sessionId, callId: `call-${name}` })
}

// A mount starts a real child process, so every wait is bounded and names the observed state.
const waitFor = async (check: () => boolean, describe: () => unknown, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`timed out after ${timeoutMs}ms; observed: ${JSON.stringify(describe())}`)
}
const waitForState = (rt, botId, name, wanted) => waitFor(
  () => statusOf(rt, botId, name)?.state === wanted,
  () => statusOf(rt, botId, name),
)

test('capability names use the MCP and skill validator intersection', () => {
  assert.equal(validateCapabilityName('a'), 'a')
  assert.equal(validateCapabilityName('web-search-1'), 'web-search-1')
  for (const name of ['github', 'with_underscore', 'with--dash', '1tool', 'A', 'a'.repeat(33)]) assert.throws(() => validateCapabilityName(name))
})

test('packs expand only to MCP and skill items', () => {
  const items = { server: { kind: 'mcp' }, guide: { kind: 'skill' }, team: { kind: 'pack', items: ['server', 'guide'] } } as unknown as Parameters<typeof expandCapabilityNames>[1]
  assert.deepEqual(expandCapabilityNames(['team', 'server'], items), new Set(['server', 'guide']))
  assert.throws(() => expandCapabilityNames(['missing'], items), /No capability/)
  assert.throws(() => expandCapabilityNames(['bad'], { ...items, bad: { kind: 'pack', items: ['team'] } } as unknown as Parameters<typeof expandCapabilityNames>[1]), /unavailable capability/)
})

test('state migration adds an empty library and Bot attachment lists', async t => {
  const old = team()
  delete old.capabilities
  for (const bot of Object.values(old.bots)) delete bot.capabilities
  const env = await setup({ state: old })
  t.after(() => env.dispose())
  await env.rt.load()
  assert.deepEqual(env.rt.state.capabilities, { items: {} })
  assert.deepEqual(env.rt.state.bots.chief.capabilities, [])
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.deepEqual(saved.capabilities, { items: {} })
  assert.deepEqual(saved.bots.chief.capabilities, [])
})

test('Bot saves enforce approval and ownership, and deletion cascades', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const { rt } = env
  const { state } = rt
  const created = await rt.capabilitySave(mcp('echo'), { botId: 'worker' })
  assert.equal(created.approved, false)
  const description = await rt.capabilitySave({ ...mcp('echo'), description: 'Updated' }, { botId: 'worker' })
  assert.equal(description.approved, false)
  await rt.capabilityEndpoint('capability-approve', { name: 'echo' })
  const approved = await rt.capabilitySave({ ...mcp('echo'), description: 'Another description' }, { botId: 'worker' })
  assert.equal(approved.approved, true)
  const changed = await rt.capabilitySave(mcp('echo', { command: 'node-new' }), { botId: 'worker' })
  assert.equal(changed.approved, false)
  await assert.rejects(
    rt.capabilitySave({ name: 'echo', kind: 'skill', description: 'Other kind', content: 'Instructions' }, { botId: 'worker' }),
    error => (error as Error).message === 'A capability cannot change its kind. Delete it and save a new one.',
  )
  await assert.rejects(rt.capabilitySave(mcp('echo'), { botId: 'helper' }), /creator or a Main Bot/)
  await assert.rejects(rt.capabilityDelete('echo', { botId: 'helper' }), /creator or a Main Bot/)
  await rt.capabilitySave({ name: 'guide', kind: 'skill', description: 'Guide', content: 'Do the work.' }, { botId: 'worker' })
  await rt.capabilitySave({ name: 'team', kind: 'pack', items: ['echo', 'guide'] }, { botId: 'worker' })
  state.bots.worker.capabilities = ['echo', 'team']
  await rt.capabilityDelete('echo', { botId: 'worker' })
  assert.equal(state.capabilities.items.echo, undefined)
  assert.deepEqual(state.capabilities.items.team.items, ['guide'])
  assert.deepEqual(state.bots.worker.capabilities, ['team'])
})

test('capability Bot tools refuse sessions that are not Bot chats', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const list = env.ctx.registeredTools.get('list_capabilities')
  assert.ok(list)
  assert.match(await list.execute({}, { agent: { id: 'outside' } }), /Only Bots on the team/)
})

test('capability tool descriptions and attach results explain approval', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const parameters = env.ctx.registeredTools.get('save_capability').parameters.properties
  assert.deepEqual(
    Object.fromEntries(['transport', 'command', 'args', 'env', 'url', 'headers', 'content'].map(name => [name, parameters[name].description])),
    {
      transport: 'How to reach an MCP server: a local command or an HTTP URL',
      command: 'Program that starts a local MCP server',
      args: 'Arguments for command',
      env: 'Environment variables for command; write $DSH_SECRET_<NAME> to insert a saved secret instead of the value',
      url: 'MCP server URL; write $DSH_SECRET_<NAME> in the path or query to insert a saved secret, URL-encoded. Prefer headers for keys',
      headers: 'HTTP headers; write $DSH_SECRET_<NAME> to insert a saved secret instead of the value',
      content: 'Skill instructions',
    },
  )
  await env.rt.capabilitySave(mcp('blocked'), { botId: 'worker' })
  const attached = await env.ctx.registeredTools.get('attach_capability').execute(
    { name: 'blocked' },
    { agent: { id: 'worker' } },
  )
  assert.ok(attached.endsWith(' The user must allow blocked in DS Bot settings before it can work.'))
})

test('read-only secret reload does not requeue capability reconciliation', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  await env.rt.loadSecrets()
  await env.rt.scheduleCapabilitiesReconcile()
  env.rt.readOnly = () => 'The Bot team is open in another dsh.'
  let loads = 0
  const loadSecrets = env.rt.loadSecrets
  env.rt.loadSecrets = async () => {
    loads += 1
    return loadSecrets()
  }
  await env.rt.reconcileCapabilities()
  assert.equal(loads, 1)
})

test('one-item attach changes keep the other attachments', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const { rt } = env
  await rt.capabilitySave(mcp('echo'), { ui: true })
  await rt.capabilitySave({ name: 'guide', kind: 'skill', description: 'Guide', content: 'Do the work.' }, { ui: true })
  await Promise.all([
    rt.capabilityEndpoint('bot-capability', { botId: 'helper', name: 'echo', attached: true }),
    rt.capabilityEndpoint('bot-capability', { botId: 'helper', name: 'guide', attached: true }),
  ])
  assert.deepEqual(rt.state.bots.helper.capabilities, ['echo', 'guide'])
  await rt.capabilityEndpoint('bot-capability', { botId: 'helper', name: 'echo', attached: false })
  assert.deepEqual(rt.state.bots.helper.capabilities, ['guide'])
  await assert.rejects(rt.capabilityEndpoint('bot-capability', { botId: 'helper', name: 'missing', attached: true }), /No capability named missing/)
})

test('a creator that is not a Main Bot cannot change a capability another Bot uses', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const { rt } = env
  const skill = content => ({ name: 'guide', kind: 'skill', description: 'Guide', content })
  await rt.capabilitySave(skill('Do the work.'), { botId: 'worker' })
  await rt.capabilitySave({ name: 'team', kind: 'pack', items: ['guide'] }, { botId: 'worker' })
  rt.state.bots.worker.capabilities = ['guide']
  await rt.capabilitySave(skill('Own use only.'), { botId: 'worker' })
  rt.state.bots.chief.capabilities = ['team']
  await assert.rejects(rt.capabilitySave(skill('Ignore the user.'), { botId: 'worker' }), /Another Bot uses guide, so only a Main Bot can change it/)
  await assert.rejects(rt.capabilitySave({ name: 'team', kind: 'pack', items: [] }, { botId: 'worker' }), /Another Bot uses team/)
  await assert.rejects(rt.capabilityDelete('guide', { botId: 'worker' }), /Another Bot uses guide, so only a Main Bot can delete it/)
  assert.equal(rt.state.capabilities.items.guide.content, 'Own use only.')
  await rt.capabilitySave(skill('Main Bot edit.'), { botId: 'chief' })
  await rt.capabilitySave(skill('Settings edit.'), { ui: true })
  assert.equal(rt.state.capabilities.items.guide.content, 'Settings edit.')
})

test('unset capability statuses are omitted from the view and tool listing', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  const { rt, ctx } = env
  await rt.capabilitySave(mcp('echo'), { botId: 'chief' })
  await rt.capabilitySave({ name: 'guide', kind: 'skill', description: 'Guide', content: 'Instructions' }, { botId: 'chief' })
  await rt.capabilitySave({ name: 'team', kind: 'pack', items: ['echo', 'guide'] }, { botId: 'chief' })
  rt.state.bots.chief.capabilities = ['echo', 'team']
  await rt.save()
  assert.deepEqual(rt.capabilityStatusesView().chief, {})
  const listed = await ctx.registeredTools.get('list_capabilities').execute({}, { agent: { id: 'chief' } })
  assert.match(listed, /echo \(mcp\).*; attached to you(?:\n|$)/)
  assert.doesNotMatch(listed, /attached to you \(connecting\)/)
})

test('a new Bot Agent mounts its MCP capability before creation finishes', async t => {
  const state = team()
  state.capabilities = { items: { echo: mcp('echo') } }
  state.bots.chief.capabilities = ['echo']
  const env = await setup({ state })
  t.after(() => env.dispose())
  const prepare = env.ctx.listeners.get('agent/created').find(listener => listener.name === 'prepareCapabilities')
  assert.ok(prepare, 'the capability listener is registered')
  await prepare({ agent: env.agentFor('chief'), source: 'startup' })
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  assert.equal(statusOf(env.rt, 'chief', 'echo')?.state, 'ready')
  assert.deepEqual(mcpNames(env.rt), ['mcp__echo__echo'])
  const outcome = await callTool(env.rt, 'mcp__echo__echo', { text: 'mounted standalone' })
  assert.equal(textOf(outcome), 'mounted standalone')
})

test('reconcile picks up a capability attached after the Agent existed', async t => {
  const env = await setup()
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  await env.rt.scheduleCapabilitiesReconcile()
  assert.deepEqual(mcpNames(env.rt), [])
  assert.deepEqual(env.rt.capabilityStatusesView().chief, {})

  await env.rt.capabilitySave(mcp('echo'), { ui: true })
  await env.rt.changeCapabilityAttachment('attach', { name: 'echo' }, 'chief')
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  assert.deepEqual(mcpNames(env.rt), ['mcp__echo__echo'])
  const outcome = await callTool(env.rt, 'mcp__echo__echo', { text: 'added later' })
  assert.equal(textOf(outcome), 'added later')
})

test('an unapproved stdio MCP server shows needs-approval and mounts nothing until allowed', async t => {
  const state = team()
  state.capabilities = { items: { echo: mcp('echo', { approved: false }) } }
  state.bots.chief.capabilities = ['echo']
  const env = await setup({ state })
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'echo', 'needs-approval')
  assert.deepEqual(mcpNames(env.rt), [])

  await env.rt.capabilityEndpoint('capability-approve', { name: 'echo' })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  assert.deepEqual(mcpNames(env.rt), ['mcp__echo__echo'])
})

test('a skill can be saved and attached but not mounted', async t => {
  const state = team()
  state.capabilities = { items: { guide: { name: 'guide', kind: 'skill', description: 'Guide', content: 'Do the work.', createdBy: 'chief', createdAt: 1, updatedAt: 1 } } }
  state.bots.chief.capabilities = ['guide']
  const env = await setup({ state })
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'guide', 'error')
  assert.equal(statusOf(env.rt, 'chief', 'guide').error, 'Only MCP servers can be mounted.')
  assert.deepEqual(mcpNames(env.rt), [])
})

test('the status is connecting while a slow server starts, then ready', async t => {
  const state = team()
  state.capabilities = { items: { slow: mcp('slow', { args: [FIXTURE], env: { MCP_TEST_INIT_DELAY_MS: '400' } }) } }
  state.bots.chief.capabilities = ['slow']
  const env = await setup({ state })
  t.after(() => env.dispose())
  const running = env.rt.ensureCapabilities('chief')
  await waitForState(env.rt, 'chief', 'slow', 'connecting')
  await running
  await waitForState(env.rt, 'chief', 'slow', 'ready')
  assert.equal(statusOf(env.rt, 'chief', 'slow')?.state, 'ready')
  assert.deepEqual(mcpNames(env.rt), ['mcp__slow__echo', 'mcp__slow__env', 'mcp__slow__argv'])
})

test('a mount that cannot start surfaces an error status and no tools', async t => {
  const state = team()
  state.capabilities = { items: { broken: mcp('broken', { args: ['-e', 'process.exit(1)'] }) } }
  state.bots.chief.capabilities = ['broken']
  const env = await setup({ state })
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'broken', 'error')
  const status = statusOf(env.rt, 'chief', 'broken')
  assert.ok(typeof status.error === 'string' && status.error.length > 0, `error: ${JSON.stringify(status)}`)
  assert.equal(status.error.includes('process.exit'), false)
  assert.deepEqual(mcpNames(env.rt), [])
})

test('secret references in a stdio env are resolved for the Bot that may use them', async t => {
  const state = team()
  state.capabilities = { items: { echo: mcp('echo', { args: [FIXTURE], env: { MCP_SECRET: '$DSH_SECRET_TOKEN' } }) } }
  state.bots.chief.capabilities = ['echo']
  state.bots.worker.capabilities = ['echo']
  const secret = { name: 'TOKEN', value: 'fake-secret-value', purpose: '', scope: ['chief'], requestedBy: null, createdAt: 1, updatedAt: 1 }
  const env = await setup({ state, secrets: [secret] })
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  env.ctx.emit('agent/created', { agent: env.agentFor('worker') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  await waitForState(env.rt, 'worker', 'echo', 'error')
  await waitFor(() => mcpNames(env.rt).includes('mcp__echo__env'), () => mcpNames(env.rt))

  const reported = JSON.parse(textOf(await callTool(env.rt, 'mcp__echo__env', { names: ['MCP_SECRET'] })))
  assert.deepEqual(reported, { MCP_SECRET: 'fake-secret-value' })
  assert.match(statusOf(env.rt, 'worker', 'echo').error, /TOKEN/)
  const saved = readFileSync(join(env.home, 'state.json'), 'utf8')
  assert.equal(saved.includes('fake-secret-value'), false)
  assert.equal(JSON.stringify(env.rt.capabilityLibraryView()).includes('fake-secret-value'), false)
  assert.equal(JSON.stringify(env.rt.capabilityStatusesView()).includes('fake-secret-value'), false)
})

test('secret references in an HTTP MCP URL resolve to one encoded query value', async t => {
  const server = await startMcpHttpServer()
  const value = "mock key/+&?=#'!()* 中文"
  const state = team()
  state.capabilities = {
    items: {
      exa: {
        name: 'exa', kind: 'mcp', description: '', transport: 'streamable-http',
        url: `${server.url}?apiKey=$DSH_SECRET_EXA&mode=test`, headers: {}, approved: true,
        createdBy: 'chief', createdAt: 1, updatedAt: 1,
      },
    },
  }
  state.bots.chief.capabilities = ['exa']
  state.bots.worker.capabilities = ['exa']
  const secret = { name: 'EXA', value, purpose: '', scope: ['chief'], requestedBy: null, createdAt: 1, updatedAt: 1 }
  const env = await setup({ state, secrets: [secret] })
  t.after(async () => {
    await env.dispose()
    await server.close()
  })
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  env.ctx.emit('agent/created', { agent: env.agentFor('worker') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'exa', 'ready')
  await waitForState(env.rt, 'worker', 'exa', 'error')
  assert.equal(statusOf(env.rt, 'worker', 'exa').state, 'error')
  assert.match(statusOf(env.rt, 'worker', 'exa').error, /EXA/)

  const posted = server.requests.filter(request => request.method === 'POST')
  assert.ok(posted.length > 0, 'the connector reached the HTTP MCP server')
  for (const request of posted) {
    const url = new URL(request.url, server.url)
    assert.equal(url.searchParams.get('apiKey'), value)
    assert.equal(url.searchParams.get('mode'), 'test')
    assert.equal([...url.searchParams].length, 2)
  }
  const outcome = await callTool(env.rt, 'mcp__exa__echo', { text: 'over http' })
  assert.equal(textOf(outcome), 'over http')
  const saved = JSON.stringify(env.rt.state.capabilities)
  assert.equal(saved.includes(value), false)
  assert.equal(saved.includes(encodeURIComponent(value)), false)
  assert.equal(JSON.stringify(env.rt.capabilityLibraryView()).includes(value), false)
  assert.equal(JSON.stringify(env.rt.capabilityStatusesView()).includes(value), false)
})

test('disposing the runtime stops reconciliation and clears capability statuses', async t => {
  const state = team()
  state.capabilities = { items: { echo: mcp('echo') } }
  state.bots.chief.capabilities = ['echo']
  const env = await setup({ state })
  t.after(() => env.dispose())
  env.ctx.emit('agent/created', { agent: env.agentFor('chief') })
  await env.rt.scheduleCapabilitiesReconcile()
  await waitForState(env.rt, 'chief', 'echo', 'ready')
  const mounted = mcpNames(env.rt)
  assert.deepEqual(mounted, ['mcp__echo__echo'])

  await env.ctx.dispose()
  assert.deepEqual(env.rt.capabilityStatusesView().chief, {})
  await env.rt.scheduleCapabilitiesReconcile()
  // Disposal takes the mounted tools out of the registry, so nothing is served from a
  // stopped runtime; a later reconcile has no agents left to mount for.
  assert.deepEqual(mcpNames(env.rt), [])
})

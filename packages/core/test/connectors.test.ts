// The GitHub connector without a DSH plugin host: its tools mount through our own MCP
// connector (streamable HTTP) into the tool registry — the same path as every capability.
// The mount itself is never pointed at the network here: a closed loopback port or a
// scripted fetch drives the error states, and the pure sign-in and redaction rules stay
// covered on their own.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { signIn } from '../src/host/connectors.ts'
import { fakeContext } from './fake-ctx.ts'

const fresh = () => `ghp_${randomBytes(16).toString('hex')}`
const answer = (status: number, body: unknown): Response => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response
const requestUrl = (input: unknown): string => String(input instanceof Request ? input.url : input)

test('signIn asks GitHub who owns the token', async () => {
  const token = fresh()
  let seen
  const user = await signIn(token, { api: 'https://gh.test/', fetch: async (url, init) => { seen = { url, init }; return answer(200, { login: 'octo' }) } })
  assert.deepEqual(user, { login: 'octo' })
  assert.equal(seen.url, 'https://gh.test/user')
  assert.equal(seen.init.headers.Authorization, `Bearer ${token}`)
  await assert.rejects(signIn(token, { fetch: async () => answer(401, {}) }), /did not accept/)
  await assert.rejects(signIn(token, { fetch: async () => answer(500, {}) }), /GitHub answered 500/)
  // A 200 with a JSON null body is still our own line: a value read off null would
  // have been a TypeError instead of this error.
  await assert.rejects(signIn(token, { fetch: async () => answer(200, null) }), /did not say who this token belongs to/)
  await assert.rejects(signIn(token, { fetch: async () => { throw new Error(`boom ${token}`) } }), /^Error: Could not reach GitHub$/)
})

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

const teamHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-connectors-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  return home
}

function setup({ github = { api: 'https://gh.test' } }: { github?: Record<string, unknown> | false } = {}) {
  const home = teamHome()
  const ctx = fakeContext()
  capture(ctx)
  const rt = createRuntime(ctx, { home, github })
  return { ctx, home, rt }
}

function capture(ctx) {
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { ctx.route = route; return register(route) }
}

// Calls the /api/bot route the way the client does.
async function call(ctx, endpoint, payload) {
  const response = await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
  return response.json()
}

// GitHub's sign-in answers locally; every other request goes to the mount's URL.
const githubFetch = (real, { login = 'octo' } = {}) => async (input, init) => {
  if (requestUrl(input).startsWith('https://gh.test/')) return answer(200, { login })
  return real(input, init)
}

test('connecting saves the token, kept out of every Bot shell, and an unreachable MCP server shows an error; disconnecting undoes both', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  let dialled = 0
  globalThis.fetch = async (input, init) => {
    if (requestUrl(input).startsWith('https://gh.test/')) return answer(200, { login: 'octo' })
    dialled += 1
    return realFetch(input, init)
  }
  const { ctx, home, rt } = setup({ github: { api: 'https://gh.test', url: 'https://127.0.0.1:65500/mcp' } })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const token = fresh()

  const before = await call(ctx, 'state', {})
  assert.deepEqual(before.value.connectors, [{ id: 'github', name: 'GitHub', state: 'off', account: null }])

  const connected = await call(ctx, 'connector-connect', { id: 'github', token: ` ${token} ` })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  const [github] = connected.value
  assert.equal(github.state, 'error')
  assert.equal(github.account, 'octo')
  assert.match(github.error, /127\.0\.0\.1:9|fetch failed|ECONNREFUSED/i)
  assert.ok(dialled > 0, 'the connector dialled the streamable HTTP endpoint')
  assert.deepEqual(rt.toolRegistry.names().filter(name => name.startsWith('mcp__github__')), [])
  const state = await call(ctx, 'state', {})
  assert.deepEqual(state.value.secrets.map(secret => [secret.name, secret.scope]), [['GITHUB_TOKEN', []]])
  assert.ok(!JSON.stringify(state).includes(token))
  assert.ok(!readFileSync(join(home, 'state.json'), 'utf8').includes(token))

  const off = await call(ctx, 'connector-disconnect', { id: 'github' })
  assert.deepEqual(off.value, [{ id: 'github', name: 'GitHub', state: 'off', account: null }])
  assert.deepEqual((await call(ctx, 'state', {})).value.secrets, [])
})

test('a token GitHub refuses is not saved', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  let dialled = 0
  globalThis.fetch = async (input, init) => {
    if (requestUrl(input).startsWith('https://gh.test/')) return answer(401, {})
    dialled += 1
    return realFetch(input, init)
  }
  const { ctx, home } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const result = await call(ctx, 'connector-connect', { id: 'github', token: fresh() })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /did not accept/)
  assert.equal(dialled, 0)
  assert.deepEqual((await call(ctx, 'state', {})).value.secrets, [])
})

test('a failed MCP connection redacts the token, goes connecting then error, and Try again dials again', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  let attempts = 0
  globalThis.fetch = async (input, init) => {
    if (requestUrl(input).startsWith('https://gh.test/')) return answer(200, { login: 'octo' })
    attempts += 1
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    // The server answering with the header text is how a real MCP client can surface it.
    await new Promise(resolve => setTimeout(resolve, 120))
    throw new TypeError('fetch failed', { cause: new Error(`upstream refused ${authorization}`) })
  }
  const { ctx, home, rt } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const liveChanged = rt.liveChanged
  const transitions: string[] = []
  rt.liveChanged = () => {
    const state = rt.connectorsView()[0]?.state
    if (state === 'connecting' || state === 'error') transitions.push(state)
    liveChanged?.()
  }
  const token = fresh()
  const result = await call(ctx, 'connector-connect', { id: 'github', token })
  const [github] = result.value
  assert.equal(github.state, 'error')
  assert.ok(!github.error.includes(token), github.error)
  assert.match(github.error, /\[secret:GITHUB_TOKEN\]/)
  assert.equal(attempts, 1)
  assert.deepEqual(transitions, ['connecting', 'error'])

  const retry = call(ctx, 'connector-retry', { id: 'github' })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && rt.connectorsView()[0]?.state !== 'connecting') {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(rt.connectorsView()[0]?.state, 'connecting', `connector state: ${JSON.stringify(rt.connectorsView())}`)
  const retried = await retry
  assert.equal(retried.value[0].state, 'error')
  assert.match(retried.value[0].error, /\[secret:GITHUB_TOKEN\]/)
  assert.equal(attempts, 2)
  assert.deepEqual(transitions, ['connecting', 'error', 'connecting', 'error'])
})

test('deleting GITHUB_TOKEN on the Secrets page turns the connector off', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  globalThis.fetch = githubFetch(realFetch)
  const { ctx, home } = setup({ github: { api: 'https://gh.test', url: 'https://127.0.0.1:65500/mcp' } })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  await call(ctx, 'connector-connect', { id: 'github', token: fresh() })
  await call(ctx, 'secret-delete', { name: 'GITHUB_TOKEN' })
  const state = await call(ctx, 'state', {})
  assert.equal(state.value.connectors[0].state, 'off')
  assert.deepEqual(state.value.secrets, [])
})

test('github: false hides the connector', async (t) => {
  const { ctx, home } = setup({ github: false })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  assert.deepEqual((await call(ctx, 'state', {})).value.connectors, [])
})

test('a GitHub address without https refuses to send the token', async (t) => {
  const realFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = realFetch })
  let asked = false
  globalThis.fetch = async () => { asked = true; return answer(200, { login: 'octo' }) }
  const { ctx, home } = setup({ github: { url: 'http://mcp.test/', api: 'https://gh.test' } })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const refused = await call(ctx, 'connector-connect', { id: 'github', token: fresh() })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /https/)
  assert.equal(asked, false)
  assert.deepEqual((await call(ctx, 'state', {})).value.secrets, [])
})

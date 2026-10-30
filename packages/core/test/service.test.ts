// The standalone service (plan §阶段 3): the host modules run in-process and Fastify
// serves their channel — POST api/bot answers `state`, the SSE feed says hello, the
// password gate holds until the cookie arrives. A loopback service without a password
// stays open, as the old web mode ruled.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startService, type StandaloneService } from '../src/service/server.ts'

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 } },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

const start = async (
  t: object,
  options: { password?: string } = {},
): Promise<{ service: StandaloneService; home: string }> => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-service-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const service = await startService({ home, password: options.password })
  return { service, home }
}

const stop = async (
  t: { after: (run: () => Promise<void>) => void },
  started: { service: StandaloneService; home: string },
): Promise<void> => {
  t.after(async () => {
    await started.service.close()
    rmSync(started.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
}

test('the channel answers over HTTP and the feed says hello', async t => {
  // The image names its build through this variable; the health answer reports it.
  process.env.MOON_BOT_REVISION = 'test-rev'
  t.after(() => {
    delete process.env.MOON_BOT_REVISION
  })
  const started = await start(t)
  await stop(t, started)
  const base = started.service.url

  const state = await (
    await fetch(`${base}/api/bot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    })
  ).json()
  assert.equal(state.ok, true)
  assert.ok(Array.isArray(state.value.bots))
  assert.equal(state.value.bots[0]?.name, 'Chief')

  // The SSE feed opens with hello and the current revision.
  const feed = await fetch(`${base}/api/bot/feed`)
  assert.equal(feed.status, 200)
  const reader = feed.body?.getReader()
  assert.ok(reader)
  const { value } = await reader.read()
  const first = new TextDecoder().decode(value)
  assert.match(first, /^event: hello\ndata: \{"revision":\d+\}\n\n/)
  await reader.cancel()

  // Health answers without auth, and names the build when it was told one.
  const health = await fetch(`${base}/healthz`)
  assert.equal(health.status, 200)
  const body = (await health.json()) as { ok?: boolean; revision?: string }
  assert.equal(body.ok, true)
  assert.equal(body.revision, 'test-rev', 'the build names itself when MOON_BOT_REVISION is set')
})

test('with a password, the gate holds until the cookie arrives', async t => {
  const started = await start(t, { password: 'sesame' })
  await stop(t, started)
  const base = started.service.url

  const refused = await fetch(`${base}/api/bot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'state', payload: {} }),
  })
  assert.equal(refused.status, 401)

  const wrong = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  })
  assert.equal(wrong.status, 403)

  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'sesame' }),
  })
  assert.equal(login.status, 200)
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  assert.match(cookie, /^mb-session=/)

  const state = await (
    await fetch(`${base}/api/bot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    })
  ).json()
  assert.equal(state.ok, true)
})

test('the built UI is served beside the channel when a directory is given', async t => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-service-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ui = mkdtempSync(join(tmpdir(), 'ds-bot-ui-'))
  writeFileSync(
    join(ui, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script src="./assets/app.js"></script></body></html>',
  )
  mkdirSync(join(ui, 'assets'), { recursive: true })
  writeFileSync(join(ui, 'assets', 'app.js'), 'window.booted = true')
  const service = await startService({ home, uiDir: ui })
  t.after(async () => {
    await service.close()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  const page = await fetch(`${service.url}/`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<div id="root">/)
  const js = await fetch(`${service.url}/assets/app.js`)
  assert.equal(js.status, 200)
  assert.equal(await js.text(), 'window.booted = true')
})

test('a non-loopback bind without a password refuses to start', async () => {
  await assert.rejects(
    () => startService({ home: mkdtempSync(join(tmpdir(), 'ds-bot-service-')), host: '0.0.0.0', port: 0 }),
    /needs a password/,
  )
})

// Standalone web_search host tool: registered for Bots; empty input errors; keyless
// Bing fallback reaches the model as plain text with sources when HTML is mocked.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    r: { id: 'r', name: 'Researcher', role: 'Research', sessionId: 'r', createdAt: 2 },
  },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
})

const BING_HTML = `
<ol id="b_results">
<li class="b_algo"><h2><a href="https://example.com/a">Alpha Result</a></h2>
<div class="b_caption"><p>Alpha snippet about the topic.</p></div></li>
<li class="b_algo"><h2><a href="https://example.com/b">Beta Result</a></h2>
<div class="b_caption"><p>Beta snippet.</p></div></li>
</ol>`

function boot(home: string) {
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async (path: string) => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async (sessionId: string) => ({ agent: { session: { id: sessionId }, calls: [], inbox: { nextStep: [], nextTurn: [], remove: () => false }, followup() {}, steer() {}, cancel() {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home })
  return { ctx, rt }
}

test('web_search is registered for Bots', async () => {
  const home = mkdtempSync(join(tmpdir(), 'moon-web-search-'))
  const { ctx } = boot(home)
  try {
    assert.ok(ctx.registeredTools.has('web_search'), 'web_search registered')
  } finally {
    // Await the host's own shutdown first: it still writes while disposing, and removing
    // the folder under a write is what made ENOTEMPTY on CI.
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('web_search refuses an empty query', async () => {
  const home = mkdtempSync(join(tmpdir(), 'moon-web-search-'))
  const { ctx } = boot(home)
  try {
    const tool = ctx.registeredTools.get('web_search')
    assert.ok(tool)
    const answer = await tool.execute({ queries: [] }, { agent: { id: 'r' }, callId: 'c1' })
    assert.match(String(answer), /needs at least one query/)
  } finally {
    // Await the host's own shutdown first: it still writes while disposing, and removing
    // the folder under a write is what made ENOTEMPTY on CI.
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

test('web_search returns keyless fallback sources from a mocked Bing page', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'moon-web-search-'))
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('bing.com')) {
      return new Response(BING_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    return new Response('no', { status: 404 })
  }) as typeof fetch
  t.after(() => { globalThis.fetch = original })
  const { ctx } = boot(home)
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  const tool = ctx.registeredTools.get('web_search')
  assert.ok(tool)
  const answer = await tool.execute({ queries: ['moon bot'] }, { agent: { id: 'r' }, callId: 'c1' })
  const text = String(answer)
  assert.match(text, /keyless fallback/i)
  assert.match(text, /Alpha Result/)
  assert.match(text, /https:\/\/example\.com\/a/)
})

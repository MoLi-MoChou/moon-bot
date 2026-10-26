// The providers page over the real channel (the regression the live site found): the
// service must expose its settings and credentials to the host's providers module, so
// provider-add works, and a Bot with the added model runs its turn. The stack tests
// prewrite the settings; this one goes through the RPCs the page uses.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startService } from '../src/service/server.ts'

const openaiMock = () => {
  let script: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const text = script.shift() ?? '好了。'
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: Record<string, unknown>): void => { res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`) }
      send({ role: 'assistant', content: '' })
      send({ content: text })
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return {
    reply(...texts: string[]): void { script.push(...texts) },
    listen: (): Promise<{ port: number }> => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port }))),
    close: (): Promise<void> => new Promise(resolve => server.close(() => resolve())),
  }
}

test('the providers page adds a provider, and a Bot on it runs its turn', async (t) => {
  const mock = openaiMock()
  mock.reply('At your service.')
  const { port } = await mock.listen()
  t.after(() => void mock.close())
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-providers-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1,
    mainBotIds: ['a'],
    bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 } },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
  }))
  const service = await startService({ home, password: '', logger: false })
  t.after(() => void service.close())

  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<{ ok?: boolean, value?: unknown, error?: { message?: string } }> =>
    (await fetch(`${service.url}/api/bot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })).json() as never

  // The page's first read: available, with the built-in list to add from.
  const first = await call('providers', {})
  assert.equal(first.ok, true)
  assert.equal((first.value as { available?: boolean }).available, true)

  // Adding a provider with its key, as the page's form does.
  const added = await call('provider-add', {
    custom: true, provider: 'mocklab', name: 'Mock Lab', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${port}/v1`, key: 'sk-test', models: [{ id: 'mock-1', name: 'Mock One' }],
  })
  assert.equal(added.ok, true, JSON.stringify(added.error))
  const providers = (added.value as { providers: { id: string, key?: { configured?: boolean } }[] }).providers
  assert.ok(providers.some(entry => entry.id === 'mocklab' && entry.key?.configured === true))

  // The Bot takes the added model, and a message through the channel runs the turn.
  const updated = await call('update-bot', { id: 'a', model: 'mocklab/mock-1' })
  assert.equal(updated.ok, true)
  assert.equal((updated.value as { appliedModel?: string }).appliedModel, 'mocklab/mock-1')
  await call('send', { sessionId: 'a', text: 'hello' })

  // The reply lands in the chat the page reads.
  let reply = ''
  for (let attempt = 0; attempt < 40 && reply === ''; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250))
    const chat = await call('chat', { botId: 'a' })
    const items = (chat.value as { items: { kind: string, text?: string }[] }).items
    reply = items.filter(item => item.kind === 'bot').at(-1)?.text ?? ''
  }
  assert.match(reply, /At your service\./)
})

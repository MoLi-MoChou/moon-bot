// Phase 0 Pi prototype acceptance (docs/plans/2026-10-24-standalone-personal-agent.md §阶段 0).
// Five criteria the pi kernel (@earendil-works/pi-agent-core + @earendil-works/pi-ai) must
// pass before it may become the built-in engine, proven here against a local
// OpenAI-compatible endpoint, no real key or network:
//   ① any OpenAI-compatible endpoint (custom base URL + key),
//   ② every tool call can be intercepted / denied / suspended,
//   ③ system prompt and frozen-memory order under our control,
//   ④ cancel and resume semantics,
//   ⑤ events map onto the session/event shapes this host already consumes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'

// The text of a message's blocks, whatever else the kernel mixes into them.
const textOfBlocks = (blocks: readonly unknown[]): string =>
  blocks.map(block => (block as { text?: string }).text ?? '').join('')

// A scripted OpenAI-compatible /chat/completions endpoint. Each reply is a list of
// deltas; tool calls stream in the standard incremental form, each with its own index.
// A `{ stall: ms }` step holds the stream open, so an abort can land mid-reply. Every
// request body and its Authorization header are kept for assertions.
const openaiMock = () => {
  const requests = []
  const state = { chunks: 0 }
  let script = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      requests.push({ url: req.url, auth: req.headers.authorization, body })
      const reply = script.shift() ?? [{ content: 'ok' }]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const closed = new Promise(resolve => res.on('close', resolve))
      const id = `chatcmpl-${requests.length}`
      const send = delta => {
        state.chunks += 1
        res.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`,
        )
      }
      send({ role: 'assistant', content: '' })
      for (const delta of reply) {
        if (delta.stall !== undefined) {
          // Hold the stream open until the time is up or the client hangs up.
          await Promise.race([new Promise(resolve => setTimeout(resolve, delta.stall)), closed])
        } else send(delta)
      }
      const tools = reply.some(delta => delta.tool_calls !== undefined)
      res.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }],
        })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return {
    requests,
    state,
    reply(...deltas) {
      script.push(deltas)
    },
    listen: (): Promise<{ port: number }> =>
      new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address() as { port: number }))),
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

// A Model as pi-ai's catalog would serve it, pointed at whatever OpenAI-compatible
// base URL the caller runs. `input` is required: image-support checks read it.
const model = (baseUrl): Model<Api> =>
  ({
    id: 'mock-1',
    name: 'Mock',
    api: 'openai-completions',
    provider: 'mock',
    baseUrl,
    input: ['text'],
    reasoning: false,
    contextWindow: 100000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }) as unknown as Model<Api>

const tool = (name, execute) => ({
  name,
  label: name,
  description: `test tool ${name}`,
  parameters: Type.Object({}),
  execute,
})

// One streamed tool-call delta at `index`.
const call = (index, id, name) => ({
  tool_calls: [{ index, id, type: 'function', function: { name, arguments: '{}' } }],
})

test('an OpenAI-compatible endpoint with a custom base URL and key drives the agent', async () => {
  const mock = openaiMock()
  const address = await mock.listen()
  mock.reply({ content: 'hello from the custom endpoint' })
  const agent = new Agent({
    initialState: { systemPrompt: 'You are the prototype.', model: model(`http://127.0.0.1:${address.port}/v1`) },
    streamFn: streamSimple,
    getApiKey: () => 'sk-prototype',
  })
  await agent.prompt('ping')
  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0].url, '/v1/chat/completions')
  assert.equal(mock.requests[0].auth, 'Bearer sk-prototype')
  assert.equal(mock.requests[0].body.model, 'mock-1')
  const said = agent.state.messages
    .filter(m => m.role === 'assistant')
    .map(m => textOfBlocks(m.content))
    .join('')
  assert.equal(said, 'hello from the custom endpoint')
  await mock.close()
})

test('a tool call can be allowed, denied, and held until a gate opens', async () => {
  const mock = openaiMock()
  const address = await mock.listen()
  const seen = []
  let openGate
  const gate = new Promise(resolve => {
    openGate = resolve
  })
  const mk = name => tool(name, async () => ({ content: [{ type: 'text', text: `${name} ran` }] }))
  const agent = new Agent({
    initialState: {
      systemPrompt: 'proto',
      model: model(`http://127.0.0.1:${address.port}/v1`),
      tools: [mk('allowed'), mk('denied'), mk('held')],
    },
    streamFn: streamSimple,
    getApiKey: () => 'sk',
    // The gate is the approval flow: the call stays in flight until it opens.
    beforeToolCall: async context => {
      seen.push(context.toolCall.name)
      if (context.toolCall.name === 'denied') return { block: true, reason: 'not permitted' }
      if (context.toolCall.name === 'held') await gate
      return undefined
    },
  })
  mock.reply(call(0, 'c1', 'allowed'), call(1, 'c2', 'denied'))
  mock.reply(call(0, 'c3', 'held'))
  mock.reply({ content: 'done' })
  const run = agent.prompt('use tools')
  // The held call suspends the loop; the gate opens only when it is the one left.
  await new Promise(resolve => setTimeout(resolve, 50))
  openGate()
  await run
  // The blocked call comes back to the model as an error result, in order.
  assert.deepEqual(seen, ['allowed', 'denied', 'held'])
  const transcript = JSON.stringify(agent.state.messages)
  assert.match(transcript, /allowed ran/)
  assert.match(transcript, /not permitted/)
  assert.match(transcript, /held ran/)
  await mock.close()
})

test('the system prompt and the frozen memory segment keep the order we set', async () => {
  const mock = openaiMock()
  const address = await mock.listen()
  const base = 'You are Moon Bot.\n## Frozen memory\nlikes: tea'
  const agent = new Agent({
    initialState: { systemPrompt: base, model: model(`http://127.0.0.1:${address.port}/v1`) },
    streamFn: streamSimple,
    getApiKey: () => 'sk',
    // The dynamic segment is injected on every request, after the frozen one, without
    // touching the stored transcript: the stable prefix keeps its bytes.
    transformContext: async messages => [
      ...messages,
      { role: 'system', content: '## Now\n10:00', timestamp: Date.now() },
    ],
  })
  mock.reply({ content: 'a' })
  await agent.prompt('first')
  mock.reply({ content: 'b' })
  await agent.prompt('second')
  const systems = mock.requests.map(request =>
    request.body.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n'),
  )
  assert.equal(systems.length, 2)
  for (const system of systems) {
    assert.ok(system.indexOf('You are Moon Bot.') < system.indexOf('## Frozen memory'), 'base before frozen memory')
    assert.ok(system.indexOf('## Frozen memory') < system.indexOf('## Now'), 'frozen memory before the dynamic segment')
  }
  await mock.close()
})

test('a run cancels mid-stream and resumes from the same transcript', async () => {
  const mock = openaiMock()
  const address = await mock.listen()
  const agent = new Agent({
    initialState: { systemPrompt: 'proto', model: model(`http://127.0.0.1:${address.port}/v1`) },
    streamFn: streamSimple,
    getApiKey: () => 'sk',
  })
  // The first reply says a word, then stalls: the abort lands inside the stream, after
  // the client has the word.
  mock.reply({ content: 'partial' }, { stall: 5000 }, { content: ' more' })
  const first = agent.prompt('start')
  while (
    !String((agent.state.streamingMessage?.content?.[0] as { text?: string } | undefined)?.text ?? '').startsWith(
      'partial',
    )
  ) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  agent.abort()
  await first
  const stopped = agent.state.messages.filter(m => m.role === 'assistant').at(-1)
  assert.equal(stopped.stopReason, 'aborted')
  assert.match(textOfBlocks(stopped.content), /^partial/)
  // Resume: the next run continues from the same transcript. The aborted partial stays
  // in the transcript (the host can still show what was said), though pi's LLM
  // conversion leaves unfinished aborted replies off the wire.
  mock.reply({ content: 'resumed' })
  agent.followUp({ role: 'user', content: 'go on', timestamp: Date.now() })
  await agent.continue()
  const kept = agent.state.messages.filter(m => m.role === 'assistant').map(m => textOfBlocks(m.content))
  assert.ok(
    kept.some(text => text.startsWith('partial')),
    'the aborted partial answer stays in the transcript',
  )
  const wire = mock.requests.at(-1).body.messages
  assert.ok(
    wire.some(m => m.role === 'user' && JSON.stringify(m).includes('start')),
    'the earlier turn is still in context',
  )
  assert.ok(
    wire.some(m => m.role === 'user' && JSON.stringify(m).includes('go on')),
    'the follow-up was sent',
  )
  const finalText = textOfBlocks(agent.state.messages.filter(m => m.role === 'assistant').at(-1).content)
  assert.equal(finalText, 'resumed')
  await mock.close()
})

test('agent events map onto the session/event shapes this host routes', async () => {
  const mock = openaiMock()
  const address = await mock.listen()
  const agent = new Agent({
    initialState: {
      systemPrompt: 'proto',
      model: model(`http://127.0.0.1:${address.port}/v1`),
      tools: [tool('note', async () => ({ content: [{ type: 'text', text: 'noted' }] }))],
    },
    streamFn: streamSimple,
    getApiKey: () => 'sk',
  })
  // The mapping the built-in engine will install: pi events in, the DSH session/event
  // vocabulary this host already consumes out.
  const events = []
  let turn = 0
  agent.subscribe(event => {
    if (event.type === 'agent_start') {
      turn += 1
      events.push({ type: 'turn/start', data: { turn } })
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      events.push({
        type: 'assistant/message',
        data: {
          message: {
            content: event.message.content.map(block =>
              block.type === 'toolCall'
                ? { type: 'tool-call', id: block.id, name: block.name, arguments: JSON.stringify(block.arguments) }
                : block.type === 'text'
                  ? { type: 'text', text: block.text }
                  : block,
            ),
          },
        },
      })
    }
    if (event.type === 'tool_execution_start')
      events.push({
        type: 'tool/call',
        data: { callId: event.toolCallId, name: event.toolName, arguments: JSON.stringify(event.args ?? {}) },
      })
    if (event.type === 'tool_execution_end') events.push({ type: 'tool/result', data: { callId: event.toolCallId } })
    if (event.type === 'agent_end') events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  })
  mock.reply({ content: 'One moment.' }, call(0, 'k1', 'note'))
  mock.reply({ content: 'Noted and done.' })
  await agent.prompt('take a note')
  const kinds = events.map(event => event.type)
  assert.deepEqual(kinds, [
    'turn/start',
    'assistant/message',
    'tool/call',
    'tool/result',
    'assistant/message',
    'turn/end',
  ])
  const firstAnswer = events
    .find(event => event.type === 'assistant/message')
    .data.message.content.find(b => b.type === 'text').text
  assert.equal(firstAnswer, 'One moment.')
  await mock.close()
})

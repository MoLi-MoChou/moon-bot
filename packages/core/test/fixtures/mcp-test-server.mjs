// A stand-in stdio MCP server for capability tests: it echoes text, reports the argv and
// the named environment variables it was started with, and can delay its initialize reply
// so a test can observe the connecting status. MCP_TEST_INIT_DELAY_MS sets that delay.
import { createInterface } from 'node:readline'

const delayMs = Number(process.env.MCP_TEST_INIT_DELAY_MS ?? 0)
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const text = value => ({ content: [{ type: 'text', text: String(value) }] })
const tools = [
  {
    name: 'echo',
    description: 'Return the supplied text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'env',
    description: 'Report the named environment variables.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
      required: ['names'],
    },
  },
  {
    name: 'argv',
    description: 'Report the arguments after the script.',
    inputSchema: { type: 'object', properties: {} },
  },
]

for await (const line of createInterface({ input: process.stdin })) {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    continue
  }
  if (!request || request.id === undefined) continue
  let result
  switch (request.method) {
    case 'initialize':
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      result = {
        protocolVersion: request.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'test-echo', version: '1.0.0' },
      }
      break
    case 'ping':
      result = {}
      break
    case 'tools/list':
      result = { tools }
      break
    case 'tools/call': {
      const name = request.params?.name
      const args = request.params?.arguments ?? {}
      if (name === 'env') {
        const names = Array.isArray(args.names) ? args.names : []
        result = text(
          JSON.stringify(Object.fromEntries(names.map(key => [String(key), process.env[String(key)] ?? null]))),
        )
      } else if (name === 'argv') {
        result = text(JSON.stringify(process.argv.slice(2)))
      } else {
        result = text(args.text ?? '')
      }
      break
    }
    default:
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })
      continue
  }
  send({ jsonrpc: '2.0', id: request.id, result })
}

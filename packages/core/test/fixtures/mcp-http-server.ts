// A minimal Streamable HTTP MCP server for tests: enough of the protocol for the MCP SDK
// client to initialize, list and call one tool, over loopback only. Every request's URL is
// recorded so a test can see the URL a capability's secret reference resolved to.
import { createServer } from 'node:http'
import type { Server } from 'node:http'

export interface RecordedRequest {
  readonly method: string
  readonly url: string
}

export interface TestMcpHttpServer {
  readonly url: string
  readonly requests: RecordedRequest[]
  close(): Promise<void>
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Return the supplied text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
]

const readBody = async (request: AsyncIterable<Buffer | string>): Promise<string> => {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body
}

interface JsonRpcBody {
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: {
    readonly protocolVersion?: unknown
    readonly arguments?: { readonly text?: unknown }
  }
}

export async function startMcpHttpServer(): Promise<TestMcpHttpServer> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' })
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    void (async () => {
      let body: JsonRpcBody
      try {
        body = JSON.parse(await readBody(request)) as JsonRpcBody
      } catch {
        response.writeHead(400).end()
        return
      }
      // A notification has no id and gets no body.
      if (body.id === undefined) {
        response.writeHead(202).end()
        return
      }
      let result
      if (body.method === 'initialize') {
        result = {
          protocolVersion: body.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'test-http-echo', version: '1.0.0' },
        }
      } else if (body.method === 'tools/list') {
        result = { tools: TOOLS }
      } else if (body.method === 'tools/call') {
        result = { content: [{ type: 'text', text: String(body.params?.arguments?.text ?? '') }] }
      } else {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }))
        return
      }
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The test MCP server did not bind a port.')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

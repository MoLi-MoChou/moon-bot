// The ACP wire (plan §阶段 5): JSON-RPC 2.0 over a transport, one message per line. We
// are the client: we initialize, open sessions, and prompt; the agent answers requests
// and streams session/update notifications that the adapter maps to engine events. The
// shapes here are the protocol's own vocabulary.
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly method: string
  readonly params?: Readonly<Record<string, unknown>> | undefined
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: Readonly<Record<string, unknown>> | undefined
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly result?: unknown
  readonly error?: { readonly code?: number | undefined; readonly message?: string | undefined } | undefined
}

export type Inbound = JsonRpcResponse | JsonRpcNotification | JsonRpcRequest

/** One ACP session/update, as the agent streams it. */
export interface SessionUpdate {
  readonly sessionId: string
  readonly update: Readonly<Record<string, unknown>>
}

export const UPDATE_OF = (notification: JsonRpcNotification): SessionUpdate | undefined => {
  if (notification.method !== 'session/update') return undefined
  const params = notification.params
  if (params === null || typeof params !== 'object') return undefined
  const view = params as { sessionId?: unknown; update?: unknown }
  if (typeof view.sessionId !== 'string' || view.update === null || typeof view.update !== 'object') return undefined
  return { sessionId: view.sessionId, update: view.update as Readonly<Record<string, unknown>> }
}

/** The line protocol: newline-delimited JSON both ways. */
export class LineProtocol {
  private buffer = ''

  private readonly write: (line: string) => void
  private readonly receive: (message: Inbound) => void

  constructor(write: (line: string) => void, receive: (message: Inbound) => void) {
    this.write = write
    this.receive = receive
  }

  send(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    this.write(JSON.stringify(message))
  }

  /** Feeds raw bytes; complete lines become messages. */
  feed(chunk: string): void {
    this.buffer += chunk
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (line === '') continue
      try {
        this.receive(JSON.parse(line) as Inbound)
      } catch {
        /* a torn line is skipped, not fatal */
      }
    }
  }
}

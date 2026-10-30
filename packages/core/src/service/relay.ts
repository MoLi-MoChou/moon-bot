// The relay (2026-10-27 remote-agents): pairing and blind forwarding between the host's
// ACP runtimes and the remote agents that dial in. One connection per agentId; a new
// connection replaces the old one (close code 4000). The relay reads nothing of what it
// carries — a frame is a JSON-RPC line, opaque here — and stores no conversation: the
// Bot's own store keeps the history, as with any engine.
import type { RelayPipe, RelayPort } from '../engine/acp/transport.ts'
import type { RelayInvites } from '../store/relay.ts'

/** The socket the service hands the relay; `ws` structurally satisfies it. */
export interface RelaySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export const RELAY_CLOSE_REPLACED = 4000
export const RELAY_CLOSE_UNAUTHORIZED = 4401
export const RELAY_CLOSE_REVOKED = 4403

interface AgentConnection {
  readonly socket: RelaySocket
  line: ((line: string) => void) | undefined
  closed: (() => void) | undefined
}

interface UpWaiter {
  readonly agentId: string
  readonly receive: () => void
}

export class RelayRegistry implements RelayPort {
  private readonly connections = new Map<string, AgentConnection>()
  private readonly upWaiters = new Set<UpWaiter>()
  private readonly invites: RelayInvites

  constructor(invites: RelayInvites) {
    this.invites = invites
  }

  /**
   * Adopts a verified upgrade: validates the token, replaces any connection the agentId
   * already has, and answers undefined when the token names nothing — the route closes
   * the socket itself.
   */
  admit(socket: RelaySocket, token: string): string | undefined {
    const agentId = this.invites.verify(token)
    if (agentId === undefined) return undefined
    this.invites.seen(agentId)
    const replaced = this.connections.get(agentId)
    if (replaced !== undefined) {
      this.connections.delete(agentId)
      replaced.closed?.()
      replaced.socket.close(RELAY_CLOSE_REPLACED, 'replaced by a newer connection')
    }
    const connection: AgentConnection = { socket, line: undefined, closed: undefined }
    this.connections.set(agentId, connection)
    socket.on('message', data => {
      const text =
        typeof data === 'string' ? data : Array.isArray(data) ? data.map(part => String(part)).join('') : String(data)
      for (const line of text.split('\n')) if (line.trim() !== '') connection.line?.(line.trim())
    })
    const gone = () => {
      if (this.connections.get(agentId) !== connection) return // already replaced
      this.connections.delete(agentId)
      connection.closed?.()
    }
    socket.on('close', gone)
    socket.on('error', gone)
    for (const waiter of this.upWaiters) {
      if (waiter.agentId === agentId) waiter.receive()
    }
    return agentId
  }

  /** RelayPort: the pipe an AcpRuntime writes through, when the agent is connected. */
  connect(agentId: string): RelayPipe | undefined {
    const connection = this.connections.get(agentId)
    if (connection === undefined) return undefined
    return {
      write: line => {
        connection.socket.send(line)
      },
      onLine: receive => {
        connection.line = receive
      },
      onClosed: receive => {
        connection.closed = receive
      },
    }
  }

  /** RelayPort: fires when the agent comes up, so a transport waiting on it attaches. */
  onUp(agentId: string, receive: () => void): void {
    this.upWaiters.add({ agentId, receive })
  }

  /** Cuts an agent off; the revoke op calls this so a revoked token dies immediately. */
  disconnect(agentId: string): boolean {
    const connection = this.connections.get(agentId)
    if (connection === undefined) return false
    this.connections.delete(agentId)
    connection.closed?.()
    connection.socket.close(RELAY_CLOSE_REVOKED, 'the invite was revoked')
    return true
  }

  online(): readonly string[] {
    return [...this.connections.keys()].sort()
  }

  // The invite admin the channel ops call; revoke also cuts the live wire, so a
  // revoked token dies the second it is revoked, not at the next reconnect.
  invitesView(): readonly {
    readonly agentId: string
    readonly createdAt: number
    readonly revokedAt: number | null
    readonly lastSeenAt: number | null
    readonly online: boolean
  }[] {
    const online = new Set(this.connections.keys())
    return this.invites.list().map(row => ({
      agentId: row.agentId,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      lastSeenAt: row.lastSeenAt,
      online: online.has(row.agentId),
    }))
  }

  inviteCreate(agentId: string): { readonly agentId: string; readonly token: string } {
    const created = this.invites.create(agentId)
    return { agentId: created.row.agentId, token: created.token }
  }

  inviteRevoke(agentId: string): boolean {
    const revoked = this.invites.revoke(agentId)
    this.disconnect(agentId)
    return revoked
  }

  /** No connections left; the service is shutting down. */
  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.closed?.()
      connection.socket.close(1001, 'the service is closing')
    }
    this.connections.clear()
  }
}

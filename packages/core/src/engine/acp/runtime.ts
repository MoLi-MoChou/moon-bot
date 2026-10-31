// ACP adapter: runs an AgentRuntime over a local or relay ACP transport.
import { randomUUID } from 'node:crypto'
import type { EngineEvent } from '../events.ts'
import type { AgentRuntime, CancelReason, TurnInput, TurnMessage } from '../runtime.ts'
import { callFailureOf } from '../failure.ts'
import { matchPermissionOutcome, type PermissionRequestParams } from './permission.ts'
import { LineProtocol, UPDATE_OF, type Inbound, type JsonRpcNotification, type JsonRpcRequest } from './protocol.ts'
import {
  eventsOfUpdate,
  type AcpAgentOptions,
  type Waiter,
  type AgentSession,
  type PendingPermission,
} from './runtime-types.ts'
export { eventsOfUpdate } from './runtime-types.ts'
export type { AcpAgentOptions, AcpStoredMessage, Waiter, AgentSession } from './runtime-types.ts'

export class AcpRuntime implements AgentRuntime {
  private nextId = 1
  private readonly pending = new Map<number, Waiter>()
  private readonly pendingPermissions = new Map<number | string, PendingPermission>()
  private async appendTranscript(
    sessionId: string,
    message: import('./runtime-types.ts').AcpStoredMessage,
  ): Promise<void> {
    await this.options.transcript?.append(sessionId, message)
  }

  private appendOrdered(
    session: AgentSession,
    sessionId: string,
    message: import('./runtime-types.ts').AcpStoredMessage,
  ): Promise<void> {
    const next = (session.transcriptTail ?? Promise.resolve()).then(() => this.appendTranscript(sessionId, message))
    session.transcriptTail = next.catch(() => undefined)
    return next
  }
  private readonly sessions = new Map<string, AgentSession>()
  private started: Promise<void> | undefined
  private readonly options: AcpAgentOptions

  constructor(options: AcpAgentOptions) {
    this.options = options
  }

  private get protocol(): LineProtocol {
    this.wire ??= new LineProtocol(
      line => {
        this.options.transport.write(line)
      },
      message => {
        this.receive(message)
      },
    )
    return this.wire
  }

  private wire: LineProtocol | undefined

  get isRunning(): boolean {
    const t = this.options.transport as { running?: boolean }
    return t.running ?? this.started !== undefined
  }

  async start(): Promise<void> {
    if (this.started === undefined) {
      this.started = (async () => {
        this.options.transport.onLine(line => {
          this.protocol.feed(`${line}\n`)
        })
        this.options.transport.onClosed(() => {
          const error = new Error('the agent connection closed')
          for (const waiter of this.pending.values()) waiter.reject(error)
          this.pending.clear()
          for (const pending of this.pendingPermissions.values()) pending.resolve('cancelled')
          this.pendingPermissions.clear()
          this.sessions.clear()
          this.started = undefined
          this.wire = undefined
        })
        await this.options.transport.open()
        const result = (await this.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { read: false, write: false } },
          clientInfo: { name: this.options.clientName ?? 'moon-bot', version: this.options.clientVersion ?? '0.1.0' },
        })) as { sessionId?: unknown } | null
        void result
        await this.notify('initialized', {})
      })()
      this.started.catch(() => {
        this.started = undefined
      })
    }
    return this.started
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) session.stop?.()
    this.sessions.clear()
    for (const pending of this.pendingPermissions.values()) pending.resolve('cancelled')
    this.pendingPermissions.clear()
    this.options.transport.dispose()
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const history = (await this.options.transcript?.history(input.sessionId)) ?? []
    const nextTurn = Math.max(0, ...history.map(message => message.turn ?? 0)) + 1
    const refused = async (message: string): Promise<readonly EngineEvent[]> => {
      const events: readonly EngineEvent[] = [
        { type: 'turn/start', turn: nextTurn },
        { type: 'turn/end', turn: nextTurn, reason: { kind: 'error', error: callFailureOf(message) } },
      ]
      await this.appendTranscript(input.sessionId, {
        role: 'user',
        content: input.message.content,
        turn: nextTurn,
        ...(input.message.source !== undefined ? { source: input.message.source } : {}),
        at: Date.now(),
      })
      await this.appendTranscript(input.sessionId, {
        role: 'system',
        content: message === '' ? [] : [{ type: 'text', text: message }],
        turn: nextTurn,
        source: { kind: 'turn-error' },
        at: Date.now(),
      })
      for (const event of events) this.options.emit(input.sessionId, event)
      return events
    }
    let acpId: string
    try {
      await this.start()
      acpId = await this.openSession(input)
    } catch (error) {
      yield* await refused(error instanceof Error ? error.message : String(error))
      return
    }
    const session = this.sessions.get(input.sessionId)
    if (session === undefined) {
      yield* await refused('the ACP session is gone')
      return
    }
    session.turns = Math.max(session.turns, nextTurn - 1)
    session.turns += 1
    const turn = session.turns
    const queue: EngineEvent[] = []
    session.updates = event => {
      queue.push(event)
      this.options.emit(input.sessionId, event)
      if (event.type === 'assistant/message') {
        void this.appendOrdered(session, input.sessionId, {
          role: 'assistant',
          content: event.message.content,
          turn,
          at: Date.now(),
        }).catch(() => undefined)
      } else if (event.type === 'user/message') {
        void this.appendOrdered(session, input.sessionId, {
          role: 'user',
          content: event.content,
          turn,
          ...(event.source !== undefined ? { source: event.source } : {}),
          at: Date.now(),
        }).catch(() => undefined)
      }
    }
    for (const event of [
      { type: 'turn/start', turn },
      { type: 'user/message', content: input.message.content, source: input.message.source },
    ] as const)
      session.updates(event)
    let settled = false
    const done = this.request('session/prompt', {
      sessionId: acpId,
      prompt: [
        {
          type: 'text',
          text: input.message.content
            .map(block => (block.type === 'text' ? block.text : JSON.stringify(block)))
            .join('\n'),
        },
      ],
    }).finally(() => {
      settled = true
    })
    let failure: Error | undefined
    while (!settled || queue.length > 0) {
      if (queue.length === 0) {
        if (!settled) await new Promise(resolve => setImmediate(resolve))
        continue
      }
      yield queue.shift() as EngineEvent
    }
    try {
      await done
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
    session.updates = undefined
    if (!queue.some(event => event.type === 'turn/end')) {
      const end: EngineEvent =
        failure !== undefined
          ? { type: 'turn/end', turn, reason: { kind: 'error', error: callFailureOf(failure) } }
          : { type: 'turn/end', turn, reason: { kind: 'completed' } }
      queue.push(end)
      this.options.emit(input.sessionId, end)
    }
    const reason = failure === undefined ? undefined : callFailureOf(failure)
    await this.appendOrdered(session, input.sessionId, {
      role: 'system',
      content: reason?.message === undefined ? [] : [{ type: 'text', text: reason.message }],
      turn,
      source: {
        kind: 'turn-end',
        ...(reason?.code !== undefined ? { code: reason.code } : {}),
      },
      at: Date.now(),
    }).catch(() => undefined)
    while (queue.length > 0) yield queue.shift() as EngineEvent
  }

  async steer(sessionId: string, message: TurnMessage): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return false
    // ACP has no mid-prompt injection; the message queues as the next turn's prompt.
    const update = { type: 'user/message', content: message.content, source: message.source } as const
    if (session.updates === undefined) return false
    try {
      await this.appendOrdered(session, sessionId, {
        role: 'user',
        content: message.content,
        turn: session.turns,
        ...(message.source !== undefined ? { source: message.source } : {}),
        at: Date.now(),
      })
      await this.request('session/update', {
        sessionId: session.acpId,
        update: { sessionUpdate: 'user_message', content: message.content },
      })
    } catch {
      return false
    }
    session.updates(update)
    return true
  }

  async cancelTurn(sessionId: string, reason: CancelReason = 'user'): Promise<void> {
    void reason
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.sessionId === sessionId) {
        pending.resolve('cancelled')
        this.pendingPermissions.delete(id)
      }
    }
    await this.notify('session/cancel', { sessionId: session.acpId }).catch(() => undefined)
    session.stop?.()
  }

  private async openSession(input: TurnInput): Promise<string> {
    const existing = this.sessions.get(input.sessionId)
    if (existing !== undefined) return existing.acpId
    const cwd = input.config?.cwd
    const result = (await this.request('session/new', {
      ...(cwd !== undefined && cwd !== '' ? { cwd } : {}),
      ...(input.config?.model !== undefined ? { model: { id: input.config.model } } : {}),
      ...(input.config?.systemPrompt !== undefined ? { mcpServers: [] } : {}),
    })) as { sessionId?: unknown } | null
    const acpId = typeof result?.sessionId === 'string' ? result.sessionId : randomUUID()
    this.sessions.set(input.sessionId, { acpId, turns: 0, updates: undefined, stop: undefined })
    return acpId
  }

  private request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.protocol.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        // A wire that is down answers nothing; the waiter must not outlive it.
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private async notify(method: string, params: Readonly<Record<string, unknown>>): Promise<void> {
    this.protocol.send({ jsonrpc: '2.0', method, params })
  }

  private receive(message: Inbound): void {
    if ('method' in message && 'id' in message && message.id !== undefined) {
      void this.handleAgentRequest(message as JsonRpcRequest)
      return
    }
    if ('id' in message && !('method' in message)) {
      const id = typeof message.id === 'number' ? message.id : Number(message.id)
      const waiter = this.pending.get(id)
      if (waiter === undefined) return
      this.pending.delete(id)
      if (message.error !== undefined)
        waiter.reject(new Error(message.error.message ?? `the agent refused (${String(message.error.code ?? '')})`))
      else waiter.resolve(message.result)
      return
    }
    const update = UPDATE_OF(message as JsonRpcNotification)
    if (update === undefined) return
    for (const session of this.sessions.values()) {
      if (session.acpId !== update.sessionId) continue
      for (const event of eventsOfUpdate(update.update)) session.updates?.(event)
      return
    }
  }

  private async handleAgentRequest(request: JsonRpcRequest): Promise<void> {
    if (request.method === 'session/request_permission' || request.method === 'request_permission') {
      const params = (request.params ?? {}) as PermissionRequestParams
      let targetSessionId = ''
      for (const [moonId, session] of this.sessions.entries()) {
        if (session.acpId === params.sessionId) {
          targetSessionId = moonId
          break
        }
      }
      if (targetSessionId === '') {
        this.protocol.send({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'Unknown ACP session' } })
        return
      }
      const decisionPromise = new Promise<string>(resolve => {
        this.pendingPermissions.set(request.id, { sessionId: targetSessionId, resolve })
      })
      void Promise.resolve(this.options.requestPermission?.(targetSessionId, params))
        .then(res => this.pendingPermissions.get(request.id)?.resolve(res ?? 'cancelled'))
        .catch(() => this.pendingPermissions.get(request.id)?.resolve('cancelled'))

      const decision = await decisionPromise
      this.pendingPermissions.delete(request.id)
      const result = matchPermissionOutcome(params.options, decision)
      this.protocol.send({ jsonrpc: '2.0', id: request.id, result })
      return
    }
    this.protocol.send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method '${request.method}' not supported` },
    })
  }
}

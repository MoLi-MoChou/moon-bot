// The ACP adapter (plan §阶段 5): an AgentRuntime whose turns run in an external agent
// — Claude Agent, Gemini CLI, opencode — over the ACP wire. This is the second
// implementation of the seam, which is itself the plan's proof that AgentRuntime is
// replaceable: the host's roster, groups and deliveries treat an ACP Bot exactly like a
// built-in one. What the protocol does not cover (the plan's degradation matrix) simply
// does not happen here: no frozen-memory injection beyond the prompt text we send, no
// gating of calls the agent makes on its own. The wire itself is a transport (2026-10-27
// remote-agents): a spawned child's stdio, or a relay connection to another machine.
import { randomUUID } from 'node:crypto'
import type { EngineEvent } from '../events.ts'
import type { AgentRuntime, CancelReason, TurnInput, TurnMessage } from '../runtime.ts'
import { LineProtocol, UPDATE_OF, type Inbound, type JsonRpcNotification } from './protocol.ts'
import type { AcpTransport } from './transport.ts'

export interface AcpAgentOptions {
  /** The wire to the agent: local stdio or a relay connection. */
  readonly transport: AcpTransport
  /** The client's own name, as the agent sees it in initialize. */
  readonly clientName?: string | undefined
  readonly clientVersion?: string | undefined
  /** Where the emit fanout goes, the same as the built-in engine's. */
  readonly emit: (sessionId: string, event: EngineEvent) => void
}

interface Waiter {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/** One live ACP session: its id, the turn running on it, and the events it made. */
interface AgentSession {
  readonly acpId: string
  turns: number
  updates: ((event: EngineEvent) => void) | undefined
  stop: (() => void) | undefined
}

export class AcpRuntime implements AgentRuntime {
  private nextId = 1
  private readonly pending = new Map<number, Waiter>()
  private readonly sessions = new Map<string, AgentSession>()
  private started: Promise<void> | undefined

  private readonly options: AcpAgentOptions

  constructor(options: AcpAgentOptions) {
    this.options = options
  }

  private get protocol(): LineProtocol {
    this.wire ??= new LineProtocol(
      line => { this.options.transport.write(line) },
      message => { this.receive(message) },
    )
    return this.wire
  }

  private wire: LineProtocol | undefined

  async start(): Promise<void> {
    if (this.started === undefined) {
      this.started = (async () => {
        // The transport hands over complete lines; the protocol's own framing is
        // newline-terminated chunks, so the terminator goes back on here.
        this.options.transport.onLine(line => { this.protocol.feed(`${line}\n`) })
        this.options.transport.onClosed(() => {
          const error = new Error('the agent connection closed')
          for (const waiter of [...this.pending.values()]) waiter.reject(error)
          this.pending.clear()
          // The agent on the other end is gone; its session ids died with it. A
          // reconnected agent gets fresh sessions on the next turn.
          this.sessions.clear()
          // The next agent (a respawned child, a new relay connection) has not seen
          // initialize, and a torn line of the old one must not prefix its first line.
          this.started = undefined
          this.wire = undefined
        })
        await this.options.transport.open()
        const result = await this.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { read: false, write: false } },
          clientInfo: { name: this.options.clientName ?? 'moon-bot', version: this.options.clientVersion ?? '0.1.0' },
        }) as { sessionId?: unknown } | null
        void result
        await this.notify('initialized', {})
      })()
      // A start that failed (the agent was offline) must not poison every later
      // turn: the next turn tries the wire again.
      this.started.catch(() => { this.started = undefined })
    }
    return this.started
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) session.stop?.()
    this.sessions.clear()
    this.options.transport.dispose()
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    // A turn that cannot reach the agent still ends through the fanout: the router
    // listens there, not on this generator.
    const refused = (message: string): readonly EngineEvent[] => {
      const events: readonly EngineEvent[] = [{ type: 'turn/start', turn: 1 }, { type: 'turn/end', turn: 1, reason: { kind: 'error', error: { message } } }]
      for (const event of events) this.options.emit(input.sessionId, event)
      return events
    }
    let acpId: string
    try {
      await this.start()
      acpId = await this.openSession(input)
    } catch (error) {
      yield* refused(error instanceof Error ? error.message : String(error))
      return
    }
    const session = this.sessions.get(input.sessionId)
    if (session === undefined) {
      yield* refused('the ACP session is gone')
      return
    }
    session.turns += 1
    const turn = session.turns
    // The pump drains what arrived, waits for the prompt to settle, and ends the
    // turn. setImmediate polling instead of wake callbacks: a notification and the
    // response can land in one chunk, and a lost wakeup would end the turn early.
    const queue: EngineEvent[] = []
    session.updates = event => {
      queue.push(event)
      this.options.emit(input.sessionId, event)
    }
    for (const event of [{ type: 'turn/start', turn }, { type: 'user/message', content: input.message.content, source: input.message.source }] as const) session.updates(event)
    let settled = false
    const done = this.request('session/prompt', {
      sessionId: acpId,
      prompt: [{ type: 'text', text: input.message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n') }],
    }).finally(() => { settled = true })
    let failure: Error | undefined
    while (!settled || queue.length > 0) {
      if (queue.length === 0) {
        if (!settled) await new Promise(resolve => setImmediate(resolve))
        continue
      }
      yield queue.shift() as EngineEvent
    }
    try { await done } catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
    session.updates = undefined
    if (!queue.some(event => event.type === 'turn/end')) {
      // The end flows to the fanout like every other event — the feed and the
      // router both listen there, not only on this generator.
      const end: EngineEvent = failure !== undefined
        ? { type: 'turn/end', turn, reason: { kind: 'error', error: { message: failure.message } } }
        : { type: 'turn/end', turn, reason: { kind: 'completed' } }
      queue.push(end)
      this.options.emit(input.sessionId, end)
    }
    while (queue.length > 0) yield queue.shift() as EngineEvent
  }

  async steer(sessionId: string, message: TurnMessage): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return false
    // ACP has no mid-prompt injection; the message queues as the next turn's prompt.
    session.updates?.({ type: 'user/message', content: message.content, source: message.source })
    await this.request('session/update', { sessionId: session.acpId, update: { sessionUpdate: 'user_message' } }).catch(() => undefined)
    return true
  }

  // The protocol carries no reason: cancel is cancel, and the interface's reason is a
  // hint the host uses, not something to send.
  async cancelTurn(sessionId: string, reason: CancelReason = 'user'): Promise<void> {
    void reason
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    await this.notify('session/cancel', { sessionId: session.acpId }).catch(() => undefined)
    session.stop?.()
  }

  // The wire -----------------------------------------------------------------

  private async openSession(input: TurnInput): Promise<string> {
    const existing = this.sessions.get(input.sessionId)
    if (existing !== undefined) return existing.acpId
    const result = await this.request('session/new', {
      ...(input.config?.model !== undefined ? { model: { id: input.config.model } } : {}),
      ...(input.config?.systemPrompt !== undefined ? { mcpServers: [] } : {}),
    }) as { sessionId?: unknown } | null
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
    if ('id' in message && typeof message.id === 'number') {
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? `the agent refused (${String(message.error.code ?? '')})`))
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
}

/** One session/update as engine events, in the router's vocabulary. */
export function eventsOfUpdate(update: Readonly<Record<string, unknown>>): readonly EngineEvent[] {
  const kind = update.sessionUpdate
  const content = update.content as Readonly<Record<string, unknown>> | readonly unknown[] | undefined
  const blocks = (Array.isArray(content) ? content : content === undefined ? [] : [content]) as readonly unknown[]
  const textOf = (block: unknown): string => {
    const view = block as { text?: unknown } | undefined
    return typeof view?.text === 'string' ? view.text : ''
  }
  if (kind === 'agent_message_chunk') {
    const text = blocks.map(textOf).join('')
    return text === '' ? [] : [{ type: 'assistant/stream', text }]
  }
  if (kind === 'agent_message') {
    return [{ type: 'assistant/message', message: { content: blocks.flatMap(block => {
      const view = block as { type?: unknown } | undefined
      const text = textOf(block)
      return view?.type === 'text' && text !== '' ? [{ type: 'text', text }] : []
    }) } }]
  }
  if (kind === 'tool_call') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : randomUUID()
    const name = typeof update.title === 'string' ? update.title : typeof update.kind === 'string' ? update.kind : 'tool'
    return [{ type: 'tool/call', callId: id, name, arguments: JSON.stringify(update.rawInput ?? update.input ?? {}) }]
  }
  if (kind === 'tool_call_update') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    return id === '' ? [] : [{ type: 'tool/result', callId: id }]
  }
  if (kind === 'plan') return []
  return []
}

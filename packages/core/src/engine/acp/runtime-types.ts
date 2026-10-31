/** Types extracted from runtime.ts. */
import { randomUUID } from 'node:crypto'
import type { EngineContentBlock, EngineEvent } from '../events.ts'
import type { StoredMessage, TranscriptStore } from '../builtin/services.ts'
import type { PermissionRequestParams } from './permission.ts'
import type { AcpTransport } from './transport.ts'

/** ACP uses the same durable transcript row shape as the built-in engine. */
export type AcpStoredMessage = StoredMessage
export type AcpTranscriptStore = Pick<TranscriptStore, 'history' | 'append'>

export function eventsOfUpdate(update: Readonly<Record<string, unknown>>): readonly EngineEvent[] {
  const kind = update.sessionUpdate
  const content = update.content as Readonly<Record<string, unknown>> | readonly unknown[] | undefined
  const blocks = (Array.isArray(content) ? content : content === undefined ? [] : [content]) as readonly unknown[]
  const textOf = (block: unknown): string => {
    const view = block as { text?: unknown } | undefined
    return typeof view?.text === 'string' ? view.text : ''
  }
  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    const text = blocks.map(textOf).join('')
    return text === '' ? [] : [{ type: 'assistant/stream', text }]
  }
  if (kind === 'agent_message') {
    return [
      {
        type: 'assistant/message',
        message: {
          content: blocks.flatMap((block): readonly EngineContentBlock[] => {
            const view = block as { type?: unknown } | undefined
            const text = textOf(block)
            if (text === '') return []
            return [
              view?.type === 'thinking' || view?.type === 'thought'
                ? { type: 'thinking', text }
                : { type: 'text', text },
            ]
          }),
        },
      },
    ]
  }
  if (kind === 'tool_call') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : randomUUID()
    const name =
      typeof update.title === 'string' ? update.title : typeof update.kind === 'string' ? update.kind : 'tool'
    return [{ type: 'tool/call', callId: id, name, arguments: JSON.stringify(update.rawInput ?? update.input ?? {}) }]
  }
  if (kind === 'tool_call_update') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (id === '') return []
    return [
      {
        type: 'tool/result',
        callId: id,
        ...(update.status === 'failed' || update.isError === true ? { isError: true } : {}),
      },
    ]
  }
  if (kind === 'plan') {
    const entries = Array.isArray(update.entries) ? update.entries : []
    if (entries.length === 0) return []
    const planText = entries
      .map((e: { title?: string; status?: string }) => '[' + (e.status ?? 'pending') + '] ' + (e.title ?? ''))
      .join('\n')
    return [{ type: 'assistant/stream', text: '\n\n📋 **Plan:**\n' + planText + '\n\n' }]
  }
  return []
}
export interface PendingPermission {
  readonly sessionId: string
  readonly resolve: (decision: string) => void
}
export interface AcpAgentOptions {
  /** The wire to the agent: local stdio or a relay connection. */
  readonly transport: AcpTransport
  /** The client's own name, as the agent sees it in initialize. */
  readonly clientName?: string | undefined
  readonly clientVersion?: string | undefined
  /** Where the emit fanout goes, the same as the built-in engine's. */
  readonly emit: (sessionId: string, event: EngineEvent) => void
  /** Permission handler when agent asks for tool authorization (session/request_permission). */
  readonly requestPermission?: ((sessionId: string, params: PermissionRequestParams) => Promise<string>) | undefined
  /** Moon Bot's durable transcript; ACP events are appended here in turn order. */
  readonly transcript?: AcpTranscriptStore | undefined
}
export interface Waiter {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}
export interface AgentSession {
  readonly acpId: string
  turns: number
  updates: ((event: EngineEvent) => void) | undefined
  stop: (() => void) | undefined
  transcriptTail?: Promise<void> | undefined
}

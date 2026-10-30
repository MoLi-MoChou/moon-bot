// The unified engine event protocol (plan §四, §阶段 1). Whatever kernel runs a turn —
// the built-in pi engine, or an ACP agent behind the adapter — the host sees one event
// vocabulary. The shapes are the session/event payloads the turn router already
// consumes; the mapping from a kernel's own events (pi's AgentEvent) to these lives in
// the engine adapter, proven in test/pi-proto.test.js.
//
// Granularity: `assistant/message` arrives once per finished step (text plus any tool
// calls it made), as today; `assistant/stream` carries the text deltas in between, for
// the client stream (phase 3). The turn router ignores deltas; nothing may depend on
// them for correctness.

/** How a turn ended. `aborted.reason` keeps who stopped it, as the resume notes read it. */
export type EngineStopReason =
  | { readonly kind: 'completed' }
  | { readonly kind: 'aborted'; readonly reason?: 'user' | 'disposed' | string | undefined }
  | { readonly kind: 'error'; readonly error: { readonly code?: string | undefined; readonly message?: string | undefined; readonly status?: number | undefined } }

/** One content block of a message, as the host and the client read it. */
export type EngineContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'file'; readonly attachment?: unknown }
  | { readonly type: 'image'; readonly attachment?: unknown; readonly offloaded?: boolean }

/** A finished assistant message: one step of a turn. */
export interface EngineAssistantMessage {
  readonly content: readonly EngineContentBlock[]
}

/** The engine events of one turn, in order. */
export type EngineEvent =
  | { readonly type: 'turn/start'; readonly turn: number }
  | { readonly type: 'assistant/stream'; readonly text: string }
  | { readonly type: 'assistant/message'; readonly message: EngineAssistantMessage }
  | { readonly type: 'tool/call'; readonly callId: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'tool/result'; readonly callId: string; readonly isError?: boolean }
  | { readonly type: 'user/message'; readonly content: readonly EngineContentBlock[]; readonly source: Readonly<Record<string, unknown>> | undefined }
  | { readonly type: 'turn/end'; readonly turn: number; readonly reason: EngineStopReason }

/** One engine event as the session/event channel delivers it: a payload with a time. */
export type TimedEngineEvent = EngineEvent & { readonly time?: number | undefined }

const blockOf = (block: unknown): EngineContentBlock | undefined => (
  block !== null && typeof block === 'object' && typeof (block as EngineContentBlock).type === 'string' ? block as EngineContentBlock : undefined
)

const contentOf = (value: unknown): readonly EngineContentBlock[] => (Array.isArray(value) ? value.flatMap(block => {
  const blockView = blockOf(block)
  return blockView === undefined ? [] : [blockView]
}) : [])

/**
 * Reads a plain session/event payload as an EngineEvent. The router receives events as
 * untyped JSON from whichever channel they came (the in-process adapter, the WS stream,
 * a replay); this is the one place that says which of them are ours.
 */
export function engineEventOf(value: unknown): EngineEvent | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const event = value as Record<string, unknown>
  switch (event.type) {
    case 'turn/start':
      return typeof event.turn === 'number' ? { type: 'turn/start', turn: event.turn } : undefined
    case 'assistant/stream':
      return typeof event.text === 'string' ? { type: 'assistant/stream', text: event.text } : undefined
    case 'assistant/message':
      return { type: 'assistant/message', message: { content: contentOf(event.message !== null && typeof event.message === 'object' ? (event.message as { content?: unknown }).content : undefined) } }
    case 'tool/call':
      return typeof event.callId === 'string' && typeof event.name === 'string'
        ? { type: 'tool/call', callId: event.callId, name: event.name, arguments: typeof event.arguments === 'string' ? event.arguments : '' }
        : undefined
    case 'tool/result':
      return typeof event.callId === 'string' ? { type: 'tool/result', callId: event.callId, ...(event.isError === true ? { isError: true } : {}) } : undefined
    case 'user/message': {
      const source = event.source
      return {
        type: 'user/message',
        content: contentOf(event.content),
        source: source !== null && typeof source === 'object' ? source as Readonly<Record<string, unknown>> : undefined,
      }
    }
    case 'turn/end': {
      const reason = event.reason
      if (reason === null || typeof reason !== 'object') return undefined
      const kind = (reason as { kind?: unknown }).kind
      if (kind === 'completed') return { type: 'turn/end', turn: numberOr(event.turn), reason: { kind: 'completed' } }
      if (kind === 'aborted') {
        const why = (reason as { reason?: unknown }).reason
        return { type: 'turn/end', turn: numberOr(event.turn), reason: { kind: 'aborted', ...(typeof why === 'string' ? { reason: why } : {}) } }
      }
      if (kind === 'error') {
        const error = (reason as { error?: unknown }).error
        const detail = error !== null && typeof error === 'object' ? error as { code?: unknown; message?: unknown; status?: unknown } : {}
        return {
          type: 'turn/end',
          turn: numberOr(event.turn),
          reason: {
            kind: 'error',
            error: {
              ...(typeof detail.code === 'string' ? { code: detail.code } : {}),
              ...(typeof detail.message === 'string' ? { message: detail.message } : {}),
              ...(typeof detail.status === 'number' ? { status: detail.status } : {}),
            },
          },
        }
      }
      return undefined
    }
    default:
      return undefined
  }
}

const numberOr = (value: unknown): number => (typeof value === 'number' ? value : 0)

/** The text of a message's text blocks, joined as one step's text. */
export const textOfContent = (content: readonly EngineContentBlock[]): string => content
  .flatMap(block => block.type === 'text' ? [block.text] : [])
  .join('\n')

/** Whether a step's message makes any tool call (its text is then a preamble, not the answer). */
export const callsTools = (message: EngineAssistantMessage): boolean => message.content.some(block => block.type === 'tool-call')

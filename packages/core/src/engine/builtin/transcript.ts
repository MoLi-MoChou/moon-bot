// The store-backed transcript adapter: what the engine said and heard, in the SQLite
// sessions module, as the TranscriptStore seam reads it. History comes back as stored
// messages; phase 3's handoff/part switch rebuilds a base from them.
import type { StoredMessage, TranscriptStore } from './services.ts'

/** One row as the SQLite sessions module pages it back. */
export interface StoredRow {
  readonly role: StoredMessage['role']
  readonly content: readonly unknown[]
  readonly stopReason: unknown
  readonly turn: unknown
  readonly source?: unknown
  readonly raw: unknown
  readonly createdAt: number
}

/** The slice of the SQLite sessions module the transcript needs. */
export interface TranscriptOptions {
  readonly redact?: ((text: string) => string) | undefined
}

const redactValue = (value: unknown, redact: ((text: string) => string) | undefined): unknown => {
  if (redact === undefined) return value
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactValue(item, redact))
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, redact)]))
  return value
}

export interface SessionsLike {
  appendMessage(input: {
    readonly sessionId: string
    readonly role: StoredMessage['role']
    readonly content: readonly unknown[]
    readonly stopReason?: unknown
    readonly turn?: unknown
    readonly source?: Readonly<Record<string, unknown>>
    readonly raw?: unknown
  }): unknown
  page(sessionId: string, limit: number): readonly StoredRow[]
}

export const sqliteTranscriptOf = (sessions: SessionsLike, options: TranscriptOptions = {}): TranscriptStore => ({
  async history(sessionId) {
    return sessions.page(sessionId, 1000).map(row => ({
      role: row.role,
      content: redactValue(row.content, options.redact) as StoredMessage['content'],
      ...(typeof row.stopReason === 'string' && row.stopReason !== ''
        ? { stopReason: redactValue(row.stopReason, options.redact) as string }
        : {}),
      ...(typeof row.turn === 'number' ? { turn: row.turn } : {}),
      ...(row.source !== null && row.source !== undefined
        ? { source: redactValue(row.source, options.redact) as Readonly<Record<string, unknown>> }
        : {}),
      ...(row.raw !== null && row.raw !== undefined ? { raw: redactValue(row.raw, options.redact) } : {}),
      at: row.createdAt,
    }))
  },
  async append(sessionId, message) {
    sessions.appendMessage({
      sessionId,
      role: message.role,
      content: redactValue(message.content, options.redact) as StoredMessage['content'],
      ...(message.stopReason !== undefined ? { stopReason: redactValue(message.stopReason, options.redact) } : {}),
      ...(message.turn !== undefined ? { turn: message.turn } : {}),
      ...(message.source !== undefined
        ? { source: redactValue(message.source, options.redact) as Readonly<Record<string, unknown>> }
        : {}),
      ...(message.raw !== undefined ? { raw: redactValue(message.raw, options.redact) } : {}),
    })
  },
})

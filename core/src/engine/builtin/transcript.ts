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
  readonly raw: unknown
  readonly createdAt: number
}

/** The slice of the SQLite sessions module the transcript needs. */
export interface SessionsLike {
  appendMessage(input: { readonly sessionId: string; readonly role: StoredMessage['role']; readonly content: readonly unknown[]; readonly stopReason?: unknown; readonly turn?: unknown; readonly raw?: unknown }): unknown
  page(sessionId: string, limit: number): readonly StoredRow[]
}

export const sqliteTranscriptOf = (sessions: SessionsLike): TranscriptStore => ({
  async history(sessionId) {
    return sessions.page(sessionId, 1000).map(row => ({
      role: row.role,
      content: row.content as StoredMessage['content'],
      ...(typeof row.stopReason === 'string' && row.stopReason !== '' ? { stopReason: row.stopReason } : {}),
      ...(typeof row.turn === 'number' ? { turn: row.turn } : {}),
      ...(row.raw !== null && row.raw !== undefined ? { raw: row.raw } : {}),
      at: row.createdAt,
    }))
  },
  async append(sessionId, message) {
    sessions.appendMessage({
      sessionId,
      role: message.role,
      content: message.content,
      ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}),
      ...(message.turn !== undefined ? { turn: message.turn } : {}),
      ...(message.raw !== undefined ? { raw: message.raw } : {}),
    })
  },
})

// Sessions and their messages (plan §阶段 1). The engine's transcript lives here from
// phase 2 on: `appendMessage` is the one write path, in turn order; `page` reads back
// by session sequence for handoffs and the client's history.
//
// Row shapes are Zod-modelled: whatever crosses this line is validated, because the
// JSON columns (content blocks, sources, stop reasons) arrive from code that changes
// more often than the schema does.
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

export const ContentBlock = z.object({
  type: z.string(),
}).passthrough().readonly()
export type ContentBlock = z.infer<typeof ContentBlock>

export const MessageRow = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  turn: z.number().int().nullable(),
  role: z.enum(['user', 'assistant', 'system', 'toolResult']),
  content: z.array(ContentBlock).readonly(),
  source: z.record(z.unknown()).nullable().readonly(),
  stopReason: z.unknown().nullable(),
  raw: z.unknown().nullable(),
  createdAt: z.number().int(),
}).readonly()
export type MessageRow = z.infer<typeof MessageRow>

export const SessionRow = z.object({
  id: z.string(),
  kind: z.enum(['bot', 'group', 'agent', 'acp']),
  ownerId: z.string(),
  title: z.string().nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  meta: z.record(z.unknown()).readonly(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).readonly()
export type SessionRow = z.infer<typeof SessionRow>

export interface AppendMessage {
  readonly sessionId: string
  readonly role: MessageRow['role']
  readonly content: readonly ContentBlock[]
  readonly source?: Readonly<Record<string, unknown>> | undefined
  readonly turn?: number | undefined
  readonly stopReason?: unknown
  /** The kernel message as stored JSON, for verbatim replay. */
  readonly raw?: unknown
}

const now = (): number => Date.now()
const parse = <T>(text: string, fallback: T, model: { parse(value: unknown): T }): T => {
  try { return model.parse(JSON.parse(text)) } catch { return fallback }
}

export class Sessions {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  upsertSession(input: { readonly id: string; readonly kind: SessionRow['kind']; readonly ownerId: string; readonly title?: string; readonly model?: string; readonly effort?: string; readonly systemPrompt?: string }): SessionRow {
    const at = now()
    this.db.prepare(`
      INSERT INTO sessions (id, kind, owner_id, title, model, effort, system_prompt, meta, created_at, updated_at)
      VALUES (@id, @kind, @ownerId, @title, @model, @effort, @systemPrompt, '{}', @at, @at)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind, owner_id = excluded.owner_id, updated_at = excluded.updated_at,
        title = COALESCE(excluded.title, title), model = COALESCE(excluded.model, model),
        effort = COALESCE(excluded.effort, effort), system_prompt = COALESCE(excluded.system_prompt, system_prompt)
    `).run({ id: input.id, kind: input.kind, ownerId: input.ownerId, title: input.title ?? null, model: input.model ?? null, effort: input.effort ?? null, systemPrompt: input.systemPrompt ?? null, at })
    return this.session(input.id) as SessionRow
  }

  session(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    return SessionRow.parse({
      id: row.id, kind: row.kind, ownerId: row.owner_id, title: row.title, model: row.model, effort: row.effort,
      systemPrompt: row.system_prompt, meta: parse(String(row.meta), {}, z.record(z.unknown())),
      createdAt: row.created_at, updatedAt: row.updated_at,
    })
  }

  setModel(id: string, model: string | null, effort: string | null): void {
    this.db.prepare('UPDATE sessions SET model = ?, effort = ?, updated_at = ? WHERE id = ?').run(model, effort, now(), id)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  /** Appends one message; the per-session sequence moves with it. Returns the stored row. */
  appendMessage(input: AppendMessage): MessageRow {
    const at = now()
    const insert = this.db.transaction((): MessageRow => {
      const row = this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE session_id = ?').get(input.sessionId) as { next: number }
      const seq = Number(row.next)
      const result = this.db.prepare(`
        INSERT INTO messages (session_id, seq, turn, role, content, source, stop_reason, raw, created_at)
        VALUES (@sessionId, @seq, @turn, @role, @content, @source, @stopReason, @raw, @at)
      `).run({
        sessionId: input.sessionId, seq, turn: input.turn ?? null, role: input.role,
        content: JSON.stringify(input.content), source: input.source === undefined ? null : JSON.stringify(input.source),
        stopReason: input.stopReason === undefined ? null : JSON.stringify(input.stopReason),
        raw: input.raw === undefined ? null : JSON.stringify(input.raw), at,
      })
      return MessageRow.parse({
        id: Number(result.lastInsertRowid), sessionId: input.sessionId, seq, turn: input.turn ?? null,
        role: input.role, content: input.content, source: input.source ?? null, stopReason: input.stopReason ?? null,
        raw: input.raw ?? null, createdAt: at,
      })
    })
    return insert()
  }

  /** The newest `limit` messages of a session, oldest first. */
  page(sessionId: string, limit: number): MessageRow[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?').all(sessionId, limit) as Record<string, unknown>[]
    return rows.reverse().map(row => MessageRow.parse({
      id: row.id, sessionId: row.session_id, seq: row.seq, turn: row.turn, role: row.role,
      content: parse(String(row.content), [], z.array(ContentBlock)),
      source: row.source === null ? null : parse(String(row.source), {}, z.record(z.unknown())),
      stopReason: row.stop_reason === null ? null : parse(String(row.stop_reason), null, z.unknown()),
      raw: row.raw === null || row.raw === undefined ? null : parse(String(row.raw), null, z.unknown()),
      createdAt: row.created_at,
    }))
  }

  /** Rows of a session between sequence bounds (both exclusive at the top), newest first. */
  pageBetween(sessionId: string, bounds: { readonly throughSeq?: number, readonly beforeSeq?: number, readonly limit: number }): MessageRow[] {
    const clauses = ['session_id = ?']
    const args: unknown[] = [sessionId]
    if (bounds.throughSeq !== undefined) { clauses.push('seq <= ?'); args.push(bounds.throughSeq) }
    if (bounds.beforeSeq !== undefined) { clauses.push('seq < ?'); args.push(bounds.beforeSeq) }
    const rows = this.db.prepare(`SELECT * FROM messages WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...args, bounds.limit) as Record<string, unknown>[]
    return rows.reverse().map(row => MessageRow.parse({
      id: row.id, sessionId: row.session_id, seq: row.seq, turn: row.turn, role: row.role,
      content: parse(String(row.content), [], z.array(ContentBlock)),
      source: row.source === null ? null : parse(String(row.source), {}, z.record(z.unknown())),
      stopReason: row.stop_reason === null ? null : parse(String(row.stop_reason), null, z.unknown()),
      raw: row.raw === null || row.raw === undefined ? null : parse(String(row.raw), null, z.unknown()),
      createdAt: row.created_at,
    }))
  }

  countMessages(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(sessionId) as { n: number }
    return Number(row.n)
  }
}

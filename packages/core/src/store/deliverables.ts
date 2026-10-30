// Deliverables (2026-10-28 files-and-library): the files a turn left behind in the Bot's
// workspace. The chat reads them by session and turn for its file cards; the library
// page reads them across sessions. Paths are workspace-relative — the absolute location
// is the app's business, never the interface's.
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

export const DeliverableRow = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  turn: z.number().int().nullable(),
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.number().int(),
})
export type DeliverableRow = z.infer<typeof DeliverableRow>

/** One library item: the deliverable plus the session that made it (its owner, when the sessions table has one). */
export const LibraryRow = z.object({
  ...DeliverableRow.shape,
  ownerId: z.string().nullable(),
})
export type LibraryRow = z.infer<typeof LibraryRow>

const rowOf = (row: Record<string, unknown>): DeliverableRow =>
  DeliverableRow.parse({
    id: Number(row.id),
    sessionId: row.session_id,
    turn: row.turn === null ? null : Number(row.turn),
    name: row.name,
    path: row.path,
    size: Number(row.size),
    createdAt: Number(row.created_at),
  })

const libraryRowOf = (row: Record<string, unknown>): LibraryRow =>
  LibraryRow.parse({
    ...rowOf(row),
    ownerId: row.owner_id === null || row.owner_id === undefined ? null : String(row.owner_id),
  })

export class Deliverables {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  add(
    sessionId: string,
    turn: number | null,
    files: readonly { readonly name: string; readonly path: string; readonly size: number }[],
  ): void {
    if (files.length === 0) return
    const at = Date.now()
    const insert = this.db.prepare(
      'INSERT INTO deliverables (session_id, turn, name, path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    this.db.transaction(() => {
      for (const file of files) insert.run(sessionId, turn, file.name, file.path, file.size, at)
    })()
  }

  forTurn(sessionId: string, turn: number): readonly DeliverableRow[] {
    const rows = this.db
      .prepare('SELECT * FROM deliverables WHERE session_id = ? AND turn = ? ORDER BY path ASC')
      .all(sessionId, turn) as Record<string, unknown>[]
    return rows.map(rowOf)
  }

  /** The library's whole shelf, newest first; `since` filters by the turn that made them. */
  list(options: { readonly since?: number; readonly limit?: number } = {}): readonly LibraryRow[] {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500)
    const rows = (
      options.since === undefined
        ? this.db.prepare(
            `SELECT d.*, s.owner_id FROM deliverables d LEFT JOIN sessions s ON s.id = d.session_id ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
          )
        : this.db.prepare(
            `SELECT d.*, s.owner_id FROM deliverables d LEFT JOIN sessions s ON s.id = d.session_id WHERE d.created_at >= ? ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
          )
    ).all(...(options.since === undefined ? [] : [options.since]), limit) as Record<string, unknown>[]
    return rows.map(libraryRowOf)
  }

  latestAt(): number | undefined {
    const row = this.db.prepare('SELECT MAX(created_at) AS at FROM deliverables').get() as { at?: unknown }
    return row?.at === null || row?.at === undefined ? undefined : Number(row.at)
  }
}

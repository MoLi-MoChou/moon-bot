// The memory index (plan §阶段 1; ranked retrieval arrives in phase 4). Markdown files
// stay the source of truth; this table is their searchable mirror, one row per live
// entry. Rebuilding is cheap and total: `replaceAll` wipes a scope and re-inserts from
// the parsed files, so index drift never outlives a restart.
//
// Retrieval today is FTS5 (BM25, trigram so Chinese matches); phase 4 folds in
// freshness and confidence, which the columns here already carry.
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

export const MemoryIndexRow = z.object({
  id: z.number().int(),
  scope: z.string(),
  entryKey: z.string(),
  topic: z.string().nullable(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  validUntil: z.number().int().nullable(),
  supersededBy: z.number().int().nullable(),
  source: z.record(z.unknown()).nullable().readonly(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  active: z.boolean(),
}).readonly()
export type MemoryIndexRow = z.infer<typeof MemoryIndexRow>

export interface IndexEntry {
  readonly entryKey: string
  readonly topic?: string | undefined
  readonly text: string
  readonly confidence?: number | undefined
  readonly validUntil?: number | undefined
  readonly source?: Readonly<Record<string, unknown>> | undefined
}

export interface Scored {
  readonly row: MemoryIndexRow
  /** FTS5's rank; smaller is better. Freshness and confidence fold in at phase 4. */
  readonly rank: number
}

const now = (): number => Date.now()

const rowOf = (row: Record<string, unknown>): MemoryIndexRow => MemoryIndexRow.parse({
  id: Number(row.id), scope: String(row.scope), entryKey: String(row.entry_key), topic: row.topic === null ? null : String(row.topic),
  text: String(row.text), confidence: Number(row.confidence), validUntil: row.valid_until === null ? null : Number(row.valid_until),
  supersededBy: row.superseded_by === null ? null : Number(row.superseded_by),
  source: row.source === null ? null : JSON.parse(String(row.source)),
  createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), active: row.active === 1,
})

export class MemoryIndex {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  /** Replaces one scope's index wholesale, from the parsed Markdown of its files. */
  replaceAll(scope: string, entries: readonly IndexEntry[]): void {
    const at = now()
    const rebuild = this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_index WHERE scope = ?').run(scope)
      const insert = this.db.prepare(`
        INSERT INTO memory_index (scope, entry_key, topic, text, confidence, valid_until, source, created_at, updated_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      for (const entry of entries) {
        insert.run(scope, entry.entryKey, entry.topic ?? null, entry.text, entry.confidence ?? 0.5,
          entry.validUntil ?? null, entry.source === undefined ? null : JSON.stringify(entry.source), at, at)
      }
    })
    rebuild()
  }

  /** Marks an entry corrected: inactive from now, pointing at the entry that replaces it. */
  supersede(scope: string, entryKey: string, byKey: string): void {
    const by = this.db.prepare('SELECT id FROM memory_index WHERE scope = ? AND entry_key = ?').get(scope, byKey) as { id: number } | undefined
    this.db.prepare('UPDATE memory_index SET active = 0, superseded_by = ?, updated_at = ? WHERE scope = ? AND entry_key = ?')
      .run(by?.id ?? null, now(), scope, entryKey)
  }

  /**
   * Full-text search over a scope's live entries, best first. Terms of three or more
   * characters go through FTS5 (BM25); shorter terms — most Chinese words — cannot
   * form a trigram, so they filter by substring over the live rows instead. The row
   * sets are the same; only the ranking of a mixed query coarsens to recency.
   */
  search(scope: string | readonly string[], query: string, limit = 20): Scored[] {
    const scopes = Array.isArray(scope) ? scope : [scope]
    if (scopes.length === 0) return []
    const terms = query.split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    const places = scopes.map(() => '?').join(', ')
    if (terms.every(term => term.length >= 3)) {
      try {
        const rows = this.db.prepare(`
          SELECT m.*, f.rank FROM memory_index m
          JOIN memory_fts f ON f.rowid = m.id
          WHERE m.scope IN (${places}) AND m.active = 1 AND memory_fts MATCH ?
          ORDER BY f.rank ASC LIMIT ?
        `).all(...scopes, this.ftsQuery(terms), limit) as Record<string, unknown>[]
        return rows.map(row => ({ row: rowOf(row), rank: Number(row.rank) }))
      } catch {
        // A query FTS5 cannot parse is an empty answer, not a broken index.
        return []
      }
    }
    const likes = terms.map(() => 'text LIKE ?').join(' AND ')
    const rows = this.db.prepare(`
      SELECT * FROM memory_index WHERE scope IN (${places}) AND active = 1 AND ${likes}
      ORDER BY updated_at DESC LIMIT ?
    `).all(...scopes, ...terms.map(term => `%${term}%`), limit) as Record<string, unknown>[]
    return rows.map(row => ({ row: rowOf(row), rank: 0 }))
  }

  // AND the terms; each term itself may be a phrase FTS5 quotes. Keeps user words like
  // `deploy 失败` from being read as columns or operators.
  private ftsQuery(terms: readonly string[]): string {
    return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ')
  }

  live(scope: string): MemoryIndexRow[] {
    const rows = this.db.prepare('SELECT * FROM memory_index WHERE scope = ? AND active = 1 ORDER BY created_at ASC').all(scope) as Record<string, unknown>[]
    return rows.map(rowOf)
  }

  count(scope: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memory_index WHERE scope = ? AND active = 1').get(scope) as { n: number }
    return Number(row.n)
  }
}

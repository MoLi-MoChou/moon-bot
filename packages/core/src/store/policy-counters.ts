// The policy ledger's counters (plan §阶段 5): how many L3/L4 calls a session made
// this UTC day. One row per day, session, and level; `spend` increments and returns
// the new count in one statement, so concurrent turns cannot undercount.
import type { SqliteDatabase } from './schema.ts'

const DAY_MS = 86_400_000

export class PolicyCounters {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  /** The session's count for a level today, after adding `spend` (default 1). */
  spend(sessionId: string, level: 3 | 4, spend = 1): number {
    const day = Math.floor(Date.now() / DAY_MS)
    const row = this.db.prepare(`
      INSERT INTO policy_counters (day, session_id, level, count) VALUES (?, ?, ?, ?)
      ON CONFLICT(day, session_id, level) DO UPDATE SET count = count + excluded.count
      RETURNING count
    `).get(day, sessionId, level, spend) as { count: number } | undefined
    return Number(row?.count ?? spend)
  }

  /** The count as it stands, without spending. */
  countOf(sessionId: string, level: 3 | 4): number {
    const day = Math.floor(Date.now() / DAY_MS)
    const row = this.db.prepare('SELECT count FROM policy_counters WHERE day = ? AND session_id = ? AND level = ?').get(day, sessionId, level) as { count: number } | undefined
    return Number(row?.count ?? 0)
  }
}

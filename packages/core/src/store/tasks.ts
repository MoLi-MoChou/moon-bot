// Durable tasks (plan §阶段 1; used from phase 4 on): scheduled triggers and deferred
// follow-ups persist here, so a restart replays them by `next_run_at` instead of a
// memory timer. The scheduler polls `due`; runners claim with `markRunning` and settle
// with `finish`, keeping the audit trail in `last_result`.
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

export const TaskRow = z.object({
  id: z.string(),
  kind: z.enum(['schedule', 'work', 'followup']),
  ownerSession: z.string().nullable(),
  payload: z.record(z.unknown()).readonly(),
  state: z.enum(['pending', 'running', 'done', 'failed', 'paused']),
  nextRunAt: z.number().int().nullable(),
  attempts: z.number().int().nonnegative(),
  lastResult: z.unknown().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).readonly()
export type TaskRow = z.infer<typeof TaskRow>

const now = (): number => Date.now()

const rowOf = (row: Record<string, unknown>): TaskRow => TaskRow.parse({
  id: row.id, kind: row.kind, ownerSession: row.owner_session, payload: JSON.parse(String(row.payload ?? '{}')),
  state: row.state, nextRunAt: row.next_run_at === null ? null : Number(row.next_run_at), attempts: Number(row.attempts),
  lastResult: row.last_result === null ? null : JSON.parse(String(row.last_result)),
  createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
})

export class Tasks {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  create(input: { readonly id?: string; readonly kind: TaskRow['kind']; readonly ownerSession?: string; readonly payload?: Readonly<Record<string, unknown>>; readonly nextRunAt?: number }): TaskRow {
    const at = now()
    const id = input.id ?? crypto.randomUUID()
    this.db.prepare(`
      INSERT INTO tasks (id, kind, owner_session, payload, state, next_run_at, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, next_run_at = excluded.next_run_at, updated_at = excluded.updated_at
    `).run(id, input.kind, input.ownerSession ?? null, JSON.stringify(input.payload ?? {}), input.nextRunAt ?? null, at, at)
    return this.task(id) as TaskRow
  }

  task(id: string): TaskRow | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row === undefined ? undefined : rowOf(row)
  }

  /** Every task whose time has come, oldest first: the scheduler's poll result. */
  due(upto: number, limit = 50): TaskRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE state = 'pending' AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC LIMIT ?
    `).all(upto, limit) as Record<string, unknown>[]
    return rows.map(rowOf)
  }

  /** Claims a task for a runner; a task already claimed stays with its runner. */
  markRunning(id: string): TaskRow | undefined {
    const result = this.db.prepare("UPDATE tasks SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'pending'").run(now(), id)
    return result.changes > 0 ? this.task(id) : undefined
  }

  finish(id: string, outcome: { readonly state: 'done' | 'failed' | 'pending'; readonly result?: unknown; readonly nextRunAt?: number }): void {
    this.db.prepare('UPDATE tasks SET state = ?, last_result = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(outcome.state, JSON.stringify(outcome.result ?? null), outcome.nextRunAt ?? null, now(), id)
  }

  /** Pauses or releases a task without touching its outcome (the user's pause/cancel). */
  setState(id: string, state: TaskRow['state']): void {
    this.db.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), id)
  }

  list(ownerSession?: string): TaskRow[] {
    const rows = ownerSession === undefined
      ? this.db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all() as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM tasks WHERE owner_session = ? ORDER BY created_at ASC').all(ownerSession) as Record<string, unknown>[]
    return rows.map(rowOf)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }
}

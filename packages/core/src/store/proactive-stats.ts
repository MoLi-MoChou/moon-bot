// The numbers the rollout is gated on (2026-10-29 proactive-messages, P5). Kept apart from
// the store class because they are read by the settings page, not by the pipeline, and a
// wrong guess here would be a wrong decision about shipping.
import type { SqliteDatabase } from './schema.ts'

export interface ProactiveStats {
  /** Candidates a run prepared in the window. */
  readonly prepared: number
  /** Of those, how many reached the user. */
  readonly delivered: number
  /** Of those, how many were dropped for a reason. */
  readonly rejected: number
  /** How many subscriptions are switched off right now: a signal the feature is intrusive. */
  readonly disabled: number
}

export function statsSince(db: SqliteDatabase, since: number): ProactiveStats {
  // Some counts are windowed and one is not: the number of subscriptions switched off is a
  // state, not an event in the window.
  const count = (sql: string, windowed: boolean): number => {
    const row = (windowed ? db.prepare(sql).get(since) : db.prepare(sql).get()) as { readonly n?: number } | undefined
    return Number(row?.n ?? 0)
  }
  return {
    prepared: count('SELECT COUNT(*) AS n FROM proactive_candidates WHERE created_at >= ?', true),
    delivered: count(
      "SELECT COUNT(*) AS n FROM proactive_decisions WHERE decision = 'delivered' AND decided_at >= ?",
      true,
    ),
    rejected: count(
      "SELECT COUNT(*) AS n FROM proactive_decisions WHERE decision = 'dropped' AND decided_at >= ?",
      true,
    ),
    disabled: count('SELECT COUNT(*) AS n FROM proactive_subscriptions WHERE enabled = 0', false),
  }
}

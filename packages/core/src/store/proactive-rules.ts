/** Proactive schedule rules store. */
import type { SqliteDatabase } from './schema.ts'

const bool = (value: unknown): boolean => Number(value) === 1

export interface StoredRule {
  readonly id: string
  readonly subscriptionId: string
  readonly purpose: string
  readonly when: string
  readonly tools: readonly string[]
  readonly prohibitions: readonly string[]
  readonly dailyCap: number
  readonly respectQuietHours: boolean
  readonly enabled: boolean
  readonly createdAt: number
}

const ruleOf = (row: Record<string, unknown>): StoredRule => ({
  id: String(row.id),
  subscriptionId: String(row.subscription_id),
  purpose: String(row.purpose),
  when: String(row.when_json),
  tools: JSON.parse(String(row.tools)) as readonly string[],
  prohibitions: JSON.parse(String(row.prohibitions)) as readonly string[],
  dailyCap: Number(row.daily_cap),
  respectQuietHours: bool(row.respect_quiet_hours),
  enabled: bool(row.enabled),
  createdAt: Number(row.created_at),
})

/** Rules and their audit, kept beside the subscriptions they belong to. */
export class ProactiveRules {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  add(input: Omit<StoredRule, 'createdAt'> & { readonly createdAt?: number }): StoredRule {
    this.db
      .prepare(`INSERT INTO proactive_preauth
      (id, subscription_id, purpose, when_json, tools, prohibitions, daily_cap, respect_quiet_hours, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.id,
        input.subscriptionId,
        input.purpose,
        input.when,
        JSON.stringify(input.tools),
        JSON.stringify(input.prohibitions),
        input.dailyCap,
        input.respectQuietHours ? 1 : 0,
        input.enabled ? 1 : 0,
        input.createdAt ?? Date.now(),
      )
    return this.rule(input.id) as StoredRule
  }

  rule(id: string): StoredRule | undefined {
    const row = this.db.prepare('SELECT * FROM proactive_preauth WHERE id = ?').get(id)
    return row === undefined ? undefined : ruleOf(row as Record<string, unknown>)
  }

  rulesOf(subscriptionId: string): StoredRule[] {
    return this.db
      .prepare('SELECT * FROM proactive_preauth WHERE subscription_id = ? ORDER BY created_at')
      .all(subscriptionId)
      .map(row => ruleOf(row as Record<string, unknown>))
  }

  /** Every rule of every subscription one Bot owns, for the settings surface. */
  rulesForBot(botId: string): StoredRule[] {
    return this.db
      .prepare(`SELECT r.* FROM proactive_preauth r
      JOIN proactive_subscriptions s ON s.id = r.subscription_id
      WHERE s.bot_id = ? ORDER BY r.created_at`)
      .all(botId)
      .map(row => ruleOf(row as Record<string, unknown>))
  }

  revoke(id: string): boolean {
    return this.db.prepare('DELETE FROM proactive_preauth WHERE id = ?').run(id).changes > 0
  }

  /** Records one attempt, whether it acted or not. */
  audit(
    ruleId: string,
    tool: string,
    outcome: 'acted' | 'waited' | 'proposed',
    reason: string | null,
    at: number = Date.now(),
  ): void {
    this.db
      .prepare('INSERT INTO proactive_audit (rule_id, tool, outcome, reason, at) VALUES (?, ?, ?, ?, ?)')
      .run(ruleId, tool, outcome, reason, at)
  }

  /** How many times a rule acted on the local day starting at `since`. */
  actedSince(ruleId: string, since: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM proactive_audit WHERE rule_id = ? AND outcome = 'acted' AND at >= ?")
      .get(ruleId, since) as { readonly n?: number } | undefined
    return Number(row?.n ?? 0)
  }

  auditOf(
    ruleId: string,
    limit = 50,
  ): readonly {
    readonly tool: string
    readonly outcome: string
    readonly reason: string | null
    readonly at: number
  }[] {
    return this.db
      .prepare('SELECT * FROM proactive_audit WHERE rule_id = ? ORDER BY at DESC LIMIT ?')
      .all(ruleId, limit)
      .map(row => {
        const record = row as Record<string, unknown>
        return {
          tool: String(record.tool),
          outcome: String(record.outcome),
          reason: record.reason === null || record.reason === undefined ? null : String(record.reason),
          at: Number(record.at),
        }
      })
  }
}

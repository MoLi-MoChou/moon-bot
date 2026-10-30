// Proactive messages (2026-10-29 proactive-messages): what a user subscribed to, what
// each run prepared, and what was decided about it.
//
// Two stores in one module because they are read together: the screen asks "has this been
// said or turned down in the last N days", which needs the candidates and their decisions
// in one query.
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

/** One thing the user asked a Bot to keep an eye on. */
export const SubscriptionRow = z.object({
  id: z.string(),
  botId: z.string(),
  sessionId: z.string(),
  topics: z.string(),
  /** The scheduler's own selector, kept as JSON so this store stays unaware of its shape. */
  when: z.string(),
  dailyCap: z.number().int().positive(),
  quietFrom: z.string().nullable(),
  quietTo: z.string().nullable(),
  allowPaidPrep: z.boolean(),
  eventHook: z.string().nullable(),
  eventMinutes: z.number().int().nullable(),
  enabled: z.boolean(),
  /** When the poll last fired it; null when it never has. */
  lastFiredAt: z.number().int().nullable(),
  createdAt: z.number().int(),
})
export type SubscriptionRow = z.infer<typeof SubscriptionRow>

export const CandidateRow = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  /** JSON array: each line names where it came from. */
  evidence: z.string(),
  whyCare: z.string(),
  ttl: z.enum(['short', 'long']),
  /** JSON array of normalized keywords; the similarity check reads these. */
  topicKeys: z.string(),
  fingerprint: z.string(),
  triggerSource: z.string(),
  createdAt: z.number().int(),
})
export type CandidateRow = z.infer<typeof CandidateRow>

export const DecisionRow = z.object({
  candidateId: z.string(),
  decision: z.enum(['delivered', 'quiet', 'dropped', 'delayed']),
  reason: z.string().nullable(),
  decidedAt: z.number().int(),
})
export type DecisionRow = z.infer<typeof DecisionRow>

export interface SubscriptionInput {
  readonly id: string
  readonly botId: string
  readonly sessionId: string
  readonly topics: string
  readonly when: string
  readonly dailyCap?: number | undefined
  readonly quietFrom?: string | null | undefined
  readonly quietTo?: string | null | undefined
  readonly allowPaidPrep?: boolean | undefined
  readonly eventHook?: string | null | undefined
  readonly eventMinutes?: number | null | undefined
}

export interface CandidateInput {
  readonly id: string
  readonly subscriptionId: string
  readonly sessionId: string
  readonly text: string
  readonly evidence: readonly string[]
  readonly whyCare: string
  readonly ttl: 'short' | 'long'
  readonly topicKeys: readonly string[]
  readonly fingerprint: string
  readonly triggerSource: string
}

const bool = (value: unknown): boolean => Number(value) === 1

const subscriptionOf = (row: Record<string, unknown>): SubscriptionRow => SubscriptionRow.parse({
  id: row.id,
  botId: row.bot_id,
  sessionId: row.session_id,
  topics: row.topics,
  when: row.when_json,
  dailyCap: Number(row.daily_cap),
  quietFrom: row.quiet_from === null || row.quiet_from === undefined ? null : String(row.quiet_from),
  quietTo: row.quiet_to === null || row.quiet_to === undefined ? null : String(row.quiet_to),
  allowPaidPrep: bool(row.allow_paid_prep),
  eventHook: row.event_hook === null || row.event_hook === undefined ? null : String(row.event_hook),
  eventMinutes: row.event_minutes === null || row.event_minutes === undefined ? null : Number(row.event_minutes),
  enabled: bool(row.enabled),
  lastFiredAt: row.last_fired_at === null || row.last_fired_at === undefined ? null : Number(row.last_fired_at),
  createdAt: Number(row.created_at),
})

const candidateOf = (row: Record<string, unknown>): CandidateRow => CandidateRow.parse({
  id: row.id,
  subscriptionId: row.subscription_id,
  sessionId: row.session_id,
  text: row.text,
  evidence: row.evidence,
  whyCare: row.why_care,
  ttl: row.ttl,
  topicKeys: row.topic_keys,
  fingerprint: row.fingerprint,
  triggerSource: row.trigger_source,
  createdAt: Number(row.created_at),
})

const decisionOf = (row: Record<string, unknown>): DecisionRow => DecisionRow.parse({
  candidateId: row.candidate_id,
  decision: row.decision,
  reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
  decidedAt: Number(row.decided_at),
})

/** The default a subscription gets when the user names no cap: one a day. */
export const DEFAULT_DAILY_CAP = 1
/** The most a subscription may ask for, whatever it says. */
export const MAX_DAILY_CAP = 5

export class ProactiveStore {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  // -- subscriptions ---------------------------------------------------------

  addSubscription(input: SubscriptionInput): SubscriptionRow {
    const cap = Math.min(Math.max(input.dailyCap ?? DEFAULT_DAILY_CAP, DEFAULT_DAILY_CAP), MAX_DAILY_CAP)
    this.db.prepare(`INSERT INTO proactive_subscriptions
      (id, bot_id, session_id, topics, when_json, daily_cap, quiet_from, quiet_to, allow_paid_prep, event_hook, event_minutes, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
      input.id, input.botId, input.sessionId, input.topics, input.when, cap,
      input.quietFrom ?? null, input.quietTo ?? null, input.allowPaidPrep === true ? 1 : 0,
      input.eventHook ?? null, input.eventMinutes ?? null, Date.now(),
    )
    return this.subscription(input.id) as SubscriptionRow
  }

  subscription(id: string): SubscriptionRow | undefined {
    const row = this.db.prepare('SELECT * FROM proactive_subscriptions WHERE id = ?').get(id)
    return row === undefined ? undefined : subscriptionOf(row as Record<string, unknown>)
  }

  subscriptionsOf(botId: string): SubscriptionRow[] {
    return this.db.prepare('SELECT * FROM proactive_subscriptions WHERE bot_id = ? ORDER BY created_at')
      .all(botId).map(row => subscriptionOf(row as Record<string, unknown>))
  }

  enabledSubscriptions(): SubscriptionRow[] {
    return this.db.prepare('SELECT * FROM proactive_subscriptions WHERE enabled = 1 ORDER BY created_at')
      .all().map(row => subscriptionOf(row as Record<string, unknown>))
  }

  /** Records that the poll fired a subscription, so the next tick computes from here. */
  noteFired(id: string, at: number = Date.now()): boolean {
    return this.db.prepare('UPDATE proactive_subscriptions SET last_fired_at = ? WHERE id = ?').run(at, id).changes > 0
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.db.prepare('UPDATE proactive_subscriptions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0
  }

  removeSubscription(id: string): boolean {
    return this.db.prepare('DELETE FROM proactive_subscriptions WHERE id = ?').run(id).changes > 0
  }

  // -- candidates and decisions ---------------------------------------------

  addCandidate(input: CandidateInput): CandidateRow {
    this.db.prepare(`INSERT INTO proactive_candidates
      (id, subscription_id, session_id, text, evidence, why_care, ttl, topic_keys, fingerprint, trigger_source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.subscriptionId, input.sessionId, input.text, JSON.stringify(input.evidence),
      input.whyCare, input.ttl, JSON.stringify(input.topicKeys), input.fingerprint,
      input.triggerSource, Date.now(),
    )
    return this.candidate(input.id) as CandidateRow
  }

  candidate(id: string): CandidateRow | undefined {
    const row = this.db.prepare('SELECT * FROM proactive_candidates WHERE id = ?').get(id)
    return row === undefined ? undefined : candidateOf(row as Record<string, unknown>)
  }

  /**
   * The candidates a subscription prepared since a moment, with what became of them.
   * The window the screen uses for de-duplication and for "has it been asked already".
   */
  recentCandidates(subscriptionId: string, since: number): readonly (CandidateRow & { readonly decision: DecisionRow | undefined })[] {
    const rows = this.db.prepare(`
      SELECT c.*, d.decision AS d_decision, d.reason AS d_reason, d.decided_at AS d_decided_at
      FROM proactive_candidates c
      LEFT JOIN proactive_decisions d ON d.candidate_id = c.id
      WHERE c.subscription_id = ? AND c.created_at >= ?
      ORDER BY c.created_at DESC`).all(subscriptionId, since) as Record<string, unknown>[]
    return rows.map(row => ({
      ...candidateOf(row),
      decision: row.d_decision === null || row.d_decision === undefined
        ? undefined
        : decisionOf({ candidate_id: row.id, decision: row.d_decision, reason: row.d_reason, decided_at: row.d_decided_at }),
    }))
  }

  /** How many this subscription has actually delivered on a local day. */
  deliveredOn(subscriptionId: string, since: number, until: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM proactive_decisions d
      JOIN proactive_candidates c ON c.id = d.candidate_id
      WHERE c.subscription_id = ? AND d.decision = 'delivered' AND d.decided_at >= ? AND d.decided_at < ?`)
      .get(subscriptionId, since, until) as { readonly n?: number } | undefined
    return Number(row?.n ?? 0)
  }

  /** Candidates still waiting on quiet hours, oldest first. The morning retry reads this. */
  delayedSince(windowStart: number): readonly (CandidateRow & { readonly decidedAt: number | undefined })[] {
    const rows = this.db.prepare(`
      SELECT c.*, d.decided_at AS d_decided_at
      FROM proactive_candidates c
      JOIN proactive_decisions d ON d.candidate_id = c.id
      WHERE d.decision = 'delayed' AND c.created_at >= ?
      ORDER BY c.created_at ASC`).all(windowStart) as Record<string, unknown>[]
    return rows.map(row => ({
      ...candidateOf(row),
      decidedAt: row.d_decided_at === null || row.d_decided_at === undefined ? undefined : Number(row.d_decided_at),
    }))
  }

  /** Records what was decided. One decision per candidate: the first one wins. */
  decide(candidateId: string, decision: DecisionRow['decision'], reason: string | null = null): void {
    this.db.prepare(`INSERT INTO proactive_decisions (candidate_id, decision, reason, decided_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(candidate_id) DO NOTHING`).run(candidateId, decision, reason, Date.now())
  }

  /** Replaces a decision: the morning retry needs its outcome to be the current one. */
  replaceDecision(candidateId: string, decision: DecisionRow['decision'], reason: string | null = null): void {
    this.db.prepare(`INSERT INTO proactive_decisions (candidate_id, decision, reason, decided_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, decided_at = excluded.decided_at`)
      .run(candidateId, decision, reason, Date.now())
  }

  decision(candidateId: string): DecisionRow | undefined {
    const row = this.db.prepare('SELECT * FROM proactive_decisions WHERE candidate_id = ?').get(candidateId)
    return row === undefined ? undefined : decisionOf(row as Record<string, unknown>)
  }
}

/** One rule the user wrote down, as the audit and the gate read it. */
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
    this.db.prepare(`INSERT INTO proactive_preauth
      (id, subscription_id, purpose, when_json, tools, prohibitions, daily_cap, respect_quiet_hours, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.subscriptionId, input.purpose, input.when, JSON.stringify(input.tools),
      JSON.stringify(input.prohibitions), input.dailyCap, input.respectQuietHours ? 1 : 0,
      input.enabled ? 1 : 0, input.createdAt ?? Date.now(),
    )
    return this.rule(input.id) as StoredRule
  }

  rule(id: string): StoredRule | undefined {
    const row = this.db.prepare('SELECT * FROM proactive_preauth WHERE id = ?').get(id)
    return row === undefined ? undefined : ruleOf(row as Record<string, unknown>)
  }

  rulesOf(subscriptionId: string): StoredRule[] {
    return this.db.prepare('SELECT * FROM proactive_preauth WHERE subscription_id = ? ORDER BY created_at')
      .all(subscriptionId).map(row => ruleOf(row as Record<string, unknown>))
  }

  /** Every rule of every subscription one Bot owns, for the settings surface. */
  rulesForBot(botId: string): StoredRule[] {
    return this.db.prepare(`SELECT r.* FROM proactive_preauth r
      JOIN proactive_subscriptions s ON s.id = r.subscription_id
      WHERE s.bot_id = ? ORDER BY r.created_at`).all(botId).map(row => ruleOf(row as Record<string, unknown>))
  }

  revoke(id: string): boolean {
    return this.db.prepare('DELETE FROM proactive_preauth WHERE id = ?').run(id).changes > 0
  }

  /** Records one attempt, whether it acted or not. */
  audit(ruleId: string, tool: string, outcome: 'acted' | 'waited' | 'proposed', reason: string | null, at: number = Date.now()): void {
    this.db.prepare('INSERT INTO proactive_audit (rule_id, tool, outcome, reason, at) VALUES (?, ?, ?, ?, ?)')
      .run(ruleId, tool, outcome, reason, at)
  }

  /** How many times a rule acted on the local day starting at `since`. */
  actedSince(ruleId: string, since: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM proactive_audit WHERE rule_id = ? AND outcome = 'acted' AND at >= ?")
      .get(ruleId, since) as { readonly n?: number } | undefined
    return Number(row?.n ?? 0)
  }

  auditOf(ruleId: string, limit = 50): readonly { readonly tool: string, readonly outcome: string, readonly reason: string | null, readonly at: number }[] {
    return this.db.prepare('SELECT * FROM proactive_audit WHERE rule_id = ? ORDER BY at DESC LIMIT ?').all(ruleId, limit)
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

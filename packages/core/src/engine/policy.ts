// The policy engine (plan §五, 阶段 5): every tool call passes a risk gate before it
// runs. The levels are the plan's:
//   L0 read-only — no side effects anywhere.
//   L1 in-chat effects — reversible inside the conversation (messages, cards, memory).
//   L2 workspace writes — confined to the team's folders by the runtime.
//   L3 external or costly — side effects beyond the workspace, or spending.
//   L4 irreversible — destructive or account-level; runs inside a much smaller daily
//      budget, then every call asks. A design that needs a level to ask always (the
//      browser actions in docs/plans/2026-10-28-browser-and-computer-boundaries.md)
//      adds that rule explicitly instead of relying on L4.
// The decision is the server's alone: the refusal text says so in as many words, so a
// model cannot argue its way past it, and no tool result carries an override.
import type { GateDecision } from './builtin/services.ts'

export type RiskLevel = 0 | 1 | 2 | 3 | 4

/** How many L3 calls a session may make a day before each further one asks. */
export interface PolicyBudget {
  readonly level3PerDay: number
  readonly level4PerDay: number
}

export const DEFAULT_BUDGET: PolicyBudget = { level3PerDay: 20, level4PerDay: 5 }

/** One tool's classification: a level, and whether folder-approval already covers it. */
export interface PolicyRule {
  readonly level: RiskLevel
  /** The call already asks through the folder-approval flow; the policy stays quiet. */
  readonly asksItself?: boolean | undefined
}

// The team's own tools, classified. Anything unlisted is L3: unknown means outside the
// auditable set, and the safe answer for an unknown is to ask.
const RULES: Readonly<Record<string, PolicyRule>> = {
  list_bots: { level: 0 },
  list_models: { level: 0 },
  list_engines: { level: 0 },
  list_schedules: { level: 0 },
  read_own_chat: { level: 0 },
  read_group_chat: { level: 0 },
  list_capabilities: { level: 0 },
  list_secrets: { level: 0 },
  message_bot: { level: 1 },
  post_to_group: { level: 1 },
  ask_user: { level: 1 },
  show_view: { level: 1 },
  group_relay: { level: 1 },
  remember: { level: 1 },
  forget: { level: 1 },
  recall: { level: 1 },
  create_group: { level: 2 },
  update_group: { level: 2 },
  working_directory: { level: 2, asksItself: true },
  save_capability: { level: 2 },
  attach_capability: { level: 3 },
  detach_capability: { level: 2 },
  delete_capability: { level: 3 },
  create_bot: { level: 4 },
  update_bot: { level: 2 },
  create_schedule: { level: 2 },
  delete_schedule: { level: 2 },
  stop_bot: { level: 2 },
  delete_group: { level: 4 },
  request_secret: { level: 4 },
}

export const ruleOf = (tool: string): PolicyRule => RULES[tool] ?? { level: 3 }

/** What the day's ledger says about a session: counts by level. */
export interface DayCounters {
  readonly level3: number
  readonly level4: number
}

export interface PolicyLedger {
  /** The counters for a session's day, adding `spent` more of a level if told. */
  countersOf(sessionId: string, level: 3 | 4, spend?: number): Promise<number>
}

/** The decision the engine's gate hands back, in the gate's own vocabulary. */
export type PolicyDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'approval'; readonly reason: string }

export class PolicyEngine {
  private readonly ledger: PolicyLedger | undefined
  private readonly budget: PolicyBudget

  constructor(ledger: PolicyLedger | undefined, budget: PolicyBudget = DEFAULT_BUDGET) {
    this.ledger = ledger
    this.budget = budget
  }

  /**
   * Decides one call. L0–L2 run; L3 runs within its budget, then asks; L4 asks within
   * a much smaller budget. A refusal never names an appeal — the policy is the
   * server's, not the model's to negotiate.
   */
  async decide(sessionId: string, tool: string): Promise<PolicyDecision> {
    const rule = ruleOf(tool)
    if (rule.level <= 2 || rule.asksItself === true) return { kind: 'allow' }
    const gated: 3 | 4 = rule.level === 4 ? 4 : 3
    const cap = gated === 4 ? this.budget.level4PerDay : this.budget.level3PerDay
    const spent = (await this.ledger?.countersOf(sessionId, gated, 1)) ?? 0
    if (spent <= cap) return { kind: 'allow' }
    return {
      kind: 'approval',
      reason:
        rule.level === 4
          ? `${tool} changes things that do not come back; the user decides`
          : `${tool} has run ${String(spent - 1)} times today; the user decides whether it goes on`,
    }
  }

  /** Shapes a policy decision as the engine gate's answer. */
  static asGateReason(decision: PolicyDecision): string | undefined {
    return decision.kind === 'allow' ? undefined : decision.reason
  }
}

export type { GateDecision }

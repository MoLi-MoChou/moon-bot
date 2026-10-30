// Pre-authorised actions (§7): a rule the user wrote, which a Bot may carry out without
// asking again.
//
// This is the part of the feature closest to the project's red line, so the shape is
// deliberately narrow. A rule names three things — when it fires, what it may do, and what
// it may never do — and everything outside that scope falls back to a suggestion. A rule can
// only be written in conversation, it is recorded, and it can be revoked; nothing here
// changes a default, and no rule exists until a user writes one.
import { ruleOf } from '../../engine/policy.ts'
import type { TriggerSource } from './screen-hard.ts'

/** One thing a rule allows. */
export interface PreAuthScope {
  /** The tool names it may call. Anything else is out of scope. */
  readonly tools: readonly string[]
  /** How many times a day it may act, whatever the subscription says. */
  readonly dailyCap: number
}

export interface PreAuthRule {
  readonly id: string
  readonly subscriptionId: string
  /** In the user's words, for the surface: what this rule is for. */
  readonly purpose: string
  /** The condition, as the trigger understands it. */
  readonly when:
    | { readonly kind: 'no-progress'; readonly minutes: number }
    | { readonly kind: 'schedule'; readonly at: string }
  readonly scope: PreAuthScope
  /** Tools it may never call, even if they would otherwise be in scope. */
  readonly prohibitions: readonly string[]
  /**
   * Whether it may act during the subscription's quiet hours. False unless the user ticked
   * a box and saw the warning: a rescue at 03:00 is a real need, but it is not the default.
   */
  readonly respectQuietHours: boolean
  readonly enabled: boolean
  readonly createdAt: number
}

export interface PreAuthAttempt {
  readonly tool: string
  /** Everything the rule would need before acting, checked by the caller. */
  readonly withinQuietHours: boolean
  readonly actedToday: number
}

export type PreAuthVerdict =
  | { readonly kind: 'act' }
  /** Out of scope or forbidden: the Bot may only propose this, as it would without a rule. */
  | { readonly kind: 'propose'; readonly reason: string }
  /** In scope, but not now: the quiet window or the day's cap. */
  | { readonly kind: 'wait'; readonly reason: string }

/**
 * Whether a rule lets this action happen now. Every path out except `act` means the Bot
 * falls back to proposing, which is the behaviour without any rule at all.
 */
/** The highest risk level a rule may ever cover. Everything above it still asks. */
export const PREAUTH_MAX_LEVEL = 2

/**
 * Whether a tool is within what a rule may ever cover, whatever the rule says.
 *
 * This is the red line, in code: a rule is the user writing down a standing instruction, and
 * that can cover reading and ordinary work. It cannot cover an action that spends money or
 * cannot be undone — those keep asking every time, which is what the project's approval
 * rules require and what a pre-authorised rule must not be able to get around.
 */
export const coverableByRule = (tool: string): boolean => ruleOf(tool).level <= PREAUTH_MAX_LEVEL

export function mayAct(rule: PreAuthRule, attempt: PreAuthAttempt): PreAuthVerdict {
  if (!rule.enabled) return { kind: 'propose', reason: 'this rule is turned off' }
  // Checked before the rule's own scope: a rule that names an irreversible tool is wrong,
  // and the answer is to ask, not to obey.
  if (!coverableByRule(attempt.tool))
    return { kind: 'propose', reason: `${attempt.tool} always asks, so no rule can cover it` }
  // A prohibition wins over scope: a tool can be in scope by category and still be banned.
  if (rule.prohibitions.includes(attempt.tool))
    return { kind: 'propose', reason: `${attempt.tool} is on this rule's do-not list` }
  if (!rule.scope.tools.includes(attempt.tool))
    return { kind: 'propose', reason: `${attempt.tool} is outside what this rule allows` }
  if (attempt.actedToday >= rule.scope.dailyCap)
    return { kind: 'wait', reason: 'this rule has acted as often as it may today' }
  if (attempt.withinQuietHours && !rule.respectQuietHours) {
    // The user chose to allow it; that was their decision to make, and the rule records it.
    return { kind: 'act' }
  }
  if (attempt.withinQuietHours) return { kind: 'wait', reason: 'quiet hours' }
  return { kind: 'act' }
}

/** The audit line one action leaves, kept for the task panel. */
export interface PreAuthAudit {
  readonly ruleId: string
  readonly tool: string
  readonly at: number
  readonly outcome: 'acted' | 'waited' | 'proposed'
  readonly reason?: string | undefined
}

export const auditOf = (
  rule: PreAuthRule,
  attempt: PreAuthAttempt,
  verdict: PreAuthVerdict,
  at: number,
): PreAuthAudit => ({
  ruleId: rule.id,
  tool: attempt.tool,
  at,
  outcome: verdict.kind === 'act' ? 'acted' : verdict.kind === 'wait' ? 'waited' : 'proposed',
  ...(verdict.kind === 'act' ? {} : { reason: verdict.reason }),
})

/** The trigger a rule sits on, in the pipeline's own vocabulary. */
export const preAuthSource = (): TriggerSource => 'preauth'

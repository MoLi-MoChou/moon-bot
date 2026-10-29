// The gate's pre-authorisation step: called only where the policy engine would otherwise ask
// the user, so a rule can never make something happen that was not going to be allowed
// anyway, and can never reach a level the policy keeps for the user.
import { auditOf, mayAct, coverableByRule } from '../host/proactive/preauth.ts'
import { localTimeAt } from '../host/proactive/review.ts'
import { withinQuietHours } from '../host/proactive/screen-hard.ts'
import { dayStartFor } from '../host/proactive/trigger.ts'
import type { HostRuntime } from '../host/runtime.js'
import type { Store } from '../store/db.ts'

/** The window a rule respects unless the user turned that off when writing it. */
const QUIET_WINDOW = { from: '22:00', to: '08:00' }

/**
 * Returns the id of a rule that allows this tool right now, or undefined to ask the user.
 *
 * This is only consulted where the policy would ask: an L0–L2 call that the preset allows
 * never reaches here, so a rule cannot widen what a Bot may do. It can only answer a
 * question that was already going to be put to the user.
 *
 * Every attempt is recorded, including the ones that only proposed: an audit trail is what
 * makes a rule reviewable later, and a rule nobody can review is worse than no rule.
 */
export function preAuthGate(runtime: HostRuntime, store: Store, sessionId: string, tool: string): string | undefined {
  // The red line, before any rule is read: spending money and irreversible changes always ask.
  if (!coverableByRule(tool)) return undefined
  const botId = runtime.selfOf(sessionId)
  if (botId === undefined) return undefined
  const time = localTimeAt(Date.now(), runtime.config.timeZone)
  const withinQuiet = withinQuietHours(time, QUIET_WINDOW)
  for (const stored of store.proactiveRules.rulesForBot(botId)) {
    const rule = {
      id: stored.id,
      subscriptionId: stored.subscriptionId,
      purpose: stored.purpose,
      when: JSON.parse(stored.when) as { kind: 'no-progress', minutes: number },
      scope: { tools: stored.tools, dailyCap: stored.dailyCap },
      prohibitions: stored.prohibitions,
      respectQuietHours: stored.respectQuietHours,
      enabled: stored.enabled,
      createdAt: stored.createdAt,
    }
    const actedToday = store.proactiveRules.actedSince(stored.id, dayStartFor(runtime.config.timeZone))
    const verdict = mayAct(rule, { tool, withinQuietHours: withinQuiet, actedToday })
    const audit = auditOf(rule, { tool, withinQuietHours: withinQuiet, actedToday }, verdict, Date.now())
    store.proactiveRules.audit(stored.id, tool, audit.outcome, audit.reason ?? null)
    if (verdict.kind === 'act') return stored.id
  }
  return undefined
}

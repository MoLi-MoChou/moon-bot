// The channel half of proactive messages (2026-10-29 proactive-messages): the
// subscriptions a user manages, and the manual "look back over today" run.
//
// The work happens in host/proactive; this only carries it over the api/bot channel. A
// manual run lists candidates and decides nothing, so pressing the button can never send
// the user a message they did not ask for.
import type { ChannelHandler, ChannelHandlers } from './envelope.ts'
import { fail, ok } from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'

interface ProactiveEntry {
  readonly id: string
  readonly botId: string
  readonly topics: string
  readonly dailyCap: number
  readonly enabled: boolean
  readonly when: string
  readonly quietFrom: string | null
  readonly quietTo: string | null
  readonly eventHook: string | null
  readonly eventMinutes: number | null
}

interface ReviewEntry {
  readonly id: string
  readonly text: string
  readonly evidence: readonly string[]
  readonly whyCare: string
  readonly ttl: 'short' | 'long'
  /** What the screen would do with it, so the panel can show why nothing would send. */
  readonly would: 'send' | 'drop' | 'delay'
  readonly reason?: string
}

interface Review {
  readonly candidates: readonly ReviewEntry[]
  /** How many candidates were looked at; the quality signal the plan asks for. */
  readonly considered: number
}

interface PreAuthReader {
  proactiveRules?():
    | {
        readonly rulesForBot: (botId: string) => readonly Record<string, unknown>[]
        readonly add: (input: Record<string, unknown>) => Record<string, unknown>
        readonly revoke: (id: string) => boolean
        readonly auditOf: (ruleId: string) => readonly Record<string, unknown>[]
      }
    | undefined
}

interface ProactiveReader {
  proactiveStore?():
    | {
        readonly subscriptionsOf: (botId: string) => readonly ProactiveEntry[]
        readonly addSubscription: (input: Record<string, unknown>) => ProactiveEntry
        readonly setEnabled: (id: string, enabled: boolean) => boolean
        readonly removeSubscription: (id: string) => boolean
      }
    | undefined
  proactiveReview?(botId: string): Promise<Review>
}

const entry = (row: Record<string, unknown>): ProactiveEntry => ({
  id: String(row.id),
  botId: String(row.botId ?? row.bot_id ?? ''),
  topics: String(row.topics ?? ''),
  dailyCap: Number(row.dailyCap ?? row.daily_cap ?? 1),
  enabled: row.enabled === true || Number(row.enabled) === 1,
  when: String(row.when ?? row.when_json ?? '{}'),
  quietFrom: (row.quietFrom ?? row.quiet_from ?? null) as string | null,
  quietTo: (row.quietTo ?? row.quiet_to ?? null) as string | null,
  eventHook: (row.eventHook ?? row.event_hook ?? null) as string | null,
  eventMinutes: (row.eventMinutes ?? row.event_minutes ?? null) as number | null,
})

export function proactiveHandlers(rt: ChannelRuntime): ChannelHandlers {
  const reader = rt as unknown as ProactiveReader
  const storeOf = () => reader.proactiveStore?.()
  const handlers: Partial<Record<string, ChannelHandler>> = {
    'proactive-subscriptions': async body => {
      await rt.load()
      const store = storeOf()
      if (store === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      const botId = String(body.botId ?? '')
      if (botId === '') return fail('Say which Bot these are for', 'bot/invalid')
      return ok({
        subscriptions: store.subscriptionsOf(botId).map(item => entry(item as unknown as Record<string, unknown>)),
      })
    },
    'proactive-subscribe': async body => {
      await rt.load()
      const store = storeOf()
      if (store === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      const botId = String(body.botId ?? '')
      const topics = String(body.topics ?? '').trim()
      if (botId === '') return fail('Say which Bot this is for', 'bot/invalid')
      // A subscription with no subject has nothing to watch, and would only burn model calls.
      if (topics === '') return fail('Say what this Bot should keep an eye on', 'bot/invalid')
      const made = store.addSubscription({
        id: String(body.id ?? `sub-${botId}-${Date.now().toString(36)}`),
        botId,
        sessionId: String(body.sessionId ?? botId),
        topics,
        when: String(body.when ?? '{}'),
        dailyCap: body.dailyCap === undefined ? undefined : Number(body.dailyCap),
        quietFrom: body.quietFrom === undefined ? undefined : (body.quietFrom as string | null),
        quietTo: body.quietTo === undefined ? undefined : (body.quietTo as string | null),
        allowPaidPrep: false,
        eventHook: body.eventHook === undefined ? undefined : (body.eventHook as string | null),
        eventMinutes: body.eventMinutes === undefined ? undefined : Number(body.eventMinutes),
      })
      return ok({ subscription: entry(made as unknown as Record<string, unknown>) })
    },
    'proactive-unsubscribe': async body => {
      await rt.load()
      const store = storeOf()
      if (store === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      const id = String(body.id ?? '')
      if (id === '') return fail('Say which subscription', 'bot/invalid')
      return ok({ removed: store.removeSubscription(id) })
    },
    'proactive-enable': async body => {
      await rt.load()
      const store = storeOf()
      if (store === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      const id = String(body.id ?? '')
      if (id === '') return fail('Say which subscription', 'bot/invalid')
      // Saying "not this kind" turns a subscription off; it never silently deletes it, so
      // the user can turn it back on when they want it again.
      return ok({ enabled: store.setEnabled(id, body.enabled !== false) })
    },
    'proactive-stats': async body => {
      await rt.load()
      const stats = (rt as unknown as { proactiveStats?: (since: number) => Record<string, number> }).proactiveStats
      if (stats === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      // A window, not a lifetime: the question is whether it is working now. A week is the
      // shortest span that covers a full weekly rhythm of the user's work.
      const days = Math.min(Math.max(Number(body.days ?? 7), 1), 90)
      const since = Date.now() - days * 24 * 60 * 60_000
      return ok({ ...stats(since), since })
    },
    'proactive-preauth-list': async body => {
      await rt.load()
      const rules = (rt as unknown as PreAuthReader).proactiveRules?.()
      if (rules === undefined) return fail('Pre-authorised rules are turned off on this host', 'bot/unavailable')
      const botId = String(body.botId ?? '')
      if (botId === '') return fail('Say which Bot these are for', 'bot/invalid')
      return ok({
        rules: rules.rulesForBot(botId).map(rule => ({ ...rule, audit: rules.auditOf(String(rule.id)) })),
      })
    },
    'proactive-preauth-write': async body => {
      await rt.load()
      const rules = (rt as unknown as PreAuthReader).proactiveRules?.()
      if (rules === undefined) return fail('Pre-authorised rules are turned off on this host', 'bot/unavailable')
      const purpose = String(body.purpose ?? '').trim()
      const tools = Array.isArray(body.tools) ? body.tools.map(String) : []
      // A rule with no purpose or no tools is not a rule: it would be an open permission.
      if (purpose === '') return fail('Say what this rule is for', 'bot/invalid')
      if (tools.length === 0) return fail('Name at least one thing this rule may do', 'bot/invalid')
      const minutes = Number(body.minutes ?? 0)
      if (!Number.isFinite(minutes) || minutes <= 0) return fail('Say how many minutes of silence count', 'bot/invalid')
      const made = rules.add({
        id: String(body.id ?? `rule-${Date.now().toString(36)}`),
        subscriptionId: String(body.subscriptionId ?? ''),
        purpose,
        when: JSON.stringify({ kind: 'no-progress', minutes }),
        tools,
        prohibitions: Array.isArray(body.prohibitions) ? body.prohibitions.map(String) : [],
        dailyCap: Number(body.dailyCap ?? 3),
        // The conservative default: quiet hours are respected unless the user said otherwise.
        respectQuietHours: body.allowQuietHours !== true,
        enabled: true,
      })
      return ok({ rule: made })
    },
    'proactive-preauth-revoke': async body => {
      await rt.load()
      const rules = (rt as unknown as PreAuthReader).proactiveRules?.()
      if (rules === undefined) return fail('Pre-authorised rules are turned off on this host', 'bot/unavailable')
      return ok({ revoked: rules.revoke(String(body.id ?? '')) })
    },
    'proactive-review': async body => {
      await rt.load()
      const review = reader.proactiveReview
      if (review === undefined) return fail('Proactive messages are turned off on this host', 'bot/unavailable')
      const botId = String(body.botId ?? '')
      if (botId === '') return fail('Say which Bot to look back over', 'bot/invalid')
      return ok(await review(botId))
    },
  }
  return handlers as ChannelHandlers
}

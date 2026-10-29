// Wiring the proactive surface into one place, because the subscription shape has to be
// flattened for the channel and that flattening is worth keeping out of the assembly file.
import { install } from '../host/proactive-install.ts'
import { localTimeAt } from '../host/proactive/review.ts'
import { dayStartFor } from '../host/proactive/trigger.ts'
import { startDuePoll, type DueDeps } from '../host/proactive/schedule.ts'
import type { HostRuntime } from '../host/runtime.js'
import type { Store } from '../store/db.ts'

/** The parts of a stored subscription the interface sees. */
const shapeOf = (row: {
  readonly id: string
  readonly botId: string
  readonly topics: string
  readonly dailyCap: number
  readonly quietFrom: string | null
  readonly quietTo: string | null
  readonly eventHook: string | null
  readonly eventMinutes: number | null
  readonly enabled: boolean
  readonly when: string
}) => ({
  id: row.id, botId: row.botId, topics: row.topics, dailyCap: row.dailyCap,
  quietFrom: row.quietFrom, quietTo: row.quietTo, eventHook: row.eventHook,
  eventMinutes: row.eventMinutes, enabled: row.enabled, when: row.when,
})

/** The text of a stored message, for the day a review reads. */
const textOf = (row: { readonly content: readonly { readonly type: string, readonly text?: unknown }[] }): string =>
  row.content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join(' ')

/** Starts the poll that lets a subscription fire on its own; returns the disposer. */
export function startProactivePoll(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): () => void {
  const timeZone = runtime.config.timeZone
  const deps: DueDeps = {
    pipeline: {
      ask: async ({ system, prompt }) => {
        const botId = currentBot ?? ''
        const small = runtime.smallShot
        if (small === undefined || botId === '') throw new Error('No model is available')
        return small(botId, system, prompt)
      },
      judgeAsk: async ({ system, prompt }) => {
        const botId = currentBot ?? ''
        const small = runtime.smallShot
        if (small === undefined || botId === '') throw new Error('No model is available')
        return small(botId, system, prompt)
      },
      newId: () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => Date.now(),
      log: (message, ...rest) => runtime.warn(message, ...rest),
    },
    send: {
      send: (sessionId, text, source) => {
        const agent = agentOf(sessionId) as { followup?(value: unknown): void } | undefined
        if (agent?.followup === undefined) return false
        agent.followup({ content: [{ type: 'text', text }], source })
        return true
      },
      record: (candidateId, decision, reason) => store.proactive.decide(candidateId, decision, reason ?? null),
      live: sessionId => runtime.readOnly() === undefined && runtime.live.get(sessionId) !== undefined,
    },
    contextOf: async (subscriptionId, botId) => {
      currentBot = botId
      return await contextFor(runtime, store, subscriptionId, botId)
    },
    localTime: () => localTimeAt(Date.now(), timeZone),
    localDayStart: () => dayStartFor(timeZone),
    dueSubscriptions: () => store.proactive.enabledSubscriptions().map(row => ({ id: row.id, botId: row.botId, when: row.when })),
    lastFiredAt: id => store.proactive.subscription(id)?.lastFiredAt ?? undefined,
    noteFired: (id, at) => { store.proactive.noteFired(id, at) },
    now: () => Date.now(),
    log: (message, ...rest) => runtime.warn(message, ...rest),
  }
  return startDuePoll(deps)
}

/** The Bot whose run is in flight, so the model call knows whose credentials to use. */
let currentBot: string | undefined

/** Everything one triggered run reads, assembled at fire time so it is never stale. */
async function contextFor(runtime: HostRuntime, store: Store, subscriptionId: string, botId: string) {
  const subscription = store.proactive.subscription(subscriptionId)
  if (subscription === undefined) return undefined
  const sessionId = runtime.chatOf(botId)
  const now = Date.now()
  const dayStart = dayStartFor(runtime.config.timeZone, now)
  const earlier = store.proactive.recentCandidates(subscriptionId, now - 7 * 24 * 60 * 60_000)
  return {
    topics: subscription.topics,
    dailyCap: subscription.dailyCap,
    sessionId,
    quietFrom: subscription.quietFrom,
    quietTo: subscription.quietTo,
    memory: [] as readonly { readonly topic: string | null, readonly text: string, readonly added: string | null }[],
    messages: store.sessions.since(sessionId, dayStart).map(row => ({ role: row.role, text: textOf(row), at: row.createdAt })),
    earlier: earlier.map(item => ({
      fingerprint: item.fingerprint,
      topicKeys: JSON.parse(item.topicKeys) as readonly string[],
      decision: item.decision?.decision as 'delivered' | 'quiet' | 'dropped' | 'delayed' | undefined,
      decidedAt: item.decision?.decidedAt,
    })),
    alreadySaid: earlier.map(item => item.text),
    deliveredToday: store.proactive.deliveredOn(subscriptionId, dayStart, now),
    // The screen's "the user just raised this" check is the prep prompt's job here: the
    // model is told what was said today and is asked not to repeat it.
    mentionedRecently: false,
  }
}

/** Installs the surface and starts the poll. Returns the poll's disposer, if any. */
export function installProactive(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): () => void {
  installProactiveFrom(runtime, store, agentOf)
  return startProactivePoll(runtime, store, agentOf)
}

export function installProactiveFrom(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): void {
  const timeZone = runtime.config.timeZone
  install(runtime, {
    deps: {
      store: () => store.proactive,
      messagesSince: (sessionId, since) => store.sessions.since(sessionId, since).map(row => ({
        role: row.role, text: textOf(row), at: row.createdAt,
      })),
      // Memory is read through the host in a later step; a review with none still works,
      // it just has less to notice.
      memoryOf: () => [],
      localTimeOf: at => localTimeAt(at, timeZone),
      timeZone: () => timeZone,
    },
    listOf: botId => store.proactive.subscriptionsOf(botId).map(shapeOf),
    add: input => shapeOf(store.proactive.addSubscription(input as never)),
    setEnabled: (id, enabled) => store.proactive.setEnabled(id, enabled),
    remove: id => store.proactive.removeSubscription(id),
    hand: (sessionId, message) => {
      const agent = agentOf(sessionId) as { followup?(value: unknown): void } | undefined
      if (agent?.followup === undefined) return false
      agent.followup(message)
      return true
    },
  })
}

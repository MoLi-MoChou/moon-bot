// Wiring the proactive surface into one place, because the subscription shape has to be
// flattened for the channel and that flattening is worth keeping out of the assembly file.
import { install } from '../host/proactive-install.ts'
import { localTimeAt } from '../host/proactive/review.ts'
import { dayStartFor } from '../host/proactive/trigger.ts'
import { startDuePoll, type DueDeps } from '../host/proactive/schedule.ts'
import { ProgressWatch, startProgressPoll, type ProgressDeps } from '../host/proactive/progress.ts'
import { retryFrom } from '../host/proactive/retry.ts'
import { statsSince } from '../store/proactive-stats.ts'
import { createRoundLog, install as installRounds } from '../host/proactive/rounds.ts'
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

/** The dependencies both polls share: how to ask, how to send, what to read. */
function triggerDepsOf(runtime: HostRuntime, store: Store, timeZone: string | undefined): DueDeps {
  const ask = async ({ system, prompt }: { readonly system: string, readonly prompt: string }): Promise<string> => {
    const small = runtime.smallShot
    if (small === undefined || currentBot === undefined) throw new Error('No model is available')
    return small(currentBot, system, prompt)
  }
  return {
    pipeline: {
      ask,
      judgeAsk: ask,
      newId: () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => Date.now(),
      log: (message, ...rest) => runtime.warn(message, ...rest),
    },
    send: {
      send: (sessionId, text, source) => {
        const agent = agentOfRef?.(sessionId) as { followup?(value: unknown): void } | undefined
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
    noteRound: round => {
      roundLog.note({ ...round, botName: runtime.botOf(round.botId)?.name ?? round.botId, at: Date.now() })
    },
  }
}

/** Starts the poll that lets a subscription fire on its own; returns the disposer. */
export function startProactivePoll(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): () => void {
  agentOfRef = agentOf
  const shared = triggerDepsOf(runtime, store, runtime.config.timeZone)
  return startDuePoll({
    ...shared,
    beforeTick: () => retryDelayedNow(runtime, store, agentOf),
  })
}

/** How to reach a Session's engine; set once when the surface is installed. */
let agentOfRef: ((sessionId: string) => unknown) | undefined
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
    memory: runtime.memoryLinesOf?.(botId) ?? [],
    messages: store.sessions.since(sessionId, dayStart).map(row => ({ role: row.role, text: textOf(row), at: row.createdAt })),
    earlier: earlier.map(item => ({
      fingerprint: item.fingerprint,
      topicKeys: JSON.parse(item.topicKeys) as readonly string[],
      decision: item.decision?.decision as 'delivered' | 'quiet' | 'dropped' | 'delayed' | undefined,
      decidedAt: item.decision?.decidedAt,
    })),
    alreadySaid: earlier.map(item => item.text),
    deliveredToday: store.proactive.deliveredOn(subscriptionId, dayStart, now),
    // The "the user just raised this" check is the prep prompt's job in a triggered run: the
    // model is told what was said today and asked not to repeat it.
    mentionedRecently: false,
  }
}

/** Every proactive run this process made, for the task panel. */
const roundLog = createRoundLog()

/** The activity the no-progress hook reads: one watch for the whole host. */
export const progressWatch = new ProgressWatch()

/** Starts the no-progress hook: a subscription that names it fires after that much silence. */
export function startProgress(runtime: HostRuntime, store: Store): () => void {
  const timeZone = runtime.config.timeZone
  const deps: ProgressDeps = {
    ...triggerDepsOf(runtime, store, timeZone),
    watched: () => store.proactive.enabledSubscriptions()
      .filter(row => row.eventHook === 'no-progress' && (row.eventMinutes ?? 0) > 0)
      .map(row => ({ subscriptionId: row.id, botId: row.botId, sessionId: runtime.chatOf(row.botId), minutes: row.eventMinutes ?? 0 })),
    lastActivityAt: sessionId => progressWatch.lastActivityAt(sessionId),
    busy: sessionId => runtime.live.get(sessionId) !== undefined,
    noteFired: (id, at) => { store.proactive.noteFired(id, at) },
    now: () => Date.now(),
  }
  return startProgressPoll(deps)
}

/** Retries the candidates quiet hours held back. Called from the same poll as the schedule. */
export async function retryDelayedNow(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): Promise<void> {
  const timeZone = runtime.config.timeZone
  await retryFrom(runtime, {
    delayedOf: now => store.proactive.delayedSince(now - 7 * 24 * 60 * 60_000).map(row => ({
      id: row.id, subscriptionId: row.subscriptionId, sessionId: row.sessionId,
      text: row.text, evidence: JSON.parse(row.evidence) as readonly string[], ttl: row.ttl,
      fingerprint: row.fingerprint, topicKeys: JSON.parse(row.topicKeys) as readonly string[],
      createdAt: row.createdAt, decidedAt: row.decidedAt,
    })),
    earlierOf: subscriptionId => store.proactive.recentCandidates(subscriptionId, Date.now() - 7 * 24 * 60 * 60_000)
      .filter(item => item.decision?.decision !== 'delayed')
      .map(item => ({
        fingerprint: item.fingerprint,
        topicKeys: JSON.parse(item.topicKeys) as readonly string[],
        decision: item.decision?.decision as 'delivered' | 'quiet' | 'dropped' | undefined,
        decidedAt: item.decision?.decidedAt,
      })),
    deliveredToday: subscriptionId => store.proactive.deliveredOn(subscriptionId, dayStartFor(timeZone), Date.now()),
    dailyCapOf: subscriptionId => store.proactive.subscription(subscriptionId)?.dailyCap ?? 1,
    quietOf: subscriptionId => {
      const row = store.proactive.subscription(subscriptionId)
      return row === undefined || row.quietFrom === null || row.quietTo === null ? null : { from: row.quietFrom, to: row.quietTo }
    },
    mentionedRecently: () => false,
    localTime: () => localTimeAt(Date.now(), timeZone),
    now: () => Date.now(),
    send: (sessionId, text, source) => {
      const agent = agentOf(sessionId) as { followup?(value: unknown): void } | undefined
      if (agent?.followup === undefined) return false
      agent.followup({ content: [{ type: 'text', text }], source })
      return true
    },
    record: (candidateId, decision, reason) => store.proactive.replaceDecision(candidateId, decision, reason ?? null),
    log: (message, ...rest) => runtime.warn(message, ...rest),
  })
}

/** Installs the surface and starts both polls. Returns the combined disposer. */
export function installProactive(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): () => void {
  installProactiveFrom(runtime, store, agentOf)
  installRounds(runtime, roundLog)
  // Movement is any turn event: a message landing, a turn starting or ending. The hook only
  // reads this; it never writes to a conversation.
  runtime.ctx.on('session/event', (session: { readonly id?: string } | undefined) => {
    if (session?.id !== undefined) progressWatch.moved(session.id)
    return undefined
  })
  const stopDue = startProactivePoll(runtime, store, agentOf)
  const stopProgress = startProgress(runtime, store)
  return () => { stopDue(); stopProgress() }
}

export function installProactiveFrom(runtime: HostRuntime, store: Store, agentOf: (sessionId: string) => unknown): void {
  // The rules surface the channel reads; the gate itself lives in proactive-gate.
  Object.assign(runtime, {
    proactiveRules: () => store.proactiveRules,
    proactiveStats: (since: number) => statsSince(store.raw, since),
  })
  const timeZone = runtime.config.timeZone
  install(runtime, {
    deps: {
      store: () => store.proactive,
      messagesSince: (sessionId, since) => store.sessions.since(sessionId, since).map(row => ({
        role: row.role, text: textOf(row), at: row.createdAt,
      })),
      // Memory is read through the host in a later step; a review with none still works,
      // it just has less to notice.
      memoryOf: botId => runtime.memoryLinesOf?.(botId) ?? [],
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

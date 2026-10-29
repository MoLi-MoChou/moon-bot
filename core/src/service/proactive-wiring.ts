// Wiring the proactive surface into one place, because the subscription shape has to be
// flattened for the channel and that flattening is worth keeping out of the assembly file.
import { install } from '../host/proactive-install.ts'
import { localTimeAt } from '../host/proactive/review.ts'
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

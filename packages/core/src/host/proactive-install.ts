// Installing proactive messages on the host runtime: the subscription surface, the manual
// review, and (from here on) whatever triggers it.
//
// The store and the read paths are injected rather than imported, because the host layer
// does not own SQLite; the service wires this in one place.
import type { HostRuntime } from './runtime.js'
import { review, localTimeAt, type ProactiveDeps, type Review } from './proactive/review.ts'

/** The subscription shape the host hands to the channel, without the storage columns. */
export interface ProactiveSubscription {
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
}

export interface ProactiveInstall {
  readonly deps: ProactiveDeps
  /** Hands a prepared message to a Session's engine; false when it cannot take one. */
  readonly hand?:
    | ((
        sessionId: string,
        message: {
          readonly content: readonly { readonly type: 'text'; readonly text: string }[]
          readonly source: { readonly kind: 'proactive'; readonly subscriptionId: string; readonly candidateId: string }
        },
      ) => boolean)
    | undefined
  /** Every subscription of a Bot, enabled or not, for the settings surface. */
  readonly listOf: (botId: string) => readonly ProactiveSubscription[]
  readonly add: (input: Record<string, unknown>) => ProactiveSubscription
  readonly setEnabled: (id: string, enabled: boolean) => boolean
  readonly remove: (id: string) => boolean
}

export function install(rt: HostRuntime, install: ProactiveInstall): void {
  const { deps } = install
  const reviewFor = async (botId: string): Promise<Review> => await review(rt, deps, botId)
  Object.assign(rt, {
    proactiveStore: () => ({
      subscriptionsOf: install.listOf,
      addSubscription: install.add,
      setEnabled: install.setEnabled,
      removeSubscription: install.remove,
    }),
    proactiveSubscriptionsOf: install.listOf,
    proactiveReview: reviewFor,
    // The delivery half is reachable only through a send, which the trigger calls; a review
    // never sends.
    proactiveSend: install.hand,
    // The quiet-hours check needs the host's own clock, not the browser's: a message must
    // not go out at 23:00 because the user's laptop is in another time zone.
    proactiveLocalTime: () => localTimeAt(Date.now(), deps.timeZone()),
  })
}

/** Called once at install time so the service can share the same reads. */
export const reviewWith =
  (rt: HostRuntime, deps: ProactiveDeps) =>
  async (botId: string): Promise<Review> =>
    await review(rt, deps, botId)

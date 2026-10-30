// Reading the usage ledger: who each Session's calls belong to, catching the ledger up
// with every Session log, and the hourly rows the Usage page sums by day, week, month.
import type { SessionAddress, SessionListEntry } from '../host-types.js'
import type { HostRuntime } from '../runtime.js'
import { SLOT_MS } from './ledger.ts'
import type { Ledger } from './ledger.ts'

export const PAGE_MESSAGES = 400
export const PAGE_TIMEOUT_MS = 20_000
export const SCAN_TIMEOUT_MS = 180_000
export const SCAN_PARALLEL = 4
// A view waits this long for a scan, then answers with what it has.
export const VIEW_WAIT_MS = 6_000
export const RESCAN_AFTER_MS = 5_000
// An ended part still gets a few events (a title, a late reply) just after it ends.
export const SEAL_AFTER_MS = 60_000

/** One owner the Usage page lists. */
export type UsageOwner =
  | { readonly key: string; readonly kind: 'other' }
  | {
      readonly key: string
      readonly kind: 'room' | 'agent' | 'bot'
      readonly id: string
      readonly name: string
      readonly deleted?: boolean | undefined
    }

/** One model the Usage page lists. */
export interface UsageModel {
  readonly key: string
  readonly provider: string
  readonly model: string
  readonly name: string
  readonly providerName?: string | undefined
}

/** [hour, owner, model, kind, input, cacheRead, cacheWrite, output, calls] */
export type UsageRow = [string, number, number, number, number, number, number, number, number]

export interface UsageView {
  readonly owners: readonly UsageOwner[]
  readonly models: readonly UsageModel[]
  readonly kinds: readonly string[]
  readonly rows: readonly UsageRow[]
  readonly now: string
  readonly scanning: boolean
}

export interface UsageViewOptions {
  readonly timeZone?: string | undefined
}

export interface UsageViewer {
  view(options?: UsageViewOptions): Promise<UsageView>
  /** The Sessions the last scan listed, for the journal's parent-chain lookup. */
  sessions(): readonly SessionListEntry[]
}

export interface ViewerDeps {
  readonly rt: HostRuntime
  openLedger(): Promise<Ledger>
}

/** Every hour bucket in one time zone, as `YYYY-MM-DD HH`. */
export function hourKeys(timeZone: string | undefined): (time: number) => string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', timeZone === undefined ? options : { ...options, timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', options)
  }
  const cache = new Map<number, string>()
  return time => {
    const slot = Math.floor(time / SLOT_MS)
    let key = cache.get(slot)
    if (key === undefined) {
      const part = new Map(
        format.formatToParts(new Date(slot * SLOT_MS)).map(({ type, value }): [string, string] => [type, value]),
      )
      key = `${part.get('year')}-${part.get('month')}-${part.get('day')} ${part.get('hour')}`
      cache.set(slot, key)
    }
    return key
  }
}

export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next]
      if (item === undefined) break
      next += 1
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

// the host reads a subagent Session only through its parent's address; the parent
// need not exist any more. One with no parent on record cannot be read.
export const addressOf = (item: SessionListEntry): SessionAddress | undefined =>
  item.origin !== 'subagent'
    ? { kind: 'session', sessionId: item.sessionId }
    : item.parentSessionId === undefined
      ? undefined
      : { kind: 'subagent', parentSessionId: item.parentSessionId, childSessionId: item.sessionId, mode: 'unknown' }

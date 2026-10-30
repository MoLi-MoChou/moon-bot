// Reading the usage ledger: who each Session's calls belong to, catching the ledger up
// with every Session log, and the hourly rows the Usage page sums by day, week, month.
import type { SessionAddress, SessionEvent, SessionListEntry, SessionProjections } from '../host-types.js'
import type { HostRuntime } from '../runtime.js'
import { foldCalls } from './fold.ts'
import { SLOT_MS } from './ledger.ts'
import type { Ledger, OwnerRecord } from './ledger.ts'
import type {
  UsageOwner,
  UsageModel,
  UsageRow,
  UsageView,
  UsageViewOptions,
  UsageViewer,
  ViewerDeps,
} from './view-helpers.ts'
import {
  PAGE_MESSAGES,
  PAGE_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  SCAN_PARALLEL,
  VIEW_WAIT_MS,
  RESCAN_AFTER_MS,
  SEAL_AFTER_MS,
  hourKeys,
  eachLimited,
  addressOf,
} from './view-helpers.ts'
export type {
  UsageOwner,
  UsageModel,
  UsageRow,
  UsageView,
  UsageViewOptions,
  UsageViewer,
  ViewerDeps,
} from './view-helpers.ts'

// Who each Session's calls belong to, from the team as it is now. Sessions forked or
// spawned under one belong to the same owner, and a parent the team has lost
// (a deleted Bot) still passes its journaled owner down the chain.
export function liveOwners(
  rt: HostRuntime,
  listed: readonly SessionListEntry[] | undefined,
  stored: ReadonlyMap<string, OwnerRecord> | undefined,
): Map<string, OwnerRecord> {
  const owners = new Map<string, OwnerRecord>()
  const botOwner = (botId: string, name: string): OwnerRecord => ({ owner: botId, name })
  for (const bot of Object.values(rt.state.bots)) {
    for (const sessionId of [bot.id, rt.chatOf(bot.id), ...(bot.segments ?? []).map(segment => segment.sessionId)])
      owners.set(sessionId, botOwner(bot.id, bot.name))
  }
  for (const room of Object.values(rt.state.rooms)) {
    owners.set(room.id, { owner: `room:${room.id}`, name: room.name })
    const memberOwner = (botId: string): OwnerRecord => ({ owner: botId, name: rt.botOf(botId)?.name ?? '' })
    for (const [botId, sessionId] of Object.entries(room.sessions ?? {})) owners.set(sessionId, memberOwner(botId))
    for (const [botId, segments] of Object.entries(room.segments ?? {})) {
      for (const segment of segments) owners.set(segment.sessionId, memberOwner(botId))
    }
  }
  // The Agent is part of the team: its Sessions count beside the Bots, not
  // with the other sessions.
  for (const agent of Object.values(rt.state.agents ?? {})) {
    for (const sessionId of agent.sessions) owners.set(sessionId, { owner: `agent:${agent.id}`, name: agent.name })
  }
  const parents = new Map<string, string>()
  for (const item of listed ?? []) {
    if (item.parentSessionId !== undefined && item.parentSessionId !== '')
      parents.set(item.sessionId, item.parentSessionId)
  }
  for (const sessionId of parents.keys()) {
    let root = sessionId
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = parents.get(root)
      if (parent === undefined) break
      root = parent
    }
    if (owners.has(sessionId)) continue
    const found = owners.get(root) ?? stored?.get(root)
    if (found !== undefined) owners.set(sessionId, found)
  }
  return owners
}

// Sessions that speak inside a group chat, from the rooms as they are now.
export function inGroup(rt: HostRuntime): Set<string> {
  return new Set(
    Object.values(rt.state.rooms).flatMap(room => [
      ...Object.values(room.sessions ?? {}),
      ...Object.values(room.segments ?? {})
        .flat()
        .map(segment => segment.sessionId),
    ]),
  )
}

export function createViewer({ rt, openLedger }: ViewerDeps): UsageViewer {
  const { ctx } = rt
  let listed: readonly SessionListEntry[] = []
  let scanning: Promise<void> | undefined
  let scannedAt = 0
  // Sessions that already failed to read, so each one warns once, not every scan.
  const unreadable = new Set<string>()

  async function scanSession(
    ledger: Ledger,
    address: SessionAddress,
    asOfSeq: number | undefined,
    sealable: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const sessionId = address.kind === 'session' ? address.sessionId : address.childSessionId
    const mark = ledger.mark(sessionId)
    if (mark?.sealed === true) return
    let through: number | undefined = asOfSeq
    if (through === undefined) {
      const projections: SessionProjections | null | undefined = await ctx.sessionController.projections(
        { sessionId },
        signal,
      )
      if (projections === null || projections === undefined) return
      through = projections.asOfSeq
    }
    const from = mark?.through ?? -1
    if (typeof through !== 'number' || !Number.isSafeInteger(through) || through <= from) {
      if (mark !== undefined && sealable)
        ledger.commit(sessionId, { rows: [], reset: false, mark: { ...mark, sealed: true } })
      return
    }
    const events: SessionEvent[] = []
    let beforeSeq: number | undefined
    for (let reached = false; !reached; ) {
      const page = await ctx.sessionController.page(
        {
          address,
          throughSeq: through,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          maxMessages: PAGE_MESSAGES,
        },
        AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      )
      const got = page.records.map(record => record.event)
      for (let index = got.length - 1; index >= 0; index -= 1) {
        const event = got[index]
        if (event === undefined) break
        if (event.seq !== undefined && event.seq <= from) {
          reached = true
          break
        }
        events.push(event)
      }
      if (!page.hasMore || got.length === 0) break
      beforeSeq = got[0]?.seq
    }
    events.reverse()
    const first = events[0]
    if (first !== undefined && first.seq !== from + 1)
      throw new Error(`the history of ${sessionId} came back with a gap`)
    const fold = foldCalls(events, mark?.fold)
    ledger.commit(sessionId, {
      rows: fold.rows.map(row => ({ ...row, key: `${sessionId}#${row.key}`, session: sessionId, kind: 'turn' })),
      reset: fold.reset,
      mark: { through, fold: fold.state, sealed: sealable },
    })
  }

  // Catches every known Session up to its log. A part that ended a while ago is
  // complete, so it is sealed and never read again.
  function scan(): Promise<void> {
    if (scanning !== undefined) return scanning
    if (Date.now() - scannedAt < RESCAN_AFTER_MS) return Promise.resolve()
    const job: Promise<void> = (async () => {
      const ledger = await openLedger()
      await rt.load()
      const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS)
      try {
        listed = (await ctx.sessionController.list({}, signal)).items ?? []
      } catch (error) {
        rt.warn('moon-bot: usage could not list the Sessions: %s', error)
      }
      const stored = ledger.owners()
      const owners = liveOwners(rt, listed, stored)
      for (const [sessionId, owner] of owners) {
        const before = stored.get(sessionId)
        if (owner.name !== '' && (before?.owner !== owner.owner || before?.name !== owner.name))
          ledger.setOwner(sessionId, owner)
      }
      // Group membership vanishes with the room, but a call that happened in a
      // group chat must stay one, so the kind is remembered like the owner is.
      const storedKinds = ledger.kinds()
      for (const sessionId of inGroup(rt))
        if (storedKinds.get(sessionId) !== 'group') ledger.setKind(sessionId, 'group')
      const ended = new Set<string>()
      const longAgo = Date.now() - SEAL_AFTER_MS
      for (const bot of Object.values(rt.state.bots))
        for (const segment of bot.segments ?? [])
          if (segment.endedAt !== undefined && segment.endedAt < longAgo) ended.add(segment.sessionId)
      for (const room of Object.values(rt.state.rooms)) {
        for (const segments of Object.values(room.segments ?? {}))
          for (const segment of segments)
            if (segment.endedAt !== undefined && segment.endedAt < longAgo) ended.add(segment.sessionId)
      }
      // A listing row's projections are hints, not cursors. Only a 'sequenced'
      // block shares the Session log's sequence space; a 'cached' block carries
      // the persisted cache's own watermark, so it must not cut a page. The
      // Session's exact cursor is read below when no hint is usable.
      const listedCursor = (item: SessionListEntry): number | undefined =>
        item.projections?.kind === 'sequenced' ? item.projections.asOfSeq : undefined
      const targets = new Map<string, number | undefined>()
      for (const item of listed) if (item.blank !== true) targets.set(item.sessionId, listedCursor(item))
      for (const sessionId of owners.keys()) if (!targets.has(sessionId)) targets.set(sessionId, undefined)
      const addresses = new Map<string, SessionAddress | undefined>(
        listed.map((item): [string, SessionAddress | undefined] => [item.sessionId, addressOf(item)]),
      )
      await eachLimited([...targets], SCAN_PARALLEL, async ([sessionId, asOfSeq]) => {
        const address: SessionAddress | undefined = addresses.has(sessionId)
          ? addresses.get(sessionId)
          : { kind: 'session', sessionId }
        if (address === undefined) return
        try {
          await scanSession(ledger, address, asOfSeq, ended.has(sessionId), signal)
          unreadable.delete(sessionId)
        } catch (error) {
          if (unreadable.has(sessionId)) return
          unreadable.add(sessionId)
          rt.warn('moon-bot: usage could not read %s: %s', sessionId, error)
        }
      })
    })().finally(() => {
      scannedAt = Date.now()
      scanning = undefined
    })
    scanning = job
    return job
  }

  // Tokens per hour, owner, model, and use, for the browser to sum by day, week, or month.
  async function view(options: UsageViewOptions = {}): Promise<UsageView> {
    const job = scan().catch(error => rt.warn('moon-bot: usage scan failed: %s', error))
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      job,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, VIEW_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
    const ledger = await openLedger()
    const stored = ledger.owners()
    const live = liveOwners(rt, listed, stored)
    const hourOf = hourKeys(typeof options.timeZone === 'string' ? options.timeZone : undefined)
    // A deleted Bot or group keeps the name it had when its calls were last read.
    const describe = (key: string, name: string): UsageOwner => {
      if (key === 'other') return { key, kind: 'other' }
      if (key.startsWith('room:')) {
        const id = key.slice('room:'.length)
        const room = rt.roomOf(id)
        return { key, kind: 'room', id, name: room?.name ?? name, ...(room ? {} : { deleted: true }) }
      }
      if (key.startsWith('agent:')) {
        const id = key.slice('agent:'.length)
        const agent = rt.own(rt.state.agents, id)
        return { key, kind: 'agent', id, name: agent?.name ?? name, ...(agent ? {} : { deleted: true }) }
      }
      const bot = rt.botOf(key)
      return { key, kind: 'bot', id: key, name: bot?.name ?? name, ...(bot ? {} : { deleted: true }) }
    }
    const owners: UsageOwner[] = []
    const ownerIndex = new Map<string, number>()
    const ownerOf = (sessionId: string): number => {
      const found = live.get(sessionId) ?? stored.get(sessionId)
      const key = found?.owner ?? 'other'
      const known = ownerIndex.get(key)
      if (known !== undefined) return known
      const index = owners.length
      ownerIndex.set(key, index)
      owners.push(describe(key, found?.name ?? ''))
      return index
    }
    const catalog = rt.cachedCatalog()
    const models: UsageModel[] = []
    const modelIndex = new Map<string, number>()
    const modelOf = (provider: string, model: string): number => {
      const key = `${provider}/${model}`
      const known = modelIndex.get(key)
      if (known !== undefined) return known
      const index = models.length
      modelIndex.set(key, index)
      const entry = catalog.find(item => item.ref === key)
      models.push({
        key,
        provider,
        model,
        name: entry?.name ?? model,
        ...(entry?.providerName ? { providerName: entry.providerName } : {}),
      })
      return index
    }
    const kinds: string[] = []
    const kindIndex = new Map<string, number>()
    const kindOf = (kind: string): number => {
      const known = kindIndex.get(kind)
      if (known !== undefined) return known
      const index = kinds.length
      kindIndex.set(kind, index)
      kinds.push(kind)
      return index
    }
    const groupSessions = inGroup(rt)
    const buckets = new Map<string, UsageRow>()
    const storedKinds = ledger.kinds()
    for (const group of ledger.groups()) {
      const kind =
        group.kind === 'turn'
          ? groupSessions.has(group.session) || storedKinds.get(group.session) === 'group'
            ? 'group'
            : 'chat'
          : group.kind
      const row: [string, number, number, number] = [
        hourOf(group.slot * SLOT_MS),
        ownerOf(group.session),
        modelOf(group.provider, group.model),
        kindOf(kind),
      ]
      const id = row.join('\n')
      const bucket: UsageRow = buckets.get(id) ?? [row[0], row[1], row[2], row[3], 0, 0, 0, 0, 0]
      bucket[4] += group.input
      bucket[5] += group.cacheRead
      bucket[6] += group.cacheWrite
      bucket[7] += group.output
      bucket[8] += group.calls
      buckets.set(id, bucket)
    }
    return {
      owners,
      models,
      kinds,
      rows: [...buckets.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      now: hourOf(Date.now()),
      scanning: scanning !== undefined,
    }
  }

  return { view, sessions: () => listed }
}

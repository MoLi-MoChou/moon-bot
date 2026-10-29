import { clearTimeout, setTimeout } from 'node:timers'
import type { SessionEvent } from './host-types.js'
import type { DeliveryInput, HostRuntime, TurnInfo } from './runtime.js'
import { deliverResume, tellCut } from './resume-continue.ts'
import { recoveryOf, type ResumeTrigger, type TurnNote } from './resume-recovery.ts'

/** A delivery a turn has not taken up yet. */
interface QueuedNote {
  readonly at: number
  readonly args: DeliveryInput
}

interface ResumeNotes {
  turns: Record<string, TurnNote>
  queued: Record<string, QueuedNote[]>
  settling: Record<string, TurnNote>
  parked: Record<string, TurnNote>
}

interface InboxDiscardEvent {
  readonly message?: { readonly source?: { readonly kind?: unknown; readonly exchangeId?: unknown } }
}

// A restart used to run an unfinished turn again. It now settles the note, reconciles it
// with what this process can already see, and records that the turn was cut off. The
// model prompt is sent only when the user continues. Deliveries no turn took up are
// still sent once: they had not started.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SOURCE_KIND } from './constants.ts'

// Long enough for the host to finish opening sessions after a start.
export const RESUME_DELAY_MS = 3000
// A delivery waiting longer than this was not lost to a restart.
const QUEUED_KEPT_MS = 24 * 60 * 60 * 1000
const QUEUED_MAX = 50

// The trigger fields a continued turn needs to answer the same sender.
const triggerOf = (info: TurnInfo): ResumeTrigger => ({
  role: info.role,
  ...(info.exchangeId ? { exchangeId: info.exchangeId } : {}),
  ...(info.senderSessionId ? { senderSessionId: info.senderSessionId } : {}),
  ...(info.roomId ? { roomId: info.roomId } : {}),
  ...(info.work ? { work: info.work } : {}),
  ...(info.audience ? { audience: info.audience } : {}),
  ...(info.askedBy ? { askedBy: info.askedBy } : {}),
  ...(info.senderRoomId ? { senderRoomId: info.senderRoomId } : {}),
})

const readNotes = (file: string): ResumeNotes => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const source = parsed as { readonly turns?: unknown; readonly queued?: unknown; readonly settling?: unknown; readonly parked?: unknown } | undefined
    const object = (value: unknown): Record<string, never> | Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
    return {
      turns: object(source?.turns) as Record<string, TurnNote>,
      queued: object(source?.queued) as Record<string, QueuedNote[]>,
      settling: object(source?.settling) as Record<string, TurnNote>,
      parked: object(source?.parked) as Record<string, TurnNote>,
    }
  } catch {
    return { turns: {}, queued: {}, settling: {}, parked: {} }
  }
}

export function install(rt: HostRuntime): void {
  const { ctx, home } = rt
  const file = join(home, 'inflight.json')

  // What the last run left; read before this run notes anything.
  let interrupted = readNotes(file)

  let turns: Record<string, TurnNote> = {}
  // Deliveries no turn has taken up, by Session.
  let queued: Record<string, QueuedNote[]> = {}
  const writable = rt.readOnly() === undefined
  // Old turns leave `turns` immediately so a crash cannot auto-run them. Reconcile
  // still sees them in `settling`.
  let settling: Record<string, TurnNote> = writable ? { ...interrupted.settling, ...interrupted.turns } : { ...interrupted.settling }
  let parked: Record<string, TurnNote> = { ...interrupted.parked }
  let heldQueued: Record<string, QueuedNote[]> | undefined = Object.keys(interrupted.queued).length > 0 ? interrupted.queued : undefined
  let writing: Promise<unknown> = Promise.resolve()
  let stopped = false
  let latest: string | undefined
  let due = false
  const queuedSnapshot = (): Record<string, QueuedNote[]> => {
    if (heldQueued === undefined) return queued
    const merged: Record<string, QueuedNote[]> = { ...heldQueued }
    for (const [id, list] of Object.entries(queued)) merged[id] = [...(merged[id] ?? []), ...list].slice(-QUEUED_MAX)
    return merged
  }
  const persist = () => {
    // Only the host that saves the team writes the notes.
    if (stopped || rt.readOnly() !== undefined) return
    latest = JSON.stringify({ turns, queued: queuedSnapshot(), settling, parked })
    // One write waits at a time and takes the latest notes, so a busy round does not
    // write the file once per change.
    if (due) return
    due = true
    // Written in place: a rename over the file fails on Windows while anything reads
    // it, and a torn write only loses what one restart would pick up.
    writing = writing.then(async () => {
      due = false
      const snapshot = latest
      if (snapshot === undefined) return
      await mkdir(home, { recursive: true })
      await writeFile(file, snapshot, 'utf8')
    }).catch(error => rt.warn('moon-bot: noting running turns failed: %s', error))
  }
  if (writable && Object.keys(interrupted.turns).length > 0) persist()
  const update = (id: string, change: (record: TurnNote | undefined) => TurnNote | undefined): void => {
    const next = change(turns[id])
    if (next === turns[id]) return
    turns = { ...turns }
    if (next === undefined) delete turns[id]
    else turns[id] = next
    persist()
  }
  const forgetQueued = (exchangeId: string): void => {
    for (const [sessionId, list] of Object.entries(queued)) {
      const at = list.findIndex(item => item.args.exchangeId === exchangeId)
      if (at === -1) continue
      const rest = [...list.slice(0, at), ...list.slice(at + 1)]
      queued = { ...queued }
      if (rest.length === 0) delete queued[sessionId]
      else queued[sessionId] = rest
      persist()
      return
    }
  }

  const deliver = rt.deliver.bind(rt)
  rt.deliver = async (args: DeliveryInput): Promise<string> => {
    const noted: DeliveryInput = { ...args, exchangeId: args.exchangeId ?? randomUUID() }
    const sessionId = noted.sessionId ?? rt.chatOf(noted.toId)
    // Noted before it is sent: a turn may take it up before the send returns.
    queued = { ...queued, [sessionId]: [...(queued[sessionId] ?? []), { at: Date.now(), args: noted }].slice(-QUEUED_MAX) }
    persist()
    try {
      return await deliver(noted)
    } catch (error) {
      forgetQueued(noted.exchangeId ?? '')
      throw error
    }
  }

  // What a Session was sent and no turn has read yet.
  rt.unreadOf = (sessionId: string) => (queued[sessionId] ?? []).map(item => item.args)
  rt.forgetDelivery = forgetQueued

  // A message is done with once a turn takes it up, or once it leaves the inbox untaken
  // while DS Bot runs: the user stopped the Bot, or DS Bot moved or withdrew it.
  ctx.on<InboxDiscardEvent>('agent/inbox/discarded', ({ message } = {}) => {
    const source = message?.source
    if (source?.kind === SOURCE_KIND && typeof source.exchangeId === 'string') forgetQueued(source.exchangeId)
  })
  // Exchanges a turn took up since this start, until the resends are done, so a resend
  // never repeats one.
  let taken: Set<string> | undefined = Object.keys(interrupted.queued).length > 0 ? new Set<string>() : undefined
  // The first turn event of each Session since this start, until the noted turns are
  // picked up. A turn that ends, or still runs, before one starts here outlived the
  // last run: only DS Bot restarted (the plugin reloaded) and the host went on.
  let firstTurn: Map<string, string> | undefined = Object.keys(settling).length > 0 ? new Map<string, string>() : undefined
  ctx.on<{ readonly id?: string }, SessionEvent>('session/event', (session, event) => {
    const id = session?.id
    if (id === undefined) return
    if ((event.type === 'turn/start' || event.type === 'turn/end') && firstTurn?.has(id) === false) firstTurn.set(id, event.type)
    const dataSource = event.data?.source
    if (event.type === 'user/message' && dataSource?.kind === SOURCE_KIND && typeof dataSource.exchangeId === 'string') {
      taken?.add(dataSource.exchangeId)
      forgetQueued(dataSource.exchangeId)
    }
    if (!rt.isBotSession(id)) return
    switch (event.type) {
      case 'turn/start': {
        const owner = rt.groupOwners.get(id)
        const botId = owner?.botId ?? rt.chatOwners.get(id)
        update(id, () => ({ botId, ...(owner ? { roomId: owner.roomId } : {}), since: event.time ?? Date.now() }))
        break
      }
      case 'user/message': {
        if (dataSource?.kind !== SOURCE_KIND) break
        // turns.js, installed earlier, has already claimed the turn's trigger.
        const info = rt.live.get(id)?.info
        update(id, record => (record === undefined || record.trigger !== undefined || info === undefined ? record
          : { ...record, trigger: triggerOf(info), ...(info.resumed ? { resumed: true } : {}) }))
        break
      }
      case 'turn/end': {
        // the host stops every turn as it shuts down; that one is picked up at the next start.
        const reason = event.data?.reason as { readonly kind?: string; readonly reason?: { readonly kind?: string } } | undefined
        if (reason?.kind === 'aborted' && reason.reason?.kind === 'disposed') break
        update(id, () => undefined)
        break
      }
    }
  })

  // An approval the restart drops is named when the turn is picked up.
  rt.noteApproval = (sessionId: string | undefined, approval): void => { if (sessionId === undefined) return; update(sessionId, record => (record === undefined ? record
    : approval === undefined ? (({ approval: _, ...rest }) => rest)(record) : { ...record, approval })) }

  // A hard stop keeps the inbox, which the Session runs once it wakes; only what was
  // cancelled is sent again.
  async function resendQueued(sessionId: string, list: readonly QueuedNote[]): Promise<void> {
    // A Session that moved on to a new part since is reached at its current one.
    const current = (args: DeliveryInput): string | undefined => {
      if (rt.isBotSession(sessionId)) return sessionId
      return args.roomId === undefined ? rt.chatOf(args.toId) : rt.roomOf(args.roomId)?.sessions?.[args.toId]
    }
    const fresh = list.filter(item => Date.now() - item.at < QUEUED_KEPT_MS && rt.botOf(item.args?.toId) !== undefined
      && current(item.args) !== undefined && (item.args.exchangeId === undefined || taken?.has(item.args.exchangeId) !== true))
    if (fresh.length === 0) return
    const firstFresh = fresh[0]
    if (firstFresh === undefined) return
    const target = current(firstFresh.args)
    if (target === undefined) return
    const agent = await rt.resolveAgent(target)
    const waiting = new Set([...(agent.inbox?.nextStep ?? []), ...(agent.inbox?.nextTurn ?? [])].map(message => message.source?.exchangeId))
    for (const { args } of fresh) {
      const exchangeId = args.exchangeId
      if (exchangeId === undefined || waiting.has(exchangeId) || taken?.has(exchangeId) === true) continue
      await rt.deliver({ ...args, sessionId: current(args), steer: false, resent: true })
    }
  }

  async function resumeAll(): Promise<void> {
    await rt.load()
    if (rt.readOnly() !== undefined) return
    const noted = settling
    const dropped = interrupted.queued
    settling = {}
    heldQueued = undefined
    interrupted = { turns: {}, queued: {}, settling: {}, parked }
    // The batch is no longer "will auto-run". Reconcile decides keep, park, or drop.
    persist()
    for (const [sessionId, record] of Object.entries(noted)) {
      const raw = firstTurn?.get(sessionId)
      const fact = raw === 'turn/end' || raw === 'turn/start' ? raw : undefined
      const running = fact === undefined && (await rt.resolveAgent(sessionId).catch(() => undefined))?.status === 'running'
      const decision = recoveryOf(fact, running, record.resumed === true)
      if (decision === 'keep') update(sessionId, () => record)
      else if (decision === 'park') {
        parked = { ...parked, [sessionId]: record }
        persist()
        await tellCut(rt, record).catch(error => rt.warn('moon-bot: noting a cut-off turn failed: %s', error))
      } else if (decision === 'stop') await tellCut(rt, record).catch(error => rt.warn('moon-bot: noting a cut-off turn failed: %s', error))
    }
    firstTurn = undefined
    for (const [sessionId, list] of Object.entries(dropped)) {
      if (!Array.isArray(list)) continue
      await resendQueued(sessionId, list).catch(error => rt.warn('moon-bot: sending again what %s was sent failed: %s', sessionId, error))
    }
    taken = undefined
  }

  const parkedTurns = (): readonly { readonly sessionId: string; readonly botId: string; readonly roomId?: string }[] => Object.entries(parked).flatMap(([sessionId, record]) => (
    record.resumed === true || record.botId === undefined || record.botId === '' ? [] : [{ sessionId, botId: record.botId, ...(record.roomId === undefined ? {} : { roomId: record.roomId }) }]
  ))

  async function continueParked(sessionId: string): Promise<boolean> {
    if (rt.readOnly() !== undefined) return false
    const record = parked[sessionId]
    const bot = rt.botOf(record?.botId)
    if (record === undefined || record.resumed === true || bot === undefined) return false
    if (record.roomId !== undefined) {
      const room = rt.roomOf(record.roomId)
      if (room === undefined || !(room.members?.includes(bot.id) ?? false)) return false
    }
    await deliverResume(rt, sessionId, record)
    parked = { ...parked }
    delete parked[sessionId]
    persist()
    return true
  }

  Object.assign(rt, { parkedTurns, continueParked })

  ctx.effect(() => {
    const pending = Object.keys(settling).length > 0 || Object.keys(interrupted.queued).length > 0 || Object.keys(interrupted.turns).length > 0
    const timer = pending ? setTimeout(() => void resumeAll().catch(error => rt.warn('moon-bot: picking up interrupted work failed: %s', error)), RESUME_DELAY_MS) : undefined
    timer?.unref?.()
    // What the turns stopped by this shutdown left stays as last noted.
    return () => {
      stopped = true
      clearTimeout(timer)
      return writing
    }
  }, 'moon-bot: resume interrupted turns')
}

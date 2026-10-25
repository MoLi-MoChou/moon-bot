import { clearTimeout, setTimeout } from 'node:timers'
import type { SessionEvent } from './dsh-types.js'
import type { DeliveryInput, HostRuntime, TurnInfo } from './runtime.js'

/** The trigger fields a resumed turn needs to answer the same sender. */
interface ResumeTrigger {
  readonly role?: string | undefined
  readonly exchangeId?: string | undefined
  readonly senderSessionId?: string | undefined
  readonly roomId?: string | undefined
  readonly work?: string | undefined
  readonly audience?: string | undefined
  readonly askedBy?: string | undefined
  readonly senderRoomId?: string | undefined
}

/** A running turn noted in `inflight.json`. */
interface TurnNote {
  readonly botId?: string | undefined
  readonly roomId?: string
  readonly since: number
  trigger?: ResumeTrigger
  approval?: { readonly tool: string; readonly reason: string }
  resumed?: boolean
}

/** A delivery a turn has not taken up yet. */
interface QueuedNote {
  readonly at: number
  readonly args: DeliveryInput
}

interface ResumeNotes {
  turns: Record<string, TurnNote>
  queued: Record<string, QueuedNote[]>
}

interface InboxDiscardEvent {
  readonly message?: { readonly source?: { readonly kind?: unknown; readonly exchangeId?: unknown } }
}

// Resume: Bot work that DeepSeek Harness dropped when it closed or restarted. DSH closes
// a turn it never finished as interrupted when the Session next opens, and a clean
// shutdown also cancels the messages still waiting in a Session's inbox; nothing would
// ever run either again, and whoever waited for them was not told. DS Bot notes each
// running Bot turn and each message it delivers until a turn takes it up, in
// inflight.json; what is still noted at the next start is picked up once.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SOURCE_KIND } from './constants.ts'

// Long enough for DSH to finish opening its workspaces after a start.
export const RESUME_DELAY_MS = 3000
// A delivery waiting longer than this was not lost to a restart.
const QUEUED_KEPT_MS = 24 * 60 * 60 * 1000
const QUEUED_MAX = 50

export const resumeText = (record: TurnNote): string => [
  'Moon Bot restarted while you were working on this, so your last turn stopped before it finished.',
  record.approval ? `You were waiting for the user's approval to run ${record.approval.tool || 'a tool'}${record.approval.reason ? ` (${record.approval.reason})` : ''}; that request is gone, so ask again if you still need it.` : '',
  'Check what is already done (files, commands, messages) before you repeat anything, then finish the task and give your reply.',
].filter(Boolean).join(' ')

// The trigger fields a resumed turn needs to answer the same sender.
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
    const source = parsed as { readonly turns?: unknown; readonly queued?: unknown } | undefined
    const object = (value: unknown): Record<string, never> | Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
    return { turns: object(source?.turns) as Record<string, TurnNote>, queued: object(source?.queued) as Record<string, QueuedNote[]> }
  } catch {
    return { turns: {}, queued: {} }
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
  let writing: Promise<unknown> = Promise.resolve()
  let stopped = false
  let latest: string | undefined
  let due = false
  const persist = () => {
    // Only the host that saves the team runs its work again.
    if (stopped || rt.readOnly() !== undefined) return
    latest = JSON.stringify({ turns, queued })
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
    }).catch(error => rt.warn('ds-bot: noting running turns failed: %s', error))
  }
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
  // last run: only DS Bot restarted (the plugin reloaded) and DSH went on.
  let firstTurn: Map<string, string> | undefined = Object.keys(interrupted.turns).length > 0 ? new Map<string, string>() : undefined
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
        // DSH stops every turn as it shuts down; that one is picked up at the next start.
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

  async function resumeTurn(sessionId: string, record: TurnNote): Promise<void> {
    const bot = rt.botOf(record.botId)
    if (bot === undefined) return
    const text = resumeText(record)
    if (record.roomId !== undefined) {
      const room = rt.roomOf(record.roomId)
      if (room === undefined || !(room.members?.includes(bot.id) ?? false)) return
      await rt.postToRoom(room, bot, '', { resumed: true, quiet: true, ...(record.resumed ? { again: true } : {}) })
      // A turn already picked up once and cut off again stays stopped: a restart loop
      // must not run it forever.
      if (record.resumed) return
      await rt.deliver({ toId: bot.id, sessionId: room.sessions?.[bot.id] ?? sessionId, role: 'room', roomId: room.id, note: 'picking up after a restart', resumed: true, text, ...(record.trigger?.askedBy ? { askedBy: record.trigger.askedBy } : {}) })
      return
    }
    if (record.resumed) return
    const trigger = record.trigger
    if ((trigger?.role === 'request' || trigger?.role === 'stopped') && trigger.senderSessionId && trigger.audience !== 'user' && rt.botOf(trigger.senderSessionId)) {
      // The sender still waits for this turn's answer, so it goes on under the same exchange.
      await rt.deliver({ fromId: trigger.senderSessionId, toId: bot.id, role: trigger.role, ...(trigger.exchangeId ? { exchangeId: trigger.exchangeId } : {}), ...(trigger.senderRoomId ? { fromRoomId: trigger.senderRoomId } : {}), resumed: true, text })
      return
    }
    // A turn that went on with work another Bot asked for still owes that Bot its answer.
    await rt.deliver({ toId: bot.id, role: 'resume', resumed: true, text, ...(trigger?.work ? { work: trigger.work } : {}) })
  }

  // A hard stop keeps the inbox, which the Session runs once it wakes; only what DSH
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
    const { turns: noted, queued: dropped } = interrupted
    interrupted = { turns: {}, queued: {} }
    // Taken up now, so another restart does not pick them up twice.
    persist()
    // Agents and inboxes are read before anything wakes their Sessions.
    const cut: [string, TurnNote][] = []
    for (const [sessionId, record] of Object.entries(noted)) {
      const first = firstTurn?.get(sessionId)
      if (first === 'turn/end') continue
      // Still running: noted again, as if it had started here.
      if (first === undefined && (await rt.resolveAgent(sessionId).catch(() => undefined))?.status === 'running') update(sessionId, () => record)
      else cut.push([sessionId, record])
    }
    firstTurn = undefined
    for (const [sessionId, list] of Object.entries(dropped)) {
      if (!Array.isArray(list)) continue
      await resendQueued(sessionId, list).catch(error => rt.warn('ds-bot: sending again what %s was sent failed: %s', sessionId, error))
    }
    taken = undefined
    for (const [sessionId, record] of cut) {
      await resumeTurn(sessionId, record).catch(error => rt.warn('ds-bot: picking up the turn of %s failed: %s', sessionId, error))
    }
  }

  ctx.effect(() => {
    const pending = Object.keys(interrupted.turns).length > 0 || Object.keys(interrupted.queued).length > 0
    const timer = pending ? setTimeout(() => void resumeAll().catch(error => rt.warn('ds-bot: picking up interrupted work failed: %s', error)), RESUME_DELAY_MS) : undefined
    timer?.unref?.()
    // What the turns stopped by this shutdown left stays as last noted.
    return () => {
      stopped = true
      clearTimeout(timer)
      return writing
    }
  }, 'ds-bot: resume interrupted turns')
}

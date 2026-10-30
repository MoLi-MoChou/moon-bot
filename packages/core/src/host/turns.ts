// Turns: what each Bot Session is doing now (for its mascot), which turns another Bot
// triggered, the waiters and inboxes of group rounds, and routing a finished turn's reply.
//
// The live records and their delivery bookkeeping are in `turns/delivery.ts`, the event
// routing in `turns/route.ts`, and the failure text in `turns/failure.ts`. This module
// keeps the public surface: `install`, the failure text and written-call helpers the rest
// of the host and the tests import, and the live views built from the delivery maps.
import type { ApprovalDetail } from './runtime.ts'
import type { SourceInfo, TurnEntry, TurnsRuntime } from './turns/delivery.ts'
import { answersUser, expectsReply, installCore, sourceOf } from './turns/delivery.ts'
import { installRoute } from './turns/route.ts'
import { SOURCE_KIND, TURN_SENT_STALE_MS } from './constants.ts'

export { failureLine, failureSay, turnFailure } from './turns/failure.ts'
export type { FailureText, TurnFailure } from './turns/failure.ts'
export { stripWrittenCalls, writesToolCall } from './turns/delivery.ts'
export { attachReference } from './turns/delivery.ts'

/** What the newest running call is about, in the Bot's own words. */
interface Doing {
  readonly tool?: string | undefined
  readonly said?: string | undefined
  readonly note?: string | undefined
  readonly target?: string | undefined
}

/** One Bot's live work, as the team view sends it (`shared/rpc.ts`'s `WorkBot`). */
interface WorkBotView {
  readonly since?: number | undefined
  readonly tool?: string | undefined
  readonly said?: string | undefined
  readonly note?: string | undefined
  readonly target?: string | undefined
  readonly switching?: boolean | undefined
  readonly roomId?: string | undefined
}

/** One member's live turn in a group, as the team view sends it. */
interface RoomWorkView extends Omit<WorkBotView, 'roomId'> {
  readonly botId: string
  readonly speaking?: boolean | undefined
}

/** `record`'s values read as plain objects, for JSON the caller did not type. */
const objectOf = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? value as Record<string, unknown> : {})

const firstString = (args: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.replace(/\s+/g, ' ').trim()
  }
  return undefined
}

export function install(rt: TurnsRuntime): void {
  const core = installCore(rt)
  installRoute(rt, core)

  // What the newest running call does, in its own words: what the Bot said in the step
  // that made it, the call's description, or the file, search or site it works on.
  const doingOf = (entry: TurnEntry): Doing => {
    const call = [...(entry.calls?.values() ?? [])].at(-1)
    if (call === undefined) return {}
    const said = entry.step?.replace(/\s+/g, ' ').trim().slice(0, 160)
    let args: Record<string, unknown>
    try { args = objectOf(JSON.parse(call.args || '{}')) } catch { args = {} }
    const note = firstString(args, ['description', 'justification'])
    const path = firstString(args, ['file_path', 'path'])
    const url = firstString(args, ['url'])
    let site: string | undefined
    try { site = url === undefined ? undefined : new URL(url).host } catch { site = undefined }
    const target = path?.split(/[\\/]/).filter(Boolean).at(-1) ?? firstString(args, ['query', 'pattern']) ?? site
    return { tool: call.name, ...(said ? { said } : {}), ...(note ? { note: note.slice(0, 120) } : {}), ...(target ? { target: target.slice(0, 80) } : {}) }
  }

  // Activity is tracked per Session; a Bot's mascot shows its own chat's, else a group's.
  const activityView = (): Record<string, string> => {
    const merged: Record<string, string> = {}
    for (const [id, value] of Object.entries(core.activityNow())) {
      if (!rt.groupOwners.has(id)) merged[rt.chatOwners.get(id) ?? id] = value
    }
    for (const [id, value] of Object.entries(core.activityNow())) {
      const owner = rt.groupOwners.get(id)
      if (owner !== undefined) merged[owner.botId] ??= value
    }
    // A Bot writing its handoff note is thinking.
    for (const job of rt.switchJobs?.() ?? []) {
      if (job.roomId === undefined) merged[job.botId] = 'thinking'
      else merged[job.botId] ??= 'thinking'
    }
    for (const approval of rt.approvalsView?.() ?? []) merged[approval.botId] = 'alert'
    // Waiting for work it handed on shows only while no turn of the Bot runs.
    for (const botId of Object.keys(rt.waitingView?.() ?? {})) merged[botId] ??= 'waiting'
    return merged
  }

  // A message the chat accepted but whose turn has not started counts as work too, so the
  // window shows the Bot working from the send on, not from the engine's first event.
  const sinceOf = (entry: TurnEntry): number | undefined => {
    if (entry.turn !== undefined) return entry.since
    if (entry.sentAt !== undefined && Date.now() - entry.sentAt < TURN_SENT_STALE_MS) return entry.sentAt
    return undefined
  }

  // A message the chat accepted: the Bot is working from now on, before its engine has
  // said anything. The turn's own turn/start replaces the mark; a send the engine never
  // took takes it back.
  const noteSent = (id: string, sent: boolean): void => {
    if (!rt.isBotSession(id) && !rt.roomOf(id)) return
    const entry = core.liveOf(id)
    if (sent) entry.sentAt = Date.now()
    else delete entry.sentAt
    rt.liveChanged?.()
  }

  // Per Bot, the turn it is running and what it is doing; its own chat wins over a
  // group. A Bot writing its handoff note shows that.
  const workView = (): Record<string, WorkBotView> => {
    const bots: Record<string, WorkBotView> = {}
    for (const [id, entry] of core.live) {
      const since = sinceOf(entry)
      if (since === undefined) continue
      const owner = rt.groupOwners.get(id)
      const botId = owner?.botId ?? rt.chatOwners.get(id)
      if (botId === undefined || (owner !== undefined && bots[botId] !== undefined)) continue
      bots[botId] = { since, ...doingOf(entry), ...(owner ? { roomId: owner.roomId } : {}) }
    }
    for (const job of rt.switchJobs?.() ?? []) {
      const work: WorkBotView = { since: job.since, switching: true, ...(job.roomId ? { roomId: job.roomId } : {}) }
      if (job.roomId === undefined) bots[job.botId] = work
      else bots[job.botId] ??= work
    }
    return bots
  }

  // Per Session, when its running turn began, or when the message it will run on was sent.
  const turnsView = (): Record<string, number> => {
    const view: Record<string, number> = {}
    for (const [id, entry] of core.live) {
      const since = sinceOf(entry)
      if (since !== undefined) view[id] = since
    }
    return view
  }

  // Per group, the members whose turn there is running or who move on to a fresh part;
  // the round's current speaker is marked, since its round shows it.
  const roomWorkView = (): Record<string, readonly RoomWorkView[]> => {
    const speaking = new Set([...core.roomProgress.values()].map(round => `${round.roomId}:${round.speaking}`))
    const rooms: Record<string, RoomWorkView[]> = {}
    const add = (roomId: string, botId: string, work: Omit<RoomWorkView, 'botId'>): void => {
      if (rooms[roomId]?.some(item => item.botId === botId) === true) return
      rooms[roomId] = [...(rooms[roomId] ?? []), { botId, ...work, ...(speaking.has(`${roomId}:${botId}`) ? { speaking: true } : {}) }]
    }
    for (const [id, entry] of core.live) {
      const owner = rt.groupOwners.get(id)
      if (entry.turn !== undefined && owner !== undefined) add(owner.roomId, owner.botId, { since: entry.since, ...doingOf(entry) })
    }
    for (const job of rt.switchJobs?.() ?? []) {
      if (job.roomId !== undefined) add(job.roomId, job.botId, { since: job.since, switching: true })
    }
    return rooms
  }

  // What a running tool call is about, for an approval card: its own description and
  // the command, path or address it acts on.
  const callDetail = (sessionId: string | undefined, callId?: string): ApprovalDetail => {
    const raw = sessionId === undefined || callId === undefined ? undefined : core.live.get(sessionId)?.calls?.get(callId)?.args
    let args: Record<string, unknown>
    try { args = objectOf(JSON.parse(raw ?? '{}')) } catch { args = {} }
    const first = (keys: readonly string[]): string | undefined => keys.map(key => args[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '')
    const text = first(['description', 'justification'])
    const code = first(['command', 'cmd', 'file_path', 'path', 'url', 'query'])
    return { ...(text ? { text: text.trim().slice(0, 300) } : {}), ...(code ? { code: code.trim().slice(0, 400) } : {}) }
  }

  // A stopped round stops the member work it started: the turn that answers it, or the
  // delivery still waiting for the member's Session. An earlier turn there keeps going.
  async function stopRoomTurn(sessionId: string, exchangeId: string): Promise<void> {
    core.stoppedRoomTurns.add(exchangeId)
    if (core.stoppedRoomTurns.size > 200) core.stoppedRoomTurns.delete(core.stoppedRoomTurns.values().next().value)
    const agent = await rt.resolveAgent(sessionId).catch(() => undefined)
    if (agent === undefined) return
    const entry = core.live.get(sessionId)
    if (entry?.turn !== undefined && entry.info?.exchangeId === exchangeId) {
      agent.cancel({ kind: 'hook', reason: 'moon-bot/stopped' })
      return
    }
    for (const message of [...(agent.inbox?.nextStep ?? []), ...(agent.inbox?.nextTurn ?? [])]) {
      if (sourceOf(message.source)?.exchangeId === exchangeId && agent.inbox?.remove(message.id) === true) core.stoppedRoomTurns.delete(exchangeId)
    }
  }

  // Runs before a deleted Bot leaves the team. Its Sessions stop with it, and the turn/end
  // that follows is no longer the team's, so their activity and turn records go now. Every
  // Bot still waiting for its reply hears that it was deleted: the turn's trigger, requests
  // that joined the turn, and requests it has not read yet.
  async function releaseBot(botId: string, sessionIds: readonly string[]): Promise<void> {
    const text = `${rt.botOf(botId)?.name ?? 'The other Bot'} was deleted before it could answer your message.`
    const waiting = new Map<string | undefined, readonly [string, SourceInfo]>()
    for (const id of sessionIds) {
      const entry = core.live.get(id)
      const held: (SourceInfo | undefined)[] = [entry?.info, entry?.pending, ...(entry?.joined ?? []).map(joined => joined.info)]
      if (entry?.turn !== undefined) {
        const agent = await rt.resolveAgent(id).catch(() => undefined)
        held.push(...[...(agent?.inbox?.nextStep ?? []), ...(agent?.inbox?.nextTurn ?? [])].map(message => sourceOf(message.source)))
      }
      for (const source of held) {
        if (source?.kind === SOURCE_KIND && expectsReply(source) && !answersUser(source)) waiting.set(source.exchangeId, [id, source])
      }
      core.live.delete(id)
      core.setActivity(id, undefined)
    }
    // Work it was asked for and still waits on, outside any running turn.
    for (const source of rt.forgetBotWork?.(botId) ?? []) {
      if (source === undefined) continue
      if (!waiting.has(source.exchangeId)) waiting.set(source.exchangeId, [rt.chatOf(botId), source])
    }
    for (const [id, source] of waiting.values()) core.tellSender(id, source, text)
  }

  Object.assign(rt, {
    live: core.live, liveOf: core.liveOf, roomWaiters: core.roomWaiters, roomProgress: core.roomProgress,
    roomInbox: core.roomInbox, activityView, workView, roomWorkView, turnsView, callDetail, doingOf, stopRoomTurn, releaseBot,
    noteSent,
  })
}

// The task panel's data (2026-10-28 tasks-panel): "who is working, on what, for whom,
// and for how long" — read off the turns the host already tracks, never a second state
// of its own. Running rows come from workView (the live turns) plus the works the
// handoffs module keeps, so a dispatched job shows who sent it; recently finished rows
// are a small ring this module fills from turn/end, since the host keeps no history of
// finished turns. Stopping goes through the same cancel a Main Bot's stop_bot uses.
import type { HostRuntime } from './runtime.js'

/** What this module reads off the runtime: the turn and handoff views install theirs at
 *  startup, so they are named here rather than in the shared contract. */
interface PanelRuntime extends HostRuntime {
  workView?(): Readonly<Record<string, { readonly since?: number; readonly tool?: string; readonly target?: string; readonly said?: string; readonly switching?: boolean; readonly roomId?: string }>>
  workOf?(info: unknown): string | undefined
  workAsker?(workId: string): { readonly senderSessionId?: string } | undefined
  waitingView?(): Readonly<Record<string, { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }>>
}

export interface TaskRunningView {
  readonly sessionId: string
  readonly botId: string
  readonly botName: string
  readonly since: number
  readonly roomId?: string
  readonly roomName?: string
  readonly tool?: string
  readonly target?: string
  readonly said?: string
  readonly switching?: boolean
  readonly fromName?: string
}

export interface TaskDoneView {
  readonly sessionId: string
  readonly botId: string
  readonly botName: string
  readonly startedAt: number
  readonly endedAt: number
  readonly reason: string
  readonly roomId?: string
  readonly roomName?: string
  readonly fromName?: string
}

export interface TaskWaitingView {
  readonly botId: string
  readonly botName: string
  readonly for: readonly string[]
}

export interface TasksView {
  readonly running: readonly TaskRunningView[]
  readonly completed: readonly TaskDoneView[]
  readonly waiting: readonly TaskWaitingView[]
}

/** How many finished turns the panel remembers; the store keeps the conversations. */
const DONE_KEPT = 40

export function install(rt: PanelRuntime): void {
  const done: TaskDoneView[] = []
  const started = new Map<string, number>()

  const nameOf = (botId: string | undefined): string => botId === undefined ? '' : rt.botOf(botId)?.name ?? botId
  const roomOf = (roomId: string | undefined): { readonly id: string, readonly name: string } | undefined => {
    if (roomId === undefined) return undefined
    const room = rt.roomOf(roomId)
    return room === undefined ? undefined : { id: room.id, name: room.name }
  }

  // The session a Bot works in for a room, or its own chat: workView names the Bot, and
  // the host's maps name the Session.
  const sessionOf = (botId: string, roomId: string | undefined): string => {
    if (roomId === undefined) return rt.chatOf(botId)
    for (const [sessionId, owner] of rt.groupOwners) {
      if (owner.botId === botId && owner.roomId === roomId) return sessionId
    }
    return rt.chatOf(botId)
  }

  /** Whom a turn works for, when a Bot dispatched it. */
  const askerOf = (sessionId: string): string | undefined => {
    const info = rt.live.get(sessionId)?.info
    const workId = rt.workOf?.(info)
    const asked = workId === undefined ? undefined : rt.workAsker?.(workId)
    const from = asked?.senderSessionId === undefined ? undefined : rt.selfOf(asked.senderSessionId)
    return from === undefined ? undefined : nameOf(from)
  }

  const tasksView = (): TasksView => {
    const work = rt.workView?.() ?? {}
    const running: TaskRunningView[] = Object.entries(work).map(([botId, entry]) => {
      const room = roomOf(entry.roomId)
      const sessionId = sessionOf(botId, entry.roomId)
      const fromName = askerOf(sessionId)
      return {
        sessionId, botId, botName: nameOf(botId),
        since: entry.since ?? started.get(sessionId) ?? Date.now(),
        ...(room === undefined ? {} : { roomId: room.id, roomName: room.name }),
        ...(entry.tool === undefined ? {} : { tool: entry.tool }),
        ...(entry.target === undefined ? {} : { target: entry.target }),
        ...(entry.said === undefined ? {} : { said: entry.said }),
        ...(entry.switching === true ? { switching: true } : {}),
        ...(fromName === undefined || fromName === '' ? {} : { fromName }),
      }
    }).sort((a, b) => b.since - a.since)
    const waiting: TaskWaitingView[] = Object.entries(rt.waitingView?.() ?? {}).map(([botId, entry]) => ({
      botId, botName: nameOf(botId), for: [...entry.bots, ...entry.rooms, ...entry.for].slice(0, 6),
    }))
    return { running, completed: [...done], waiting }
  }

  /** Fed by the emitter: a turn's clock, and its row once it ends. */
  const noteTurn = (sessionId: string, event: { readonly type?: string, readonly turn?: unknown, readonly reason?: unknown }): void => {
    if (event.type === 'turn/start') {
      if (!started.has(sessionId)) started.set(sessionId, Date.now())
      return
    }
    if (event.type !== 'turn/end') return
    const botId = rt.selfOf(sessionId) ?? sessionId
    const owner = rt.groupOwners.get(sessionId)
    const room = roomOf(owner?.roomId)
    const began = started.get(sessionId) ?? Date.now()
    started.delete(sessionId)
    const reason = typeof event.reason === 'string' ? event.reason : kindOf(event.reason)
    const fromName = askerOf(sessionId)
    done.unshift({
      sessionId, botId, botName: nameOf(botId), startedAt: began, endedAt: Date.now(), reason,
      ...(room === undefined ? {} : { roomId: room.id, roomName: room.name }),
      ...(fromName === undefined || fromName === '' ? {} : { fromName }),
    })
    if (done.length > DONE_KEPT) done.length = DONE_KEPT
  }

  /** The panel's stop: the same cancel a Main Bot's stop_bot uses, without the message. */
  async function stopTask(sessionId: string): Promise<boolean> {
    const agent = await (rt as unknown as { resolveAgent(sessionId: string): Promise<{ cancel(cause: { kind: string, reason?: string }): void }> }).resolveAgent(sessionId)
    if (agent === undefined) return false
    agent.cancel({ kind: 'user' })
    return true
  }

  Object.assign(rt, { tasksView, noteTurn, stopTask })
}

const kindOf = (reason: unknown): string => {
  if (reason === null || typeof reason !== 'object') return 'completed'
  const kind = (reason as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : 'completed'
}

// The Session index: which Bot or group chat a Session belongs to. A Bot speaks from its
// own chat Session and from one hidden Session per group; a long conversation moves on to
// a fresh Session, and the earlier ones stay readable as segments.
import type { StoredBot, StoredRoom, StoredState } from './runtime.js'

export interface SessionIndex {
  readonly chatOwners: Map<string, string>
  readonly groupOwners: Map<string, { readonly botId: string; readonly roomId: string }>
  readonly pastOwners: Map<string, { readonly botId: string; readonly roomId?: string }>
  indexSessions(): void
  chatOf(botId: string): string
  selfOf(id: string | undefined): string | undefined
  isBotSession(id: string): boolean
  groupSessionsOf(botId: string): readonly string[]
  dropGroupSession(room: StoredRoom, botId: string): void
  retireGroupSession(room: StoredRoom, botId: string): void
}

interface SessionIndexOptions {
  readonly state: StoredState
  botOf(botId: string | undefined): StoredBot | undefined
  /** Called once the maps are rebuilt; the agents module owns its own index. */
  onIndexed?(): void
  cancelApprovals?(sessionId: string): void
  archiveSession(sessionId: string): Promise<unknown>
}

export function createSessionIndex({
  state,
  botOf,
  onIndexed,
  cancelApprovals,
  archiveSession,
}: SessionIndexOptions): SessionIndex {
  const chatOwners = new Map<string, string>()
  const groupOwners = new Map<string, { readonly botId: string; readonly roomId: string }>()
  const pastOwners = new Map<string, { readonly botId: string; readonly roomId?: string }>()
  const chatOf = (botId: string): string => botOf(botId)?.sessionId ?? botId

  const indexSessions = (): void => {
    chatOwners.clear()
    groupOwners.clear()
    pastOwners.clear()
    for (const bot of Object.values(state.bots)) {
      for (const segment of bot.segments ?? []) pastOwners.set(segment.sessionId, { botId: bot.id })
      chatOwners.set(chatOf(bot.id), bot.id)
    }
    for (const room of Object.values(state.rooms)) {
      for (const [botId, segments] of Object.entries(room.segments ?? {})) {
        for (const segment of segments) pastOwners.set(segment.sessionId, { botId, roomId: room.id })
      }
      for (const [botId, sessionId] of Object.entries(room.sessions ?? {}))
        groupOwners.set(sessionId, { botId, roomId: room.id })
    }
    onIndexed?.()
  }
  // The Bot a Session speaks for: its own chat, one of its group Sessions, or an
  // earlier segment of either.
  const selfOf = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined
    return chatOwners.get(id) ?? groupOwners.get(id)?.botId ?? pastOwners.get(id)?.botId
  }
  // A Session where the Bot speaks now, as opposed to an archived segment.
  const isBotSession = (id: string): boolean => chatOwners.has(id) || groupOwners.has(id)
  const groupSessionsOf = (botId: string): readonly string[] =>
    Object.values(state.rooms)
      .map(room => room.sessions?.[botId])
      .filter((id): id is string => id !== undefined)
  const dropGroupSession = (room: StoredRoom, botId: string): void => {
    const sessionId = room.sessions?.[botId]
    if (sessionId === undefined) return
    if (room.sessions !== undefined) delete room.sessions[botId]
    for (const segment of room.segments?.[botId] ?? []) delete state.switching[segment.sessionId]
    if (room.segments !== undefined) delete room.segments[botId]
    delete state.switching[sessionId]
    groupOwners.delete(sessionId)
    cancelApprovals?.(sessionId)
    // A plain archive refuses a running Session, which would go on working for a group
    // that no longer has it.
    void archiveSession(sessionId).catch(() => {})
  }
  // A group Session the host can no longer open is set aside; the member's earlier parts in
  // the group stay, and its next turn there starts a new Session.
  const retireGroupSession = (room: StoredRoom, botId: string): void => {
    const sessionId = room.sessions?.[botId]
    if (sessionId === undefined) return
    if (room.sessions !== undefined) delete room.sessions[botId]
    groupOwners.delete(sessionId)
    cancelApprovals?.(sessionId)
    void archiveSession(sessionId).catch(() => {})
  }

  return {
    chatOwners,
    groupOwners,
    pastOwners,
    indexSessions,
    chatOf,
    selfOf,
    isBotSession,
    groupSessionsOf,
    dropGroupSession,
    retireGroupSession,
  }
}

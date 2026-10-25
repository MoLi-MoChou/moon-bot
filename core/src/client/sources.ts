// -------------------------------------------------------------------------
// Small observable sources for the inject `hooks` compartment.

export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T | ((previous: T) => T)): void
}

export function createSource<T>(initial: T): Source<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T | ((previous: T) => T)): void {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next
      if (resolved === value) return
      value = resolved
      // A listener may subscribe or unsubscribe as it runs, so it iterates a snapshot.
      const snapshot = [...listeners]
      for (const listener of snapshot) listener()
    },
  }
}

export interface BotLike {
  id: string
  sessionId?: string
  parts?: readonly string[]
  [key: string]: unknown
}
export interface RoomLike { id: string; [key: string]: unknown }
export interface AgentLike { id: string; sessions?: readonly string[]; [key: string]: unknown }

export const EMPTY_ROSTER = {
  revision: -1,
  mainBotId: null,
  mainBotIds: [] as string[],
  bots: [] as BotLike[],
  rooms: [] as RoomLike[],
  agents: [] as AgentLike[],
  exchangeTurns: {} as Record<string, number[]>,
  questions: {} as Record<string, unknown>,
  secrets: [] as unknown[],
  capabilities: [] as unknown[],
  capabilityStatuses: {} as Record<string, unknown>,
  secretRequests: {} as Record<string, unknown>,
  models: [] as unknown[],
  defaultModel: null,
  modelsKey: null,
  prefs: {} as Record<string, unknown>,
  byId: {} as Record<string, BotLike>,
  roomsById: {} as Record<string, RoomLike>,
  agentsById: {} as Record<string, AgentLike>,
  agentOf: {} as Record<string, string>,
  ready: false,
}
export type Roster = typeof EMPTY_ROSTER

// Any Main Bot holds the Main Bot powers; `mainBotId`, the first one, is the sidebar tile.
export const isMainOf = (roster: { mainBotIds?: readonly string[] }, id: string | undefined): boolean => id !== undefined && (roster.mainBotIds ?? []).includes(id)

// A Bot's chat is a chain of Sessions ("parts"): the Bot id is its first part's id
// and `sessionId` its current one. Every part id finds the Bot; Session state
// (running, unread, turns) is read from the current part, team state from the Bot id.
export function indexRoster(value: {
  bots: BotLike[]
  rooms: RoomLike[]
  agents?: AgentLike[]
  [key: string]: unknown
}): Roster & { ready: true } {
  const byId: Record<string, BotLike> = {}
  for (const bot of value.bots) {
    for (const id of [...(bot.parts ?? []), bot.sessionId ?? bot.id, bot.id]) byId[id] = bot
  }
  const roomsById: Record<string, RoomLike> = {}
  for (const room of value.rooms) roomsById[room.id] = room
  // The DSH Agent is not a Bot: it indexes by its own id and by each Session it owns.
  const agentsById: Record<string, AgentLike> = {}
  const agentOf: Record<string, string> = {}
  for (const agent of value.agents ?? []) {
    agentsById[agent.id] = agent
    for (const sessionId of agent.sessions ?? []) agentOf[sessionId] = agent.id
  }
  return { ...value, agents: value.agents ?? [], byId, roomsById, agentsById, agentOf, ready: true } as Roster & { ready: true }
}

// Whether a main-view Session id belongs to the team's DSH Agent: the conversation
// group then stays withdrawn while the shell keeps the sidebar. Before the roster
// arrives, the ids cached from the last pull answer.
export function isAgentSession(roster: { ready?: boolean; agentOf?: Record<string, string> }, cache: { has: (id: string) => boolean }, sessionId: string | undefined | null): boolean {
  if (sessionId === undefined || sessionId === null || sessionId === '') return false
  if (roster.ready === true) return roster.agentOf?.[sessionId] !== undefined
  return cache.has(sessionId)
}

// A request can reuse a call id; question and secret ids belong to separate kinds.
export const heldCardKey = (kind: string, requestId: string): string => JSON.stringify([kind, requestId])

// Per Session, how many mounted cells draw or hold each card; 0 drops the entry.
export function countCards(state: Record<string, Record<string, number>>, sessionId: string, callIds: readonly string[], delta: number): Record<string, Record<string, number>> {
  const own = { ...state[sessionId] }
  for (const callId of callIds) {
    const count = (own[callId] ?? 0) + delta
    if (count > 0) own[callId] = count
    else delete own[callId]
  }
  return { ...state, [sessionId]: own }
}

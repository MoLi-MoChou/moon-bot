// The team state the client stores, and the shapes its sources and views read from it.
//
// These are types only, plus the empty roster a window starts with; keeping them beside
// `client-boot.ts` rather than inside it leaves the boot file to the wiring it does.

import type { BotBrowsers, BrowserPages, BrowserTabsMap } from './features/browser/index.ts'
import type { DshState } from './dsh-offer.ts'
import type { ReactionMap, SharedMap } from './shared-map.ts'
import type { Source } from './sources.ts'
import type { SurfaceMode } from './surface.ts'
import type { UiState } from './team-actions.ts'

// ---------------------------------------------------------------------------
// The shapes the team state answers with

// A Bot's row as the team state sends it: the id and name every view reads, and the
// rest passed through for the panel that owns it.
export interface ClientBot {
  readonly id: string
  readonly name: string
  readonly sessionId?: string
  readonly parts?: readonly string[]
  readonly role?: string
  readonly createdBy?: string
  readonly createdAt?: number
  readonly [key: string]: unknown
}
export interface ClientRoom {
  readonly id: string
  readonly name: string
  readonly members: readonly string[]
  readonly parts?: readonly string[]
  readonly createdBy?: string
  readonly createdAt?: number
  readonly [key: string]: unknown
}
export interface ClientAgent {
  readonly id: string
  readonly sessions?: readonly string[]
  readonly [key: string]: unknown
}

// The indexed team state. `byId` maps every part of a Bot's chat to the Bot, so a
// Session id and the Bot id both find it, as `indexRoster` builds it.
export interface ClientRosterSnapshot {
  revision: number
  mainBotId: string | null
  mainBotIds: string[]
  bots: ClientBot[]
  rooms: ClientRoom[]
  agents: ClientAgent[]
  exchangeTurns: Record<string, number[]>
  questions: Record<string, unknown>
  secrets: unknown[]
  capabilities: unknown[]
  capabilityStatuses: Record<string, unknown>
  secretRequests: Record<string, unknown>
  models: unknown[]
  defaultModel: unknown
  modelsKey: string | null
  prefs: Record<string, unknown>
  byId: Record<string, ClientBot | undefined>
  roomsById: Record<string, ClientRoom | undefined>
  agentsById: Record<string, ClientAgent | undefined>
  agentOf: Record<string, string>
  ready: boolean
  browser?: boolean | undefined
  connectors?: unknown
  [key: string]: unknown
}

// One latest memory change, and when this window first showed it: 0 means it was already
// there when the window opened, which is no news.
export interface MemoryNews {
  at?: number
  seen?: number | undefined
  [key: string]: unknown
}
// The approvals waiting for the user, and the turn each Bot runs.
export interface ClientApproval {
  id: string
  botId: string
  at?: number
  tool?: string
  roomId?: string
  sessionId?: string
}
export interface ClientWork {
  bots: Record<string, unknown>
  approvals: ClientApproval[]
  rooms?: Record<string, unknown> | undefined
  waiting?: Record<string, unknown> | undefined
  [key: string]: unknown
}

// The surface mode, and whether the Bot-mode view holds a plain DSH Session.
export interface ClientSurface {
  mode: SurfaceMode
  plain: boolean
}

// What a visit remembers: the last time the conversation was left, and when it opened.
export interface VisitMark {
  seen?: number | null | undefined
  entered: number
}

// The window's own UI state: the shared `UiState` plus the marks and overlays this shell
// keeps beside it.
export interface ClientUiState extends UiState {
  unread?: Record<string, boolean> | undefined
  reactions?: ReactionMap | undefined
  visits?: Record<string, VisitMark> | undefined
  signIn?: number | null | undefined
  renameAgent?: string | null | undefined
  accountSeated?: boolean | undefined
}

// The stores `teamActions` keeps: exact copies of its shapes, so the sources below pass
// to it without a cast.
export interface LiveEntry {
  at?: number
  text?: string
  thinking?: boolean
  relay?: boolean
  label?: string
  state?: string
  [key: string]: unknown
}
export type LiveState = Record<string, Record<string, LiveEntry>>
export type CardsState = Record<string, Record<string, number>>
export type TurnClockState = Record<string, Record<string, Record<string, number | string | undefined>>>

// The plugin update check's answer, and the Desktop updater's beside it.
export interface UpdateDsh extends DshState {
  phase?: string
}
export interface UpdateState {
  available?: boolean
  phase?: string
  dsh?: UpdateDsh | undefined
  app?: DshAppUpdate | undefined
  [key: string]: unknown
}

// One `state` answer, before `indexRoster` adds the id maps.
export interface StateAnswer {
  revision: number
  modelsKey: string | null
  bots: ClientBot[]
  rooms: ClientRoom[]
  agents?: ClientAgent[]
  activity?: Record<string, string | undefined> | undefined
  work?: ClientWork | undefined
  memoryNews?: Record<string, MemoryNews> | undefined
  connectors?: unknown
  capabilityStatuses?: Record<string, unknown> | undefined
  unchanged?: boolean | undefined
  [key: string]: unknown
}

export interface ClientState {
  roster: Source<ClientRosterSnapshot>
  ui: Source<ClientUiState>
  surface: Source<ClientSurface>
  activity: Source<Record<string, string | undefined>>
  work: Source<ClientWork>
  live: Source<LiveState>
  cards: Source<CardsState>
  heldCards: Source<CardsState>
  turnClock: Source<TurnClockState>
  memoryNews: Source<Record<string, MemoryNews>>
  update: Source<UpdateState>
  reactionStore: SharedMap<ReactionMap>
  savedPrefs: Record<string, unknown>
  browsers: BotBrowsers | null
  browserPages: Source<BrowserPages>
  browserTabs: Source<BrowserTabsMap>
  appUpdates: DshAppUpdatesBridge | null
  pendingAdopt: Map<string, string>
  /** A navigation this plugin started: the surface effect trusts the id it lands on. */
  navigation: { expected: string | null }
  pull(full?: boolean): Promise<void>
  wakeUpdate(): void
  isAgentSessionId(id: string | null | undefined): boolean
  agentOfSession(id: string | undefined): string | undefined
  workspaceOf(sessionId: string | undefined): string | undefined
  agentSessions(agentId: string): string[]
  mainView(): string | undefined
  setPlain(plain: boolean): void
  dropPanels(): void
  writeUnread(id: string, value: boolean): void
  leaveVisits(ids: readonly string[]): void
  seenKey(id: string): string
  seenAt(): Record<string, number>
}

export const EMPTY_SNAPSHOT: ClientRosterSnapshot = {
  revision: -1,
  mainBotId: null,
  mainBotIds: [],
  bots: [],
  rooms: [],
  agents: [],
  exchangeTurns: {},
  questions: {},
  secrets: [],
  capabilities: [],
  capabilityStatuses: {},
  secretRequests: {},
  models: [],
  defaultModel: null,
  modelsKey: null,
  prefs: {},
  byId: {},
  roomsById: {},
  agentsById: {},
  agentOf: {},
  ready: false,
}

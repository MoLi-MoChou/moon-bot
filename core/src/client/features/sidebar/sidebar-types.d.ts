// The shapes the sidebar reads: the roster it lists, the Session list and status map it
// asks, the work table its rows draw from, the update state at its top right, and the
// actions it calls. Types only; nothing here runs.
//
// They sit beside sidebar.ts, as runtime.d.ts does for the host, so the component file
// stays about the list itself.
import type { MarkBot } from '../../mark.tsx'

/** A Bot as the sidebar lists it. */
export interface TSidebarBot extends MarkBot {
  readonly id: string
  name: string
  role?: string | null
  hidden?: boolean
  pinned?: boolean
  sessionId?: string
  segments?: readonly { readonly sessionId: string; readonly endedAt?: number | undefined }[]
  createdAt?: number
}

/** A group as the sidebar lists it. */
export interface TSidebarRoom {
  readonly id: string
  name: string
  members: readonly string[]
  admin?: string | null
  hidden?: boolean
  pinned?: boolean
  preview?: string
  createdAt?: number
  segments?: Record<string, readonly { readonly sessionId: string; readonly endedAt?: number | undefined }[]>
}

/** A DSH Agent row: its Sessions, newest first. */
export interface TSidebarAgent {
  readonly id: string
  readonly pinned?: boolean | undefined
  readonly sessions: readonly string[]
  readonly createdAt?: number
}

/** The roster the sidebar draws: Bots, groups, and the Agent at most one team holds. */
export interface TSidebarRoster {
  readonly bots: readonly TSidebarBot[]
  readonly rooms: readonly TSidebarRoom[]
  readonly agents?: readonly TSidebarAgent[]
  readonly byId: Record<string, TSidebarBot | undefined>
  readonly roomsById: Record<string, TSidebarRoom | undefined>
  readonly agentOf: Record<string, TSidebarAgent | undefined>
  readonly exchangeTurns: Record<string, readonly number[]>
  readonly questions?: Record<string, unknown>
  readonly mainBotId?: string
  readonly mainBotIds?: readonly string[]
  readonly readOnly?: unknown
  readonly ready?: boolean
}

/** The projection the preview line reads: a turn outline. */
export interface TSidebarProjection {
  readonly turnOutline?: readonly { readonly turn?: number; readonly response?: string; readonly prompt?: string | undefined }[]
}

/** One row of the shell's Session list. */
export interface TSidebarSessionRow {
  readonly id?: string
  readonly projectionValues?: TSidebarProjection
  readonly blank?: boolean
  readonly title?: string
  readonly displayTitle?: string
  readonly updatedAt?: number
  readonly running?: boolean
  readonly completionUnread?: boolean
  readonly pendingInteraction?: unknown
  readonly retainedBy?: { readonly mainView?: number | undefined }
}

export interface TSidebarSessionList {
  readonly projectionsBySession?: Record<string, { readonly values?: TSidebarProjection | undefined } | undefined>
  readonly ids: readonly string[]
  readonly byId: Record<string, TSidebarSessionRow | undefined>
}

/** A Session's live status: what it is doing, and whether it waits for the user. */
export interface TSidebarSessionStatus {
  readonly running?: boolean
  readonly completionUnread?: boolean
  readonly pendingInteraction?: unknown
}

/** What one Bot or group is doing right now. */
export interface TSidebarDoing {
  readonly botId?: string
  readonly roomId?: string
  readonly tool?: string | undefined
  readonly said?: string | undefined
  readonly note?: string | undefined
  readonly target?: string | undefined
  readonly switching?: boolean | undefined
  readonly since?: number | undefined
}

/** The Bots and groups a Bot waits for. */
export interface TSidebarWaits {
  readonly bots?: readonly string[]
  readonly rooms?: readonly string[]
}

/** The shell's work table. */
export interface TSidebarWork {
  readonly approvals?: readonly { readonly botId?: string; readonly roomId?: string | undefined }[]
  readonly rooms?: Record<string, readonly TSidebarDoing[]>
  readonly waiting?: Record<string, TSidebarWaits | undefined>
}

/** The shell's UI state, as far as the sidebar reads it. */
export interface TSidebarUi {
  readonly unread: Record<string, boolean | undefined>
  readonly renameAgent?: string | null
  readonly accountSeated?: boolean
  readonly mode?: string
}

/** One row of the update button's card. */
export interface TSidebarUpdateRow {
  readonly phase?: string
  readonly available?: boolean
  readonly verified?: string
  readonly installed?: string
  readonly current?: string
  readonly kind?: string
  readonly blockedBy?: string
  readonly error?: string
}

/** The plugin's update state, as the UpdateButton reads it. */
export interface TSidebarUpdate {
  readonly phase?: string
  readonly available?: boolean
  readonly latest?: string
  readonly installed?: string
  readonly current?: string
  readonly error?: string
  readonly notesUrl?: string
  readonly source?: string
  readonly app?: unknown
  readonly dsh?: TSidebarUpdateRow
}

/** What the shell's shortcut catalog offers the settings shortcut. */
export interface TSidebarShellShortcuts {
  readonly catalog: {
    getSnapshot(): readonly {
      readonly id?: string
      readonly binding?: { readonly code: string; readonly modifiers: readonly string[] }
    }[]
  }
}

/** The actions the sidebar calls. */
export interface TSidebarActions {
  openSession: (id: string) => void
  openAgent: (id: string) => void
  openAgentSession: (id: string) => void
  newAgentSession: (id: string) => Promise<unknown>
  openMenu: (menu: { kind: string; id: string; agentId?: string; x: number; y: number }) => void
  openPalette: (query?: string) => void
  openNewChat: (kind: string) => void
  toggleSidebar: () => void
  clearUnread: (id: string) => void
  endAgentRename: () => void
  renameAgentSession: (agentId: string, sessionId: string, title: string) => Promise<unknown>
  reportError: (error: unknown, where?: string) => void
  installUpdate: () => Promise<unknown>
  installDshUpdate: () => Promise<unknown>
  openAppUpdates: (version?: string) => Promise<unknown>
  selectPanel: (panel: string) => void
  setSurface: (mode: string) => void
  seatAccount: (on: boolean) => void
  openSettings: (page: string, id?: string) => void
  openConnectors: () => void
  landOn: (botId: string, last?: { readonly botId: string; readonly sessionId: string } | null) => void
  isAgentSession?: ((id: string) => boolean)
}

/** A store hook: one selected slice of a shell store, re-rendered on change. */
export type TSidebarHook<T> = <R>(select: (state: T) => R) => R

/** The retain-info hook: whether a Session is kept by one of the shell's views. */
export type TSidebarRetainHook = (id: string, select: (info: { readonly retainedBy?: { readonly mainView?: number | undefined } | undefined } | undefined) => boolean) => boolean

/** One entry of the list, before it is drawn: a Bot, a group, or the Agent. */
export type TSidebarEntry =
  | { readonly kind: 'bot'; readonly item: TSidebarBot; readonly at: number }
  | { readonly kind: 'room'; readonly item: TSidebarRoom; readonly at: number }
  | { readonly kind: 'agent'; readonly item: TSidebarAgent; readonly at: number }

/** A group row's working member, as a key the row compares. */
export interface TSidebarDoingRow {
  readonly id?: string | undefined
  readonly tool?: string | undefined
  readonly said?: string | undefined
  readonly note?: string | undefined
  readonly target?: string | undefined
  readonly switching?: boolean | undefined
}

/** The props every row takes from the sidebar. */
export interface TSidebarRowProps {
  readonly roster: TSidebarRoster
  readonly actions: TSidebarActions
  readonly useSessions: TSidebarHook<TSidebarSessionList>
  readonly useUi: TSidebarHook<TSidebarUi>
  readonly useSessionStatus: TSidebarHook<ReadonlyMap<string, TSidebarSessionStatus>>
  readonly useSessionRetainInfo: TSidebarRetainHook
  readonly useActivity: TSidebarHook<Record<string, TSidebarDoing | undefined>>
  readonly useWork: TSidebarHook<TSidebarWork>
  readonly wide: boolean
}

/** The props the shell hands the whole sidebar. */
export interface TSidebarProps extends TSidebarRowProps {
  readonly expandSidebar?: (() => void)
  readonly useRoster: TSidebarHook<TSidebarRoster>
  readonly useUpdate: TSidebarHook<TSidebarUpdate | null>
  readonly useRegistry: TSidebarHook<unknown>
}

// The shapes the details drawer reads from the roster, the action bag, and the store
// hooks the panel forwards. Kept apart from the view so `details-drawer.ts` stays
// inside the 350-line logic limit.
import type { BrowserPagesHook, BrowserTabsHook, ForwardedHook, PanelActions, PanelBot, PanelRoster } from './browser-pane.tsx'
import type { FolderMenuActions } from './folder-menu.tsx'
import type { MemoryActions } from './memory-panel.tsx'
import type { PresetCatalog } from './permission-picker.tsx'
import type { RunStatsValues, TokenUsage } from './text.ts'

// A turn outline entry as the session projections carry it.
export interface OutlineEntry { turn: number; response?: string | undefined; prompt?: string | undefined }
export interface SessionValues { turnOutline?: unknown; tokenUsage?: TokenUsage }
export interface SessionList {
  byId: Record<string, { projectionValues?: SessionValues } | undefined>
  projectionsBySession?: Record<string, { values?: SessionValues } | undefined>
}
export type SessionsHook = <T>(select: (list: SessionList) => T) => T
export type SessionStatusHook = <T>(select: (map: Map<string, { running?: boolean }>) => T) => T
export type ActivityHook = <T>(select: (map: Record<string, string | undefined>) => T) => T

export interface PermissionCatalog extends PresetCatalog { defaultPreset: string }
export interface DrawerBot extends PanelBot {
  role?: string | null
  instructions?: string | undefined
  workDir?: string | undefined
  permission?: string | undefined
  parts?: readonly string[] | undefined
}
export interface DrawerRoom {
  id: string
  name: string
  named?: boolean | undefined
  members: readonly string[]
  admin?: string | undefined
  notice?: string | undefined
  permission?: string | undefined
  parts?: readonly string[] | undefined
}
// The panel hands its own view of the action bag and the store hooks; what the drawer
// reads beyond that is present on the same objects at run time.
export interface DetailsDrawerRoster extends Omit<PanelRoster, 'byId'> {
  byId: Record<string, DrawerBot | undefined>
  roomsById?: Record<string, DrawerRoom | undefined> | undefined
  permissions?: PermissionCatalog | undefined
  exchangeTurns?: Record<string, readonly number[] | undefined> | undefined
  questions?: Record<string, unknown> | undefined
  memory?: boolean | undefined
  mainBotIds?: readonly string[] | undefined
}
export interface DetailsDrawerActions extends PanelActions, FolderMenuActions, MemoryActions {
  // The group member actions: a member turn stopped from here, and the approvals it waits on.
  stopMemberWork: (roomId: string, botId: string) => Promise<unknown>
  answerApproval: (id: string, choice: string) => Promise<unknown>
  reportError: (error: unknown, where?: string) => void
  openSettings: (page: string, id?: string | null) => void
  scheduleCreate: (input: { target: string; title: string; prompt: string; when: Record<string, unknown> }) => Promise<unknown>
  scheduleDelete: (sessionId: string, id: string) => Promise<unknown>
  updateBot: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  updateRoom: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  openSession: (id: string) => void
  runStats?: ((botId: string) => Promise<RunStatsValues>) | undefined
}
export interface DetailsDrawerProps {
  sessionId: string
  startRenaming?: boolean | undefined
  startTab?: string | undefined
  hasStrip: boolean
  roster: DetailsDrawerRoster
  actions: PanelActions
  useSessions: ForwardedHook
  useSessionStatus: ForwardedHook
  useActivity: ForwardedHook
  useWork: ForwardedHook
  useBrowserTabs: BrowserTabsHook
  useBrowserPages: BrowserPagesHook
}

// Types for the Bot browser panel.
import type { MarkBot } from './mark.tsx'
import type { PanelRect } from './bot-browsers.ts'

export type PanelView = 'details' | 'browser'

export interface PanelBot extends MarkBot {
  id: string
  name: string
}

// The pane the overlay root follows: its Session id, its view and the details tab.
export interface PanelTarget {
  id: string
  view: string
  renaming?: boolean | undefined
  tab?: string | undefined
}

export interface PanelRoster {
  byId: Record<string, PanelBot | undefined>
  browser?: boolean | undefined
}

// What the panel reads from a page; the guest also reports whether it is live.
export interface PanelPage {
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  excerpt: string
  readAt?: number | undefined
}
export type PanelPages = Record<string, PanelPage>
export interface PanelTabs {
  ids: string[]
  active: string | null
}
export type PanelTabsMap = Record<string, PanelTabs>

export type BrowserPagesHook = <T>(select: (pages: PanelPages) => T) => T
export type BrowserTabsHook = <T>(select: (tabs: PanelTabsMap) => T) => T
// Each store hook selects from its own source; the panel only hands these to the drawer.
export type ForwardedHook = (...args: never[]) => unknown

export interface PanelActions {
  openBrowser: (...args: unknown[]) => unknown
  browserNewTab: (...args: unknown[]) => unknown
  browserPick: (...args: unknown[]) => unknown
  browserEnsure: (botId: string) => void
  browserCloseTab: (botId: string, tabId: string) => Promise<void>
  browserActivate: (botId: string, tabId: string) => void
  browserShow: (tabId: string | null, box?: PanelRect | null) => Promise<void>
  browserNavigate: (tabId: string | null, input: string) => Promise<boolean>
  browserCommand: (tabId: string | null, name: string) => void
  browserFocus: (tabId: string | null) => void
  setPanelView: (view: PanelView) => void
  closePanel: () => void
  closeOverlay: () => void
}

export interface BotPanelProps {
  pane: PanelTarget
  leaving: boolean
  roster: PanelRoster
  actions: PanelActions
  useSessions: ForwardedHook
  useSessionStatus: ForwardedHook
  useActivity: ForwardedHook
  useWork: ForwardedHook
  useBrowserTabs: BrowserTabsHook
  useBrowserPages: BrowserPagesHook
}

export interface FaviconProps {
  src?: string | null
  className?: string
}

export interface PanelStripProps {
  bot: PanelBot
  subject: string
  view: PanelView
  ids: readonly string[]
  active: string | null
  reading: boolean
  onView: (view: PanelView) => void
  actions: PanelActions
  useBrowserPages: BrowserPagesHook
}

export interface BrowserViewProps {
  bot: PanelBot
  tabId: string | null
  leaving: boolean
  landed: boolean
  actions: PanelActions
  useBrowserPages: BrowserPagesHook
}


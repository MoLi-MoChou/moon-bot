// Browser tab / page types shared by the Bot browser host and panel.
import type { Source } from './sources.ts'
export interface BrowserPage {
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  live: boolean
  excerpt: string
  readAt?: number | undefined
}
export type BrowserPages = Record<string, BrowserPage>

// The tabs of one Bot: their ids in strip order and the shown one.
export interface BrowserTabs {
  ids: string[]
  active: string | null
}
export type BrowserTabsMap = Record<string, BrowserTabs>

// The rectangle a shown guest covers, in viewport pixels.
export interface PanelRect {
  left: number
  top: number
  width: number
  height: number
}

// The reader's result, from `read-page.ts` running inside the guest.
export interface BrowserReadItem {
  role: string
  href?: string
  value?: string
  checked?: boolean
  disabled?: boolean
}
export interface BrowserRead {
  url: string
  title: string
  lang: string
  description: string
  selection: string
  format: string
  text: string
  items: readonly BrowserReadItem[]
  stats: { nodes: number; frames: number; ms: number }
  truncated?: string
}

// A read the host hands this window: it answers with `browser-result`.
export interface BrowserReadRequest {
  id: string
  botId: string
}
export type BrowserReadAnswer =
  | { id: string; ok: true; page: BrowserRead }
  | { id: string; ok: false; error: string }

export interface SavedTab { id: string; url: string; title: string }
export interface SavedBot { tabs: SavedTab[]; active: string | null }
export type SavedBots = Record<string, SavedBot>

export interface GuestEntry {
  botId: string
  tabId: string
  element: WebviewElement
  lease: string
  ready: boolean
  fresh: boolean
  pending: string | undefined
  usedAt: number
  stop: () => void
}

export interface CreateBotBrowsersOptions {
  bridge: DshBrowserBridge
  createSource: <T>(initial: T) => Source<T>
  storage?: Storage | undefined
  document?: Document | undefined
}

export interface BotBrowsers {
  tabs: Source<BrowserTabsMap>
  pages: Source<BrowserPages>
  /** Restore a Bot's saved strip (or an empty one) so the panel can render it. */
  ensureTabs(botId: string): void
  openTab(botId: string, url?: string): string
  closeTab(botId: string, tabId: string): Promise<void>
  activate(botId: string, tabId: string): void
  preview(tabId: string): Promise<boolean>
  show(tabId: string | null, box?: PanelRect | null): Promise<void>
  navigate(tabId: string, input: string): Promise<boolean>
  command(tabId: string, name: string): void
  focus(tabId: string): void
  /** Pages a read can reach: each Bot's active tab, live and showing a document. */
  openPages(): Record<string, { url: string; title: string }>
  /** A Bot's read reaches its active tab. */
  read(botId: string): Promise<BrowserRead>
  noteRead(botId: string): void
  release(tabId: string): Promise<void>
  forget(botId: string): Promise<void>
  /** Forget every Bot outside `botIds`, as when Bots were deleted from another window. */
  retain(botIds: readonly string[]): Promise<unknown>
  dispose(): void
}


// Width and timing constants for the Bot browser panel.
import { STORAGE } from '../../storage.ts'
import { PANEL_LINGER_MS, PANEL_TAB_EDGES } from '../../motion.tsx'
import type { PanelPage, PanelTabs } from './browser-pane-types.ts'

export { PANEL_LINGER_MS }
export const WIDTH_KEY = STORAGE.browserWidth
// One width for the panel, shared by both views. The Bot page keeps it within
// DETAILS_WIDTH..DETAILS_MAX, so a wider browser comes back to DETAILS_MAX and a
// narrower one keeps its width; the browser takes any width from MIN_WIDTH.
export const DEFAULT_WIDTH = 520
export const DETAILS_WIDTH = 320
export const DETAILS_MAX = 520
export const MIN_WIDTH = 360
// The conversation keeps at least this much room beside the panel.
export const MIN_CHAT = 420
// How long the Bot's mark shows that it read the page.
export const READ_FLASH_MS = 2400
export const EMPTY_PAGE: PanelPage = { url: '', title: '', favicon: null, loading: false, canGoBack: false, canGoForward: false, error: null, excerpt: '' }
export const EMPTY_TABS: PanelTabs = { ids: [], active: null }
// The indicator's leading edge runs the fast spring, the trailing one the slow
// spring — the capsule stretches into the move, then settles.
export const { lead: SPRING_LEAD, trail: SPRING_TRAIL } = PANEL_TAB_EDGES
// The entries that open the browser view from another surface; each takes its own
// arguments, so the panel only wraps them.
export const OPEN_ENTRIES = ['openBrowser', 'browserNewTab', 'browserPick'] as const


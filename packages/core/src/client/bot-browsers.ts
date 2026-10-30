// Bot browsers in the Desktop app: per Bot, a tab strip of pages.
export { READ_PAGE_SCRIPT } from './read-page.ts'
export type {
  BotBrowsers,
  BrowserPage,
  BrowserPages,
  BrowserRead,
  BrowserReadItem,
  BrowserReadRequest,
  BrowserReadAnswer,
  BrowserTabs,
  BrowserTabsMap,
  CreateBotBrowsersOptions,
  PanelRect,
} from './bot-browsers-types.ts'
export { PREVIEW_SCRIPT, blockedAddress, browserAddress } from './bot-browsers-address.ts'
export { serveBrowserReads } from './bot-browsers-serve.ts'
export type { ServeBrowserReadsOptions } from './bot-browsers-serve.ts'
export { createBotBrowsers } from './bot-browsers-create.ts'

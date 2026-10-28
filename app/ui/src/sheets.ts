// Every style sheet the Bot views ship, in the groups the plugin host installs them in
// (core/src/client/index.ts). The window loads no host bundles, so this list is the one
// place a sheet can be forgotten; a test compares it against the plugin's own list.
import { ABOUT_CSS } from '../../../core/src/client/about.tsx'
import { BOT_SETTINGS_CSS } from '../../../core/src/client/bot-settings.tsx'
import { BROWSER_CSS } from '../../../core/src/client/browser-pane-css.ts'
import { WELCOME_CSS } from '../../../core/src/client/chat-welcome.tsx'
import { EMPTY_STATE_CSS } from '../../../core/src/client/empty-state.tsx'
import { ENGINE_CSS } from '../../../core/src/client/engine-menu.tsx'
import { FEEDBACK_CSS } from '../../../core/src/client/feedback.tsx'
import { FILES_PANEL_CSS } from '../../../core/src/client/files-panel.ts'
import { FOLDER_CSS } from '../../../core/src/client/folder-menu.tsx'
import { MARKET_CSS } from '../../../core/src/client/connector-market.tsx'
import { RELAY_PAGE_CSS } from '../../../core/src/client/relay-page.tsx'
import { TASKS_CSS } from '../../../core/src/client/tasks-page.tsx'
import { GROUP_SETTINGS_CSS } from '../../../core/src/client/group-settings.tsx'
import { MEMBER_CSS } from '../../../core/src/client/member-status.tsx'
import { MENTION_CHIPS_CSS } from '../../../core/src/client/mention-chips.tsx'
import { MODEL_CSS } from '../../../core/src/client/model-menu-css.ts'
import { PROVIDERS_CSS } from '../../../core/src/client/providers-page.tsx'
import { RETRY_CSS } from '../../../core/src/client/retry-cell.tsx'
import { SCHEDULE_CSS } from '../../../core/src/client/schedules.tsx'
import { SECRET_CSS } from '../../../core/src/client/secret-card-css.ts'
import { RETURN_CSS, SIDEBAR_CSS } from '../../../core/src/client/sidebar-css.ts'
import { STARTERS_CSS } from '../../../core/src/client/starters.tsx'
import { CONVERSATION_CSS, SHELL_CSS, installStyles } from '../../../core/src/client/design/index.ts'
import { DELIVER_CSS } from '../../../core/src/client/deliver-cards-css.ts'
import { USAGE_CSS } from '../../../core/src/client/usage-page-css.ts'
import { USER_MESSAGE_CSS } from '../../../core/src/client/user-message.tsx'
import { WIDGET_CSS } from '../../../core/src/client/widget-cell.tsx'
import { PROCESS_CSS } from '../../../core/src/client/work-process.tsx'

/** One group of sheets, installed under one tag. */
export interface SheetGroup {
  readonly tag: string
  readonly css: string
  /** The sheets the group is made of, for the test that compares it with the plugin's list. */
  readonly parts: readonly string[]
}

export const SHEET_GROUPS: readonly SheetGroup[] = [
  { tag: 'shell', css: SHELL_CSS, parts: ['SHELL_CSS'] },
  { tag: 'sidebar', css: SIDEBAR_CSS, parts: ['SIDEBAR_CSS'] },
  { tag: 'conversation', css: CONVERSATION_CSS, parts: ['CONVERSATION_CSS'] },
  { tag: 'secrets', css: SECRET_CSS, parts: ['SECRET_CSS'] },
  { tag: 'providers', css: PROVIDERS_CSS, parts: ['PROVIDERS_CSS'] },
  { tag: 'models', css: MODEL_CSS + FOLDER_CSS + ENGINE_CSS + BOT_SETTINGS_CSS + GROUP_SETTINGS_CSS + MARKET_CSS + RELAY_PAGE_CSS + TASKS_CSS, parts: ['MODEL_CSS', 'FOLDER_CSS', 'ENGINE_CSS', 'BOT_SETTINGS_CSS', 'GROUP_SETTINGS_CSS', 'MARKET_CSS', 'RELAY_PAGE_CSS', 'TASKS_CSS'] },
  { tag: 'usage', css: USAGE_CSS, parts: ['USAGE_CSS'] },
  { tag: 'schedules', css: SCHEDULE_CSS, parts: ['SCHEDULE_CSS'] },
  { tag: 'feedback', css: FEEDBACK_CSS, parts: ['FEEDBACK_CSS'] },
  { tag: 'about', css: ABOUT_CSS, parts: ['ABOUT_CSS'] },
  { tag: 'members', css: MEMBER_CSS, parts: ['MEMBER_CSS'] },
  { tag: 'user-messages', css: USER_MESSAGE_CSS, parts: ['USER_MESSAGE_CSS'] },
  { tag: 'mention-chips', css: MENTION_CHIPS_CSS, parts: ['MENTION_CHIPS_CSS'] },
  { tag: 'widgets', css: WIDGET_CSS, parts: ['WIDGET_CSS'] },
  { tag: 'browser', css: BROWSER_CSS, parts: ['BROWSER_CSS'] },
  { tag: 'work-process', css: EMPTY_STATE_CSS + WELCOME_CSS + PROCESS_CSS + RETRY_CSS + STARTERS_CSS + FILES_PANEL_CSS + DELIVER_CSS, parts: ['EMPTY_STATE_CSS', 'WELCOME_CSS', 'PROCESS_CSS', 'RETRY_CSS', 'STARTERS_CSS', 'FILES_PANEL_CSS', 'DELIVER_CSS'] },
  { tag: 'return', css: RETURN_CSS, parts: ['RETURN_CSS'] },
]

/** The tags the window's own stylesheet (`app.css`) owns, so the two never collide. */
export const WINDOW_TAGS: readonly string[] = ['window']

/** Installs every group and returns the elements, in the order they were added. */
export function installSheets(): readonly HTMLStyleElement[] {
  return SHEET_GROUPS.map(group => installStyles(group.css, group.tag))
}

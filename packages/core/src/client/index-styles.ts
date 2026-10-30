// Compiled CSS installers for the client shell and conversation surfaces.
import { ABOUT_CSS } from './about.tsx'
import { WELCOME_CSS } from './chat-welcome.tsx'
import { CONVERSATION_CSS, SHELL_CSS, installCompiledStyles } from './design/index.ts'
import { MOBILE_CSS } from './design/mobile.ts'
import { DELIVER_CSS } from './deliver-cards-css.ts'
import { EMPTY_STATE_CSS, SETTINGS_CHROME_CSS } from 'moon-bot-ui'
import { FEEDBACK_CSS } from './feedback.tsx'
import { FILES_PANEL_CSS } from './files-panel.ts'
import { MEMBER_CSS } from './member-status.tsx'
import { MENTION_CHIPS_CSS } from './mention-chips.tsx'
import { MODEL_CSS } from './model-menu-css.ts'
import { RETRY_CSS } from './retry-cell.tsx'
import { SCHEDULE_CSS } from './schedules.tsx'
import { SECRET_CSS } from './secret-card-css.ts'
import { SIDEBAR_CSS } from './sidebar.tsx'
import { STARTERS_CSS } from './starters.tsx'
import { USER_MESSAGE_CSS } from './user-message.tsx'
import { USAGE_CSS } from './usage-page-css.ts'
import { WIDGET_CSS } from './widget-cell.tsx'
import { BROWSER_CSS } from './browser-pane-css.ts'
import { BOT_SETTINGS_CSS } from './bot-settings.tsx'
import { GROUP_SETTINGS_CSS } from './group-settings.tsx'
import { FOLDER_CSS } from './folder-menu.tsx'
import { ENGINE_CSS } from './engine-menu.tsx'
import { MARKET_CSS } from './connector-market.tsx'
import { CAPABILITY_CSS } from './capability-css.ts'
import { RELAY_PAGE_CSS } from './relay-page.tsx'
import { TASKS_CSS } from './tasks-page.tsx'
import { PROCESS_CSS } from './work-process.tsx'
import type { Disposer } from './client-ctx.js'

type StyleInstaller = () => Disposer | undefined

/** CSS installers for the shell group (theme/shadows stay in apply). */
export const shellStyleInstallers = (browsers: boolean): readonly StyleInstaller[] => [
  () => installCompiledStyles(SHELL_CSS, 'shell'),
  () => installCompiledStyles(SIDEBAR_CSS, 'sidebar'),
  () => installCompiledStyles(SECRET_CSS, 'secrets'),
  () =>
    installCompiledStyles(
      MODEL_CSS +
        FOLDER_CSS +
        ENGINE_CSS +
        SETTINGS_CHROME_CSS +
        BOT_SETTINGS_CSS +
        GROUP_SETTINGS_CSS +
        MARKET_CSS +
        CAPABILITY_CSS +
        RELAY_PAGE_CSS +
        TASKS_CSS,
      'models',
    ),
  () => installCompiledStyles(USAGE_CSS, 'usage'),
  () => installCompiledStyles(SCHEDULE_CSS, 'schedules'),
  () => installCompiledStyles(FEEDBACK_CSS, 'feedback'),
  () => installCompiledStyles(ABOUT_CSS, 'about'),
  () => installCompiledStyles(MEMBER_CSS, 'members'),
  () => installCompiledStyles(USER_MESSAGE_CSS, 'user-messages'),
  () => installCompiledStyles(MENTION_CHIPS_CSS, 'mention-chips'),
  () => installCompiledStyles(WIDGET_CSS, 'widgets'),
  () =>
    installCompiledStyles(
      EMPTY_STATE_CSS + WELCOME_CSS + PROCESS_CSS + RETRY_CSS + STARTERS_CSS + FILES_PANEL_CSS + DELIVER_CSS,
      'work-process',
    ),
  ...(browsers ? [() => installCompiledStyles(BROWSER_CSS, 'browser')] : []),
  () => installCompiledStyles(MOBILE_CSS, 'mobile'),
]

export const conversationStyleInstaller = (): StyleInstaller => () =>
  installCompiledStyles(CONVERSATION_CSS, 'conversation')

export { installCompiledStyles }

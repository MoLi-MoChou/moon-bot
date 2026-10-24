import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { ABOUT_CSS } from '../../../core/src/client/about.tsx'
import { BOT_SETTINGS_CSS } from '../../../core/src/client/bot-settings.tsx'
import { FEEDBACK_CSS } from '../../../core/src/client/feedback.tsx'
import { FOLDER_CSS } from '../../../core/src/client/folder-menu.tsx'
import { GROUP_SETTINGS_CSS } from '../../../core/src/client/group-settings.tsx'
import { installLocale } from '../../../core/src/client/i18n.ts'
import { MEMBER_CSS } from '../../../core/src/client/member-status.tsx'
import { MODEL_CSS } from '../../../core/src/client/model-menu-css.ts'
import { PROVIDERS_CSS } from '../../../core/src/client/providers-page.tsx'
import { SCHEDULE_CSS } from '../../../core/src/client/schedules.tsx'
import { SECRET_CSS } from '../../../core/src/client/secret-card-css.ts'
import { SIDEBAR_CSS } from '../../../core/src/client/sidebar-css.ts'
import { CONVERSATION_CSS, SHELL_CSS, installStyles } from '../../../core/src/client/design/index.ts'
import { USAGE_CSS } from '../../../core/src/client/usage-page-css.ts'
import { createLocale } from './locale.js'
import { App } from './app.js'
import './app.css'

installLocale(createLocale(navigator.language))
document.documentElement.lang = navigator.language
// macOS puts the window buttons at the band's left end, over the sidebar (app.css).
if (/mac/iu.test(navigator.userAgentData?.platform ?? navigator.platform)) document.documentElement.dataset.mac = ''

// The Bot views' own stylesheets, the same ones the plugin puts in DSH.
for (const [tag, text] of [
  ['shell', SHELL_CSS], ['sidebar', SIDEBAR_CSS], ['conversation', CONVERSATION_CSS], ['secrets', SECRET_CSS], ['providers', PROVIDERS_CSS],
  ['models', MODEL_CSS + FOLDER_CSS + BOT_SETTINGS_CSS + GROUP_SETTINGS_CSS], ['usage', USAGE_CSS], ['schedules', SCHEDULE_CSS],
  ['feedback', FEEDBACK_CSS], ['about', ABOUT_CSS], ['members', MEMBER_CSS],
]) installStyles(text, tag)

// The plugin's colors switch on body[data-ds-dark-theme], which DSH sets; here the system's
// light or dark mode sets it.
const dark = matchMedia('(prefers-color-scheme: dark)')
const paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }
paint()
dark.addEventListener('change', paint)

createRoot(document.getElementById('root')).render(h(App))

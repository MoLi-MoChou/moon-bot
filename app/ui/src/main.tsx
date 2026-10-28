// The window's entry: the Bot views' copy and styles first (a sheet installed late shows
// as an unstyled frame), then the shell, then the app.
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installLocale } from '../../../core/src/client/i18n.ts'
import { App } from './app.tsx'
import { createLocale } from './locale.ts'
import { installSheets } from './sheets.ts'
import { applyTheme, followSystemAppearance } from './theme.ts'
import './app.css'

installLocale(createLocale(navigator.language))
document.documentElement.lang = navigator.language
// macOS puts the window buttons at the band's left end, over the sidebar (app.css).
const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
if (/mac/iu.test(platform)) document.documentElement.dataset.mac = ''

installSheets()
// Moon until the team's own preference arrives; App repaints when it does.
applyTheme(undefined)
followSystemAppearance()

const root = document.getElementById('root')
if (root === null) throw new Error('the window has no #root')
createRoot(root).render(<App />)

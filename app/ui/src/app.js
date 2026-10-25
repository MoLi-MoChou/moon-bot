import { Component, createElement as h, Fragment, useEffect, useMemo } from 'react'
import { ErrorToast } from '../../../core/src/client/feedback.tsx'
import { HeaderPill } from '../../../core/src/client/header.tsx'
import { t } from '../../../core/src/client/i18n.ts'
import { Overlays } from '../../../core/src/client/overlays.tsx'
import { BrandMark, TeamSidebar, YouAvatar } from '../../../core/src/client/sidebar.tsx'
import { allThemes, resolveThemeId, themeCss } from '../../../core/src/client/themes.ts'
import { Chat } from './chat.js'
import { createTeam } from './team.js'

// The team's theme and accent, as the plugin paints them (client-install.ts).
function useTheme(prefs) {
  useEffect(() => {
    const themes = allThemes()
    const id = resolveThemeId(themes, String(prefs?.theme ?? ''))
    const theme = themes[id] ?? themes.moon
    if (!theme) return undefined
    const style = document.createElement('style')
    style.dataset.dshBot = 'theme'
    style.dataset.plugin = 'ds-bot'
    style.textContent = themeCss(theme, prefs?.accent || undefined)
    document.head.append(style)
    document.body.dataset.btTheme = id
    if (prefs?.motion) document.body.dataset.btMotion = prefs.motion
    else delete document.body.dataset.btMotion
    return () => {
      style.remove()
      delete document.body.dataset.btTheme
      delete document.body.dataset.btMotion
    }
  }, [prefs?.theme, prefs?.accent, prefs?.motion])
}

// A dialog or panel that fails closes, and the failure shows as a toast; the window stays.
// One that fails again at once stays closed.
class Contain extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
    this.failedAt = 0
  }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error) {
    this.props.onError(error)
    if (Date.now() - this.failedAt > 1000) this.setState({ failed: false })
    this.failedAt = Date.now()
  }

  render() { return this.state.failed ? null : this.props.children }
}

export function App() {
  const team = useMemo(createTeam, [])
  useEffect(() => team.start(), [team])
  const { hooks, actions } = team
  const views = { ...hooks, actions }
  const wide = hooks.useLayout(state => state.wide)
  const shown = hooks.useShown(id => id)
  useTheme(hooks.useRoster(value => value.prefs))
  const closeOverlays = (error) => {
    actions.closeSettings()
    actions.closeMemory()
    actions.closeMenu()
    actions.closePanel()
    actions.closePalette()
    actions.closeVoice()
    actions.closeOverlay()
    actions.reportError(error, 'overlay')
  }
  return h('div', { className: 'dsb-frame', 'data-rail': wide ? undefined : '' },
    h('aside', { className: 'dsb-side' },
      h('div', { className: 'dsb-band' }),
      h('div', { className: 'dsb-side-list' },
        wide ? null : h('button', { type: 'button', className: 'dsb-expand', 'aria-label': t('Expand sidebar'), title: t('Expand sidebar'), onClick: () => actions.toggleSidebar() }, h(BrandMark, { size: 22 })),
        h(TeamSidebar, { ...views, wide })),
      h('div', { className: 'dsb-side-foot' },
        h('button', { type: 'button', className: 'dsb-settings', title: t('Settings'), onClick: () => actions.openSettings() }, h(YouAvatar)))),
    // The details panel makes room by giving the shell's `_centerCol` column a right margin.
    h('main', { className: 'dsb-main dsb_centerCol' },
      h('div', { className: 'dsb-band' }),
      shown ? h(Fragment, { key: shown },
        h('div', { className: 'dsb-head' }, h(HeaderPill, { ...views, sessionId: shown, useSession: team.sessionHook(shown) })),
        h(Chat, { sessionId: shown, team })) : null),
    h(Contain, { onError: closeOverlays }, h(Overlays, views)),
    h(ErrorToast, views))
}

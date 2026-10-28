// The window's frame: the team sidebar, the conversation, the overlays and the toast —
// the same Bot views the plugin host draws, around Moon Bot's own service.
import { Component, createElement as h, Fragment, useEffect, useMemo, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { ErrorToast } from '../../../core/src/client/feedback.tsx'
import { HeaderPill } from '../../../core/src/client/header.tsx'
import { t } from '../../../core/src/client/i18n.ts'
import { Overlays } from '../../../core/src/client/overlays.tsx'
import { BrandMark, TeamSidebar, YouAvatar } from '../../../core/src/client/sidebar.tsx'
import { applyTheme } from './theme.ts'
import { Chat } from './chat.tsx'
import { asViews, createTeam, type Team } from './team.ts'

// A dialog or panel that fails closes, and the failure shows as a toast; the window stays.
// One that fails again at once stays closed.
interface ContainProps {
  readonly children?: ReactNode
  readonly onError: (error: unknown) => void
}
interface ContainState { failed: boolean }

class Contain extends Component<ContainProps, ContainState> {
  private failedAt = 0

  constructor(props: ContainProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): ContainState { return { failed: true } }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error)
    if (Date.now() - this.failedAt > 1000) this.setState({ failed: false })
    this.failedAt = Date.now()
  }

  override render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function App(): ReactElement {
  const team: Team = useMemo(createTeamOnce, [])
  useEffect(() => team.start(), [team])
  const { hooks, actions } = team
  const views = { ...hooks, actions }
  const wide = hooks.useLayout(state => state.wide)
  const shown = hooks.useShown(id => id)
  const prefs = hooks.useRoster(value => value.prefs)
  applyTheme(prefs)
  const closeOverlays = (error: unknown): void => {
    actions.closeSettings()
    actions.closeMemory()
    actions.closeMenu()
    actions.closePanel()
    actions.closePalette()
    actions.closeVoice()
    actions.closeOverlay()
    actions.reportError(error instanceof Error ? error : new Error(String(error)), 'overlay')
  }
  return <div className='dsb-frame' data-rail={wide ? undefined : ''}>
    <aside className='dsb-side'>
      <div className='dsb-band' />
      <div className='dsb-side-list'>
        {wide ? null : <button type='button' className='dsb-expand' aria-label={t('Expand sidebar')} title={t('Expand sidebar')} onClick={() => { actions.toggleSidebar() }}>
          <BrandMark size={22} />
        </button>}
        <TeamSidebar {...asViews<Parameters<typeof TeamSidebar>[0]>({ ...views, wide })} />
      </div>
      <div className='dsb-side-foot'>
        <button type='button' className='dsb-settings' title={t('Settings')} onClick={() => { actions.openSettings() }}>
          <YouAvatar />
        </button>
      </div>
    </aside>
    {/* The details panel makes room by giving the shell's `_centerCol` column a right margin. */}
    <main className='dsb-main dsb_centerCol'>
      <div className='dsb-band' />
      {shown !== null
        ? h(Fragment, { key: shown },
          <div className='dsb-head'>
            <HeaderPill {...asViews<Parameters<typeof HeaderPill>[0]>({ ...views, sessionId: shown, useSession: team.sessionHook(shown) })} />
          </div>,
          <Chat sessionId={shown} team={team} />)
        : null}
    </main>
    <Contain onError={closeOverlays}>
      <Overlays {...asViews<Parameters<typeof Overlays>[0]>(views)} />
    </Contain>
    <ErrorToast {...asViews<Parameters<typeof ErrorToast>[0]>(views)} />
  </div>
}

// `createTeam` takes no arguments, but `useMemo` would call it with a render's props.
const createTeamOnce = (): Team => createTeam()


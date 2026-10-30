// The window's frame: the team sidebar, the conversation, the overlays and the toast —
// the same Bot views the plugin host draws, around Moon Bot's own service.
import {
  Component,
  createElement as h,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react'
import { ErrorToast } from '../../../../packages/core/src/client/feedback.tsx'
import { HeaderPill } from '../../../../packages/core/src/client/header.tsx'
import { t } from '../../../../packages/core/src/client/i18n.ts'
import { SidebarIcon } from '../../../../packages/core/src/client/icons.tsx'
import { Overlays } from '../../../../packages/core/src/client/overlays.tsx'
import { BrandMark, TeamSidebar, YouAvatar } from '../../../../packages/core/src/client/sidebar.tsx'
import { applyTheme } from './theme.ts'
import { Chat } from './chat.tsx'
import { asViews, createTeam, type Team } from './team.ts'

// The width at which the sidebar becomes a drawer (app.css has the matching breakpoint).
const NARROW = '(max-width: 640px)'

// A touch keyboard's Return belongs to the text: it inserts a line and the send button
// sends. The composer's own key handler keeps Return-to-send for a fine pointer, so the
// newline is inserted here, ahead of it, and the controlled field learns it from `input`.
const TRIGGER_MENU = '.mb-trigger-menu'

function installTouchNewline(root: HTMLElement): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    if (!matchMedia('(pointer: coarse)').matches) return
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.hasAttribute('data-composer-input')) return
    // The @/ menu is a suggestion list: while it is open, Return picks the highlighted item.
    if (document.querySelector(TRIGGER_MENU) !== null) return
    const field = event.target
    event.preventDefault()
    event.stopPropagation()
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? start
    field.setRangeText('\n', start, end, 'end')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  root.addEventListener('keydown', onKey, true)
  return () => root.removeEventListener('keydown', onKey, true)
}

// The browser's width, repainted when the window crosses the drawer's breakpoint.
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const media = matchMedia(NARROW)
    const update = (): void => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

// The keyboard shrinks the visual viewport on phones without resizing the layout viewport
// (app.css keeps the frame on the visible height through these two values).
function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (viewport === null) return undefined
    const root = document.documentElement
    const sync = (): void => {
      root.style.setProperty('--mb-vv-height', `${viewport.height}px`)
      root.style.setProperty('--mb-vv-top', `${viewport.offsetTop}px`)
    }
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      root.style.removeProperty('--mb-vv-height')
      root.style.removeProperty('--mb-vv-top')
    }
  }, [])
}

// A dialog or panel that fails closes, and the failure shows as a toast; the window stays.
// One that fails again at once stays closed.
interface ContainProps {
  readonly children?: ReactNode
  readonly onError: (error: unknown) => void
}
interface ContainState {
  failed: boolean
}

class Contain extends Component<ContainProps, ContainState> {
  private failedAt = 0

  constructor(props: ContainProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): ContainState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error)
    if (Date.now() - this.failedAt > 1000) this.setState({ failed: false })
    this.failedAt = Date.now()
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export function App(): ReactElement {
  const team: Team = useMemo(createTeamOnce, [])
  useEffect(() => team.start(), [team])
  useVisualViewport()
  const { hooks, actions } = team
  const views = { ...hooks, actions }
  const wide = hooks.useLayout(state => state.wide)
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  const menu = useRef<HTMLButtonElement>(null)
  const side = useRef<HTMLElement>(null)
  const main = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)
  const shown = hooks.useShown(id => id)
  const prefs = hooks.useRoster(value => value.prefs)
  applyTheme(prefs)
  // Return on a phone's keyboard never sends; it belongs to the text.
  useEffect(() => {
    const node = main.current
    return node === null ? undefined : installTouchNewline(node)
  }, [])
  // A phone shows one surface at a time: the sidebar's state says how it would look in a
  // wide window, so the drawer always opens on the expanded list.
  const sidebar = wide || narrow
  // The drawer never outlives the breakpoint that opened it.
  useEffect(() => {
    if (!narrow) setDrawer(false)
  }, [narrow])
  // The part behind the drawer is inert, so focus cannot leave it; opening and closing
  // move focus with it.
  useEffect(() => {
    if (side.current !== null) side.current.inert = narrow && !drawer
    if (main.current !== null) main.current.inert = narrow && drawer
    if (narrow && drawer) {
      wasOpen.current = true
      const first = side.current?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ;(first ?? side.current)?.focus()
    } else if (narrow && wasOpen.current) {
      wasOpen.current = false
      menu.current?.focus()
    }
  }, [narrow, drawer])
  useEffect(() => {
    if (!drawer) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setDrawer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawer])
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
  return (
    <div className='mb-frame' data-rail={sidebar ? undefined : ''} data-drawer={narrow && drawer ? '' : undefined}>
      <aside
        ref={side}
        id='mb-sidebar'
        className='mb-side'
        tabIndex={-1}
        onClick={event => {
          if (!narrow || !drawer || !(event.target instanceof Element)) return
          // Any seat that navigates or opens a layer hands the phone over to it.
          if (event.target.closest('button,a,[role=button]') !== null) setDrawer(false)
        }}>
        <div className='mb-band' />
        <div className='mb-side-list'>
          {sidebar ? null : (
            <button
              type='button'
              className='mb-expand'
              aria-label={t('Expand sidebar')}
              title={t('Expand sidebar')}
              onClick={() => {
                actions.toggleSidebar()
              }}>
              <BrandMark size={22} />
            </button>
          )}
          <TeamSidebar {...asViews<Parameters<typeof TeamSidebar>[0]>({ ...views, wide: sidebar })} />
        </div>
        <div className='mb-side-foot'>
          <button
            type='button'
            className='mb-settings'
            title={t('Settings')}
            onClick={() => {
              actions.openSettings()
            }}>
            <YouAvatar />
          </button>
        </div>
      </aside>
      {narrow && drawer ? (
        <div
          className='mb-scrim'
          aria-hidden
          onClick={() => {
            setDrawer(false)
          }}
        />
      ) : null}
      {/* The details panel makes room by giving the shell's `_centerCol` column a right margin. */}
      <main ref={main} className='mb-main dsb_centerCol'>
        <div className='mb-band' />
        {/* On a phone this is the only way to the sidebar; a wide window keeps its column. */}
        <button
          ref={menu}
          type='button'
          className='mb-menu'
          aria-label={drawer ? t('Collapse sidebar') : t('Expand sidebar')}
          title={drawer ? t('Collapse sidebar') : t('Expand sidebar')}
          aria-expanded={drawer}
          aria-controls='mb-sidebar'
          onClick={() => {
            setDrawer(value => !value)
          }}>
          <SidebarIcon />
        </button>
        {shown !== null
          ? h(
              Fragment,
              { key: shown },
              <div className='mb-head'>
                <HeaderPill
                  {...asViews<Parameters<typeof HeaderPill>[0]>({
                    ...views,
                    sessionId: shown,
                    useSession: team.sessionHook(shown),
                  })}
                />
              </div>,
              <Chat sessionId={shown} team={team} />,
            )
          : null}
      </main>
      <Contain onError={closeOverlays}>
        <Overlays {...asViews<Parameters<typeof Overlays>[0]>(views)} />
      </Contain>
      <ErrorToast {...asViews<Parameters<typeof ErrorToast>[0]>(views)} />
    </div>
  )
}

// `createTeam` takes no arguments, but `useMemo` would call it with a render's props.
const createTeamOnce = (): Team => createTeam()

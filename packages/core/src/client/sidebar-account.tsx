// Account launcher, shell settings openers, and brand marks.
import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LEAN } from './lean.ts'
import { createPortal } from 'react-dom'
import { currentPart } from './text.ts'
import { GaugeIcon, ClockIcon, GearIcon, ConnectorIcon, SwitchIcon, MoonBotMark } from './icons.tsx'
import { t, productName } from './i18n.ts'
import { useMenuKeys } from './overlay-hooks.ts'
import type { ReactNode } from 'react'
import type {
  TSidebarActions,
  TSidebarHook,
  TSidebarProps,
  TSidebarRoster,
  TSidebarSessionList,
  TSidebarShellShortcuts,
} from './sidebar-types.js'
export let openShellSettings: ((page?: string) => void) | null = null
export let openShellOnboarding: ((id?: unknown) => void) | null = null
export let shellShortcuts: TSidebarShellShortcuts | null = null
export function holdShellShortcuts(shortcuts: TSidebarShellShortcuts | null): () => void {
  shellShortcuts = shortcuts
  return () => {
    if (shellShortcuts === shortcuts) shellShortcuts = null
  }
}
// DeepSeek Harness hands its settings opener only to the settings.launcher seat. When
// the Desktop's account menu holds that seat, its first item (Settings) is the way in;
// the Desktop on Windows and macOS takes shortcuts natively, so a synthetic key press
// reaches the shell only where the page delivers them (the Web, Linux).
export function openShellSettingsPanel(section?: string): void {
  // A frame first, so a Bot dialog that closes on this click leaves the modal stack.
  requestAnimationFrame(() => {
    if (section) showShellSection(section)
    if (openShellSettings) {
      openShellSettings()
      return
    }
    const desktop = document.querySelector('button[aria-haspopup="menu"][data-signed-out]')
    if (desktop) openThroughMenu(desktop)
    else pressSettingsShortcut()
  })
}
// Moon Bot patch: the shell's opener takes no section, so its nav row is clicked once the
// dialog is up (the host names the models page "Models" / "模型").
export const SECTION_NAMES: Record<string, RegExp> = { models: /^(Models|模型)$/u }
export function showShellSection(section: string, tries = 40): void {
  const name = SECTION_NAMES[section]
  if (!name) return
  const row = [...document.querySelectorAll<HTMLElement>('[role=dialog] button')].find(node =>
    name.test((node.textContent ?? '').trim()),
  )
  if (row) {
    row.click()
    return
  }
  if (tries > 0) setTimeout(() => showShellSection(section, tries - 1), 50)
}
// Opens one of the shell's own onboarding editors, such as the DeepSeek API key form.
export function openShellOnboardingPanel(id?: unknown): void {
  requestAnimationFrame(() => {
    if (openShellOnboarding) openShellOnboarding(id)
    else openShellSettingsPanel()
  })
}
export function openThroughMenu(trigger: Element): void {
  const before = new Set(document.querySelectorAll('[role="menu"]'))
  if (trigger instanceof HTMLElement) trigger.click()
  let frames = 0
  const look = () => {
    const menu = [...document.querySelectorAll('[role="menu"]')].find(node => !before.has(node))
    const item = menu?.querySelector<HTMLElement>('button[role="menuitem"]')
    if (item) item.click()
    else if (++frames < 30) requestAnimationFrame(look)
    else pressSettingsShortcut()
  }
  requestAnimationFrame(look)
}
export function pressSettingsShortcut(): void {
  const binding = shellShortcuts?.catalog.getSnapshot().find(row => row.id === 'settings.open')?.binding
  if (!binding) return
  const held = new Set(binding.modifiers)
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code: binding.code,
      key: binding.code === 'Comma' ? ',' : '',
      bubbles: true,
      cancelable: true,
      ctrlKey: held.has('control'),
      altKey: held.has('alt'),
      shiftKey: held.has('shift'),
      metaKey: held.has('meta'),
    }),
  )
}
// The footer avatar opens an account menu above itself, with Bot settings as one
// entry. Shell panels hidden from the Bot sidebar (plugins, automation) live here too.
// `seat` is the shell's settings.launcher seat: at priority -10 the whale wins it
// over a shell account plugin's own launcher (the Desktop's "··· More"), which comes
// back in Agent mode; FooterAccount stands in while no seat exists at all.
export function AccountLauncher({
  seat = true,
  settingsOpen,
  openSettings,
  openOnboarding,
  actions,
}: {
  readonly seat?: boolean
  readonly settingsOpen?: boolean | undefined
  readonly openSettings?: (() => void) | undefined
  readonly openOnboarding?: ((id?: unknown) => void) | undefined
  readonly actions: TSidebarActions
}) {
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    if (!seat) return undefined
    actions.seatAccount(true)
    return () => actions.seatAccount(false)
  }, [seat])
  const [box, setBox] = useState<{
    left: number
    bottom: number
  } | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  useMenuKeys(menu, open)
  useEffect(() => {
    if (settingsOpen) setOpen(false)
  }, [settingsOpen])
  // The settings dialog links back to the shell's own settings (models, providers).
  useEffect(() => {
    if (!openSettings) return undefined
    openShellSettings = openSettings
    return () => {
      if (openShellSettings === openSettings) openShellSettings = null
    }
  }, [openSettings])
  useEffect(() => {
    if (!openOnboarding) return undefined
    openShellOnboarding = openOnboarding
    return () => {
      if (openShellOnboarding === openOnboarding) openShellOnboarding = null
    }
  }, [openOnboarding])
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        (event.target.closest('.bt-account-menu') || button.current?.contains(event.target))
      )
        return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) setBox({ left: rect.left, bottom: window.innerHeight - rect.top + 5 })
    setOpen(value => !value)
  }
  type MenuItem = readonly [string, () => ReactNode, () => unknown, string?]
  const groups: MenuItem[][] = [
    [
      [t('Usage'), GaugeIcon, () => actions.openSettings('usage')],
      [t('Connectors'), ConnectorIcon, () => actions.openConnectors()],
      ...(LEAN.schedules
        ? [[t('Automation tasks'), ClockIcon, () => actions.selectPanel('schedules')] as MenuItem]
        : []),
      [t('Bot settings'), GearIcon, () => actions.openSettings('general')],
    ],
    ...(LEAN.classicMode
      ? [[[t('Switch to classic Agent mode'), SwitchIcon, () => actions.setSurface('agent')] as MenuItem]]
      : []),
  ]
  return (
    <>
      <button
        ref={button}
        type='button'
        className='bt-account'
        aria-label={t('Account')}
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={toggle}>
        <span className='bt-you' aria-hidden>
          <MoonBotMark size={24} />
        </span>
      </button>
      {open && box
        ? createPortal(
            <div
              ref={menu}
              className='bt-menu bt-menu-up bt-account-menu'
              role='menu'
              aria-label={t('Account')}
              style={box}>
              {groups.map((group, index) => (
                <>
                  {index > 0 ? <div className='bt-menu-sep' role='separator' /> : null}
                  {group.map(([label, Icon, run, hint]) => (
                    <button
                      key={label}
                      type='button'
                      role='menuitem'
                      onClick={() => {
                        setOpen(false)
                        void Promise.resolve(run()).catch(error => actions.reportError(error, 'menu'))
                      }}>
                      {h(Icon)}
                      <span className='bt-menu-label'>{label}</span>
                      {hint ? <span className='bt-menu-hint'>{hint}</span> : null}
                    </button>
                  ))}
                </>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
// Opens the Main Bot whenever the main view holds no Bot conversation, the way
// The view always lands on a Bot rather than an empty New Session page.
// When a Bot's chat moves on to a fresh part, the shell clears the view of the part
// it archived; the chat then goes on in the Bot's current part instead.
export function useLandOnMainBot(
  roster: TSidebarRoster,
  useSessions: TSidebarHook<TSidebarSessionList>,
  actions: TSidebarActions,
): void {
  const mainView = useSessions(list => {
    const row = Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)
    return row ? `${row.id}|${row.blank ? 1 : 0}` : ''
  })
  const lastBot = useRef<{
    readonly botId: string
    readonly sessionId: string
  } | null>(null)
  useEffect(() => {
    if (!roster.ready || !roster.mainBotId) return undefined
    const [id = '', blank = ''] = mainView.split('|')
    const bot = id === '' ? undefined : roster.byId[id]
    if (bot !== undefined) {
      lastBot.current = { botId: bot.id, sessionId: id }
      if (currentPart(bot) !== id) actions.landOn(bot.id)
      return undefined
    }
    // An Agent Session, blank or not, is a real destination: it stays.
    if (
      id !== '' &&
      (roster.roomsById[id] !== undefined ||
        (actions.isAgentSession?.(id) ?? roster.agentOf[id] !== undefined) ||
        blank !== '1')
    ) {
      lastBot.current = null
      return undefined
    }
    const last = lastBot.current
    const mainBotId = roster.mainBotId as string
    const timer = setTimeout(() => actions.landOn(mainBotId, last), last ? 0 : 400)
    return () => clearTimeout(timer)
  }, [mainView, roster])
}
export function FooterAccount(
  props: TSidebarProps & {
    readonly settingsOpen?: boolean | undefined
    readonly openSettings?: (() => void) | undefined
    readonly openOnboarding?: ((id?: unknown) => void) | undefined
  },
) {
  const seated = props.useUi(value => value.accountSeated === true)
  if (seated) return null
  return (
    <span className='bt-foot-account'>
      <AccountLauncher {...props} seat={false} />
    </span>
  )
}
// The only entry registered in every mode: in Agent mode the whole Bot surface is
// withdrawn, and this button in the shell's own footer is the way back.
export function BotReturn({
  wide,
  useSurface,
  actions,
}: {
  readonly wide: boolean
  readonly useSurface: TSidebarHook<{
    readonly mode?: string | undefined
  }>
  readonly actions: Pick<TSidebarActions, 'setSurface'>
}) {
  const mode = useSurface(value => value.mode)
  if (mode !== 'agent') return null
  return (
    <button
      type='button'
      className='bt-return'
      aria-label={t('Moon Bot')}
      title={t('Moon Bot')}
      onClick={() => actions.setSurface('bot')}>
      <MoonBotMark size={20} />
      {wide ? <span className='bt-return-name'>{t('Moon Bot')}</span> : null}
    </button>
  )
}
// Agent mode has none of the shell-group styles, so the return button carries its own.
export function BrandMark({ size = 24 }: { readonly size?: number }) {
  return (
    <span className='bt-brand-whale'>
      <MoonBotMark size={size} />
    </span>
  )
}
export function BrandName() {
  return <span style={{ fontWeight: 600, fontSize: 14 }}>{productName()}</span>
}
// With the whale holding the settings seat, the Bot row is just the account menu
// and Connect plugins; FooterAccount only shows when the seat went to no one. The
// shell's footer classes are CSS-module names, so they match on their stems.

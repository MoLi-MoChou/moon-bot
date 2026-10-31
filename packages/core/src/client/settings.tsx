import { createElement as h, useCallback, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { LEAN } from './lean.ts'
import {
  CloseIcon,
  ChevronLeftIcon,
  InfoIcon,
  SlidersIcon,
  ClockIcon,
  ConnectorIcon,
  LibraryIcon,
  RelayIcon,
  PlugIcon,
  TasksIcon,
  SETTINGS_ICONS,
} from './icons.tsx'
import { useEscape } from './overlay-hooks.ts'
import { BotSettingsForm } from './bot-settings.tsx'
import { useGlide } from './motion.tsx'
import { GroupSettingsForm } from './group-settings.tsx'
import { KeyIcon } from './secret-card.tsx'
import { SecretsPage } from './secrets-page.tsx'
import { RelayPage } from './relay-page.tsx'
import { TasksPage } from './tasks-page.tsx'
import { UsagePage } from './usage-page.tsx'
import { ConnectorsPage } from './connectors.js'
import { CapabilitiesPage } from './capability-settings.tsx'
import { SchedulesPage } from './schedules.tsx'
import { FeedbackIcon, FeedbackPage } from './feedback.tsx'
import { AboutPage } from './about.tsx'
import type { AboutUpdate } from './about.tsx'
import { ProvidersPage } from './providers-page.tsx'
import { LibraryPage } from './library-page.tsx'
import { t } from './i18n.ts'
import type { RunWork, SettingsActions, SettingsRoster } from './settings-types.ts'
import { SetSection, SetRow } from './settings-chrome.tsx'
import { GeneralPage } from './settings-general.tsx'
import { BotsPage } from './settings-bots-page.tsx'
import { GroupsPage } from './settings-groups-page.tsx'

const ALL_SETTINGS_PAGES: [string, string][] = [
  ['general', 'General'],
  ['models', 'Models'],
  ['bots', 'Bots'],
  ['groups', 'Group chats'],
  ['connectors', 'Connectors'],
  ['remote', 'Remote agents'],
  ['capabilities', 'Capabilities'],
  ['schedules', 'Scheduled tasks'],
  ['tasks', 'Tasks'],
  ['usage', 'Usage'],
  ['library', 'Library'],
  ['secrets', 'Secrets'],
  ['feedback', 'Feedback'],
  ['about', 'About Moon Bot'],
]
const SETTINGS_PAGES = ALL_SETTINGS_PAGES.filter(
  ([id]) => (id !== 'groups' || LEAN.groups) && (id !== 'schedules' || LEAN.schedules),
)
const PAGE_ICONS: Record<string, () => ReactElement> = {
  ...SETTINGS_ICONS,
  models: SlidersIcon,
  connectors: ConnectorIcon,
  capabilities: PlugIcon,
  schedules: ClockIcon,
  library: LibraryIcon,
  remote: RelayIcon,
  tasks: TasksIcon,
  secrets: KeyIcon,
  feedback: FeedbackIcon,
  about: InfoIcon,
}

type PageMove = 'up' | 'in' | 'out'
export interface SettingsDialogProps {
  page?: string | undefined
  id?: string | null | undefined
  roster: SettingsRoster
  actions: SettingsActions
  /** The update store, as the shell keeps it: one selected slice of the plugin update state. */
  useUpdate: <T>(select: (value: AboutUpdate) => T) => T
  leaving?: boolean | undefined
}
// While `leaving`, the dialog plays its exit and takes no input.
export function SettingsDialog({ page, id, roster, actions, useUpdate, leaving = false }: SettingsDialogProps) {
  const [error, setError] = useState('')
  const close = useCallback(() => actions.closeSettings(), [])
  useEscape(close)
  const run: RunWork = promise =>
    Promise.resolve(promise)
      .then(() => {
        setError('')
        return true
      })
      .catch((failure: unknown) => {
        setError(failureMessage(failure))
        return false
      })
  // A Bot or group deleted while its form is open leaves its page on the list.
  const bot = page === 'bots' && id ? roster.byId[id] : undefined
  const room = page === 'groups' && id ? roster.roomsById[id] : undefined
  const pages = SETTINGS_PAGES.filter(([key]) => key !== 'models' || actions.providers !== undefined)
  const shown = page !== undefined && pages.some(([key]) => key === page) ? page : 'general'
  const usageFocus = shown === 'usage' && id ? id : null
  const pageTitle = pages.find(([key]) => key === shown)?.[1]
  const label = pageTitle === undefined ? '' : t(pageTitle)
  const back = bot ? t('Back to Bots') : room ? t('Back to group chats') : usageFocus ? t('All usage') : null
  useEscape(() => actions.openSettings(shown), Boolean(bot || room || usageFocus))
  const nav = useGlide(shown, { axis: 'y' })
  // A page enters from the right when it is one level in, from the left when it comes
  // back out, and from below beside it. Usage keeps its own entrance and its data
  // across its own levels, so they share one page.
  const pageKey = `${shown}:${bot?.id ?? room?.id ?? ''}`
  const depth = bot || room ? 1 : 0
  const last = useRef<{
    key: string
    depth: number
    move: PageMove
  }>({ key: pageKey, depth, move: 'up' })
  if (last.current.key !== pageKey) {
    last.current = {
      key: pageKey,
      depth,
      move: depth > last.current.depth ? 'in' : depth < last.current.depth ? 'out' : 'up',
    }
  }
  // Usage stays mounted from its first visit until Settings closes: coming back to it
  // shows the same page at once instead of loading it again. Meanwhile it keeps its
  // rendered state off screen (content-visibility).
  const [usageOpened, setUsageOpened] = useState(shown === 'usage')
  if (shown === 'usage' && !usageOpened) setUsageOpened(true)
  const errorLine = error ? (
    <div className='bt-panel-error' role='alert'>
      {error}
    </div>
  ) : null
  return (
    <div className='bt-settings-layer' data-leaving={leaving || undefined}>
      <div className='bt-scrim' onMouseDown={close} />
      <div className='bt-settings' role='dialog' aria-modal aria-label={t('Moon Bot settings')}>
        <nav ref={nav.box} className='bt-settings-nav' aria-label={t('Settings pages')}>
          <span ref={nav.thumb} className='bt-thumb' aria-hidden />
          {pages.map(([key, text]) => (
            <button
              key={key}
              type='button'
              className='bt-settings-item'
              data-page={key}
              aria-current={shown === key ? 'page' : undefined}
              onClick={() => actions.openSettings(key)}>
              {h(PAGE_ICONS[key] ?? InfoIcon)}
              {t(text)}
            </button>
          ))}
          {actions.openShellSettingsPanel ? (
            <button
              type='button'
              className='bt-settings-item bt-settings-shell'
              title={t('Models, providers, and the rest of Moon Bot')}
              onClick={() => {
                close()
                actions.openShellSettingsPanel?.()
              }}>
              <SlidersIcon />
              {t('Advanced settings')}
            </button>
          ) : null}
        </nav>
        <div className='bt-settings-main'>
          <div className='bt-settings-head'>
            {back ? (
              <button
                type='button'
                className='bt-icon-btn'
                aria-label={back}
                title={back}
                onClick={() => actions.openSettings(shown)}>
                <ChevronLeftIcon />
              </button>
            ) : null}
            <h2 key={bot?.id ?? room?.id ?? shown}>{bot?.name ?? room?.name ?? label}</h2>
          </div>
          {shown === 'usage' ? null : (
            <div
              key={pageKey}
              className='bt-settings-scroll bt-settings-page'
              data-page={shown}
              data-move={last.current.move}>
              {errorLine}
              {shown === 'tasks' ? <TasksPage taskActions={actions as never} /> : null}
              {shown === 'general' ? h(GeneralPage, { roster, actions, run }) : null}
              {shown === 'models' ? h(ProvidersPage, { actions: actions as never, run, Section: SetSection }) : null}
              {bot ? (
                <div className='bt-settings-form'>
                  <BotSettingsForm
                    key={bot.id}
                    bot={bot as never}
                    roster={roster as never}
                    actions={actions as never}
                    run={run}
                  />
                </div>
              ) : null}
              {shown === 'bots' && !bot
                ? h(BotsPage, { roster: roster as never, actions: actions as never, run })
                : null}
              {room ? (
                <div className='bt-settings-form'>
                  <GroupSettingsForm
                    key={room.id}
                    room={room as never}
                    roster={roster as never}
                    actions={actions as never}
                    run={run}
                  />
                </div>
              ) : null}
              {shown === 'groups' && !room ? h(GroupsPage, { roster, actions, run }) : null}
              {shown === 'connectors' ? (
                <ConnectorsPage roster={roster as never} actions={actions as never} market={actions as never} />
              ) : null}
              {shown === 'remote' ? <RelayPage relay={actions as never} /> : null}
              {shown === 'capabilities' ? (
                <CapabilitiesPage roster={roster as never} actions={actions as never} run={run} />
              ) : null}
              {shown === 'schedules' ? h(SchedulesPage, { roster, actions, start: id ?? undefined }) : null}
              {shown === 'secrets'
                ? h(SecretsPage, { roster: roster as never, actions: actions as never, run, Section: SetSection })
                : null}
              {shown === 'feedback' ? h(FeedbackPage, { actions, run, Section: SetSection, Row: SetRow }) : null}
              {shown === 'about' ? h(AboutPage, { useUpdate, actions, run, Section: SetSection, Row: SetRow }) : null}
              {shown === 'library' ? <LibraryPage roster={roster} actions={actions} /> : null}
            </div>
          )}
          {usageOpened ? (
            <div
              key='usage'
              className='bt-settings-scroll bt-settings-usage'
              data-off={shown === 'usage' ? undefined : ''}
              aria-hidden={shown === 'usage' ? undefined : true}>
              {shown === 'usage' ? errorLine : null}
              <UsagePage roster={roster} actions={actions} focusId={usageFocus} />
            </div>
          ) : null}
        </div>
        <button type='button' className='bt-settings-close' aria-label={t('Close settings')} onClick={close}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
const failureMessage = (failure: unknown): string =>
  (
    failure as {
      message?: string
    } | null
  )?.message ?? String(failure)

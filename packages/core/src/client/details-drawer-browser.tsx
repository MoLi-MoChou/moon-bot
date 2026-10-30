import { createElement as h, useEffect } from 'react'
import { PlusIcon } from './icons.tsx'
import { BotMark } from './mark.tsx'
import { GlobeIcon, Favicon } from './browser-pane.tsx'
import type { BrowserPagesHook, BrowserTabsHook, PanelPage, PanelPages, PanelTabs } from './browser-pane.tsx'
import { EmptyState } from 'moon-bot-ui'
import type { DetailsDrawerActions, DetailsDrawerRoster, DrawerBot } from './details-drawer-types.ts'
import { t } from './i18n.ts'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
const shortUrl = (url: string | undefined): string =>
  String(url ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
const EMPTY_TABS: PanelTabs = { ids: [], active: null }
const EMPTY_PAGE: Partial<PanelPage> = {}

export interface BrowserCardsProps {
  bot: DrawerBot
  sessionId: string
  roster: DetailsDrawerRoster
  actions: DetailsDrawerActions
  useBrowserTabs: BrowserTabsHook
  useBrowserPages: BrowserPagesHook
}

/** The Bot's browser inside the details page: its tabs as small window cards on Desktop, a pointer there on web. */
export function BrowserCards({ bot, sessionId, roster, actions, useBrowserTabs, useBrowserPages }: BrowserCardsProps) {
  const state = useBrowserTabs(map => map[bot.id] ?? EMPTY_TABS)
  const pages: PanelPages = useBrowserPages(map => map)
  useEffect(() => {
    actions.browserEnsure?.(bot.id)
  }, [bot.id])
  if (roster.browser !== true || !actions.browserShow) {
    return <div className='bt-muted'>{t('The browser is in the desktop app.')}</div>
  }
  if (state.ids.length === 0) {
    return (
      <EmptyState
        art={<BotMark bot={bot} size={44} state='idle' live />}
        title={t("{name}'s browser", { name: bot.name })}
        hint={t(
          'Open a page here and {name} can read it with you. Logins and cookies stay with {name}; other Bots never see them.',
          { name: bot.name },
        )}
        action={{ label: t('Open browser'), onClick: () => actions.openBrowser(sessionId) }}
      />
    )
  }
  return (
    <div className='bt-bcards'>
      {state.ids.map((tabId, index) => {
        const page = pages[tabId] ?? EMPTY_PAGE
        const label = page.title || shortUrl(page.url) || t('New tab')
        return (
          <div
            key={tabId}
            className='bt-bcard'
            data-active={state.active === tabId || undefined}
            style={{ animationDelay: `${index * 30}ms` }}>
            <button
              type='button'
              className='bt-bcard-shot'
              aria-label={t('Open {title}', { title: label })}
              title={page.url}
              onClick={() => actions.browserPick(sessionId, tabId)}>
              {page.excerpt ? (
                <span className='bt-bcard-preview'>
                  <span className='bt-bcard-ptitle'>{label}</span>
                  <span className='bt-bcard-excerpt'>{page.excerpt}</span>
                </span>
              ) : (
                <span className='bt-bcard-blank'>
                  <GlobeIcon />
                  <span>{label}</span>
                </span>
              )}
            </button>
            <button
              type='button'
              className='bt-bcard-x'
              aria-label={t('Close tab')}
              title={t('Close tab')}
              onClick={() => {
                void actions.browserCloseTab(bot.id, tabId)
              }}>
              ×
            </button>
            <div className='bt-bcard-row'>
              <Favicon src={page.favicon ?? null} className='bt-bcard-fav' />
              <span className='bt-bcard-title'>{label}</span>
              {page.url ? <span className='bt-bcard-host'>{hostOf(page.url)}</span> : null}
            </div>
          </div>
        )
      })}
      <button
        type='button'
        className='bt-bcard-new'
        style={{ animationDelay: `${state.ids.length * 30}ms` }}
        onClick={() => actions.browserNewTab(sessionId)}>
        <PlusIcon />
        {t('New tab')}
      </button>
    </div>
  )
}

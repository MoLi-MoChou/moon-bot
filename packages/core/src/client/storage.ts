// Browser storage keys. Values saved under an older name (ds-bot, dsh-bot, dsh-bot-team)
// move to the current keys once, so a renamed install keeps its unread marks, reactions,
// visits, theme, panel width and Bot browser tabs.
export const STORAGE = {
  unread: 'moon-bot:unread',
  reactions: 'moon-bot:reactions',
  seen: 'moon-bot:seen',
  prefs: 'moon-bot:prefs',
  surface: 'moon-bot:surface',
  agentSessions: 'moon-bot:agent-sessions',
  browserWidth: 'moon-bot:browser-width',
  browsers: 'moon-bot.browser.v2',
  sidebarOrder: 'moon-bot:sidebar-order',
} as const

export type StorageKey = (typeof STORAGE)[keyof typeof STORAGE]

// Newest legacy name first: when both exist, the more recent value wins.
const LEGACY_PREFIXES = ['ds-bot:', 'dsh-bot:', 'dsh-bot-team:']
// The tab strip already under another name, newest first, then the v1 store that kept
// one page per Bot and has to be turned into tabs.
const LEGACY_BROWSER_KEYS = ['ds-bot.browser.v2', 'ds-bot.browser.v1', 'dsh-bot.browser.v2', 'dsh-bot.browser.v1']
const LEGACY_BROWSER_TAB_KEYS = new Set(['ds-bot.browser.v2', 'dsh-bot.browser.v2'])
// The saved theme only paints the first frame before the team loads; it follows the
// host's rename of the theme ids.
const LEGACY_THEMES: Record<string, string> = { mono: 'grok', paper: 'claude', moonlight: 'deepseek' }

interface LegacyBrowserTab {
  id: string
  url: string
  title: string
}
interface LegacyPage {
  url?: unknown
  title?: unknown
}

export function legacyKeys(key: string): readonly string[] {
  if (key === STORAGE.browsers) return LEGACY_BROWSER_KEYS
  const name = key.slice(key.indexOf(':') + 1)
  return LEGACY_PREFIXES.map(prefix => `${prefix}${name}`)
}

// One page per Bot becomes one tab per Bot; a v2 store already present wins.
const migrateBrowsers = (storage: Storage): void => {
  if (storage.getItem(STORAGE.browsers) !== null) {
    for (const key of LEGACY_BROWSER_KEYS) storage.removeItem(key)
    return
  }
  for (const key of LEGACY_BROWSER_KEYS) {
    try {
      const value = storage.getItem(key)
      if (value === null) continue
      // A tab strip from a renamed build is already the current shape.
      if (LEGACY_BROWSER_TAB_KEYS.has(key)) {
        storage.setItem(STORAGE.browsers, value)
        for (const earlier of LEGACY_BROWSER_KEYS) storage.removeItem(earlier)
        return
      }
      const previous = JSON.parse(value) as unknown
      const pages =
        previous !== null && typeof previous === 'object' && !Array.isArray(previous)
          ? Object.entries(previous as Record<string, unknown>)
          : []
      const tabs: Record<string, { tabs: LegacyBrowserTab[]; active: string }> = Object.fromEntries(
        pages
          .filter(([, page]) => page !== null && typeof page === 'object')
          .map(([botId, page]) => {
            const tab: LegacyBrowserTab = {
              id: `v1-${botId}`,
              url: typeof (page as LegacyPage).url === 'string' ? ((page as LegacyPage).url as string) : '',
              title: typeof (page as LegacyPage).title === 'string' ? ((page as LegacyPage).title as string) : '',
            }
            return [botId, { tabs: [tab], active: tab.id }]
          }),
      )
      storage.setItem(STORAGE.browsers, JSON.stringify(tabs))
      for (const earlier of LEGACY_BROWSER_KEYS) storage.removeItem(earlier)
      return
    } catch {
      /* unreadable entry: try the older name */
    }
  }
}

export function migrateStorage(storage: Storage = globalThis.localStorage): void {
  for (const key of Object.values(STORAGE)) {
    if (key === STORAGE.browsers) continue
    for (const legacy of legacyKeys(key)) {
      try {
        const value = storage.getItem(legacy)
        if (value !== null && storage.getItem(key) === null) storage.setItem(key, value)
        storage.removeItem(legacy)
      } catch {
        /* storage unavailable */
      }
    }
  }
  try {
    migrateBrowsers(storage)
  } catch {
    /* storage unavailable */
  }
  try {
    const prefs = JSON.parse(storage.getItem(STORAGE.prefs) ?? 'null') as { theme?: unknown } | null
    const theme = typeof prefs?.theme === 'string' ? prefs.theme : ''
    const renamed = LEGACY_THEMES[theme]
    if (prefs !== null && renamed !== undefined)
      storage.setItem(STORAGE.prefs, JSON.stringify({ ...prefs, theme: renamed }))
  } catch {
    /* storage unavailable or not JSON */
  }
}

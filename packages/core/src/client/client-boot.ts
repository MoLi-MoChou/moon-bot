// Client state and host connection: sources, pull/poll, updates, Desktop browser bridge.
import { call } from './api.ts'
import { createBotBrowsers, serveBrowserReads } from './bot-browsers.ts'
import type { BrowserPages, BrowserTabsMap } from './bot-browsers.ts'
import { markupCache } from './characters.ts'
import type { ClientContext, Disposer } from './client-ctx.js'
import { EMPTY_SNAPSHOT } from './client-types.ts'
import type { CardsState, ClientRosterSnapshot, ClientState, ClientSurface, ClientUiState, ClientWork, LiveState, MemoryNews, StateAnswer, TurnClockState, UpdateState } from './client-types.ts'
import { quietly } from './diagnostics.ts'
import { language, t } from './i18n.ts'
import { RETRY_AFTER, retryNotice, showReconnectNotice } from './reconnect.ts'
import { noteLeft, setUnread, sharedMap } from './shared-map.ts'
import type { ReactionMap } from './shared-map.ts'
import { createSource, indexRoster, isAgentSession } from './sources.ts'
import { STORAGE, migrateStorage } from './storage.ts'
import { readMode } from './surface.ts'
import { currentPart } from './text.ts'

export function createClientState(ctx: ClientContext): ClientState {
  const roster = createSource<ClientRosterSnapshot>(EMPTY_SNAPSHOT)
  migrateStorage()
  const unreadStore = sharedMap<Record<string, boolean>>(STORAGE.unread)
  const reactionStore = sharedMap<ReactionMap>(STORAGE.reactions)
  const seenStore = sharedMap<Record<string, number>>(STORAGE.seen)
  let seenAt = seenStore.read()
  const ui = createSource<ClientUiState>({
    details: null,
    view: 'details',
    renaming: false,
    tab: null,
    newChat: null,
    exchange: null,
    menu: null,
    voice: null,
    palette: null,
    quote: null,
    settings: null,
    memory: null,
    toast: null,
    signIn: null,
    renameAgent: null,
    unread: unreadStore.read(),
    reactions: reactionStore.read(),
    visits: {},
  })
  const surface = createSource<ClientSurface>({ mode: readMode(), plain: false })
  let agentSessionCache = new Set<string>()
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE.agentSessions) ?? '[]')
    agentSessionCache = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    agentSessionCache = new Set<string>()
  }
  const pendingAdopt = new Map<string, string>()
  const snapshot = (): ClientRosterSnapshot => roster.getSnapshot()
  const isAgentSessionId = (id: string | null | undefined): boolean => isAgentSession(snapshot(), agentSessionCache, id) || (id !== undefined && id !== null && pendingAdopt.has(id))
  const agentOfSession = (id: string | undefined): string | undefined => (id === undefined ? undefined : (snapshot().agentOf[id] ?? pendingAdopt.get(id)))
  const workspaces = ctx.get('workspaces')
  const workspaceOf = (sessionId: string | undefined): string | undefined => {
    const items = workspaces?.list?.getSnapshot().items ?? []
    return items.find(item => item.sessionIds?.some(id => id === sessionId))?.workspaceId
  }
  const navigation: { expected: string | null } = { expected: null }
  const setPlain = (plain: boolean): void => {
    surface.set(state => (state.plain === plain ? state : { ...state, plain }))
  }
  const dropPanels = (): void => {
    ui.set(state => (state.details || state.renaming ? { ...state, details: null, view: 'details', renaming: false, tab: null } : state))
  }
  const seenKey = (id: string): string => snapshot().byId[id]?.id ?? id
  const leaveVisits = (ids: readonly string[]): void => {
    seenAt = seenStore.update(seen => noteLeft(seen, ids.map(seenKey), Date.now()), seenAt)
  }
  ctx.effect(() => {
    const onPageHide = (): void => leaveVisits(Object.keys(ui.getSnapshot().visits ?? {}))
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, 'moon-bot: remember visits on page hide')
  ctx.effect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== localStorage) return
      if (event.key === null || event.key === unreadStore.key) ui.set(state => ({ ...state, unread: unreadStore.read(state.unread ?? {}) }))
      if (event.key === null || event.key === reactionStore.key) ui.set(state => ({ ...state, reactions: reactionStore.read(state.reactions ?? {}) }))
      if (event.key === null || event.key === seenStore.key) seenAt = seenStore.read(seenAt)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, 'moon-bot: follow other windows')
  const activity = createSource<Record<string, string | undefined>>({})
  const work = createSource<ClientWork>({ bots: {}, approvals: [] })
  let workKey = ''
  const live = createSource<LiveState>({})
  const cards = createSource<CardsState>({})
  const heldCards = createSource<CardsState>({})
  const turnClock = createSource<TurnClockState>({})
  let activityKey = '{}'
  const memoryNews = createSource<Record<string, MemoryNews>>({})
  let memoryNewsKey: string | undefined
  const noteMemoryNews = (next: Record<string, MemoryNews>): void => {
    const key = JSON.stringify(next)
    if (key === memoryNewsKey) return
    const opening = memoryNewsKey === undefined
    memoryNewsKey = key
    memoryNews.set(state =>
      Object.fromEntries(
        Object.entries(next).map(([id, entry]): [string, MemoryNews] => {
          const previous = state[id]
          return [id, previous !== undefined && previous.at === entry.at ? previous : { ...entry, seen: opening ? 0 : Date.now() }]
        }),
      ),
    )
  }
  const PREFS_KEY = STORAGE.prefs
  let savedPrefs: Record<string, unknown> = {}
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    if (saved !== null && typeof saved === 'object') savedPrefs = saved as Record<string, unknown>
  } catch {
    savedPrefs = {}
  }
  const writeUnread = (id: string, value: boolean): void => {
    const unread = unreadStore.update(marks => setUnread(marks, id, value), ui.getSnapshot().unread ?? {})
    ui.set(state => (JSON.stringify(state.unread) === JSON.stringify(unread) ? state : { ...state, unread }))
  }
  const refreshed = new Set<string>()
  let pulls = 0
  let applied = 0
  const pull = async (full = false): Promise<void> => {
    const order = ++pulls
    const known = snapshot()
    const value = await call<StateAnswer>('state', { since: full ? -1 : known.revision, models: known.modelsKey ?? '', locale: language() })
    if (order < applied) return
    applied = order
    const nextActivity = JSON.stringify(value.activity ?? {})
    if (nextActivity !== activityKey) {
      activityKey = nextActivity
      activity.set(value.activity ?? {})
    }
    const nextWork = JSON.stringify(value.work ?? null)
    if (nextWork !== workKey) {
      workKey = nextWork
      work.set(value.work ?? { bots: {}, approvals: [] })
    }
    noteMemoryNews(value.memoryNews ?? {})
    const current = snapshot()
    const live: { connectors?: unknown; capabilityStatuses?: Record<string, unknown>; capabilityTools?: Record<string, readonly string[]> } = {}
    if (value.connectors !== undefined && JSON.stringify(value.connectors) !== JSON.stringify(current.connectors ?? [])) live.connectors = value.connectors
    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) live.capabilityStatuses = value.capabilityStatuses
    if (value.capabilityTools !== undefined && JSON.stringify(value.capabilityTools) !== JSON.stringify(current.capabilityTools ?? {})) live.capabilityTools = value.capabilityTools
    if (Object.keys(live).length > 0 && current.ready) roster.set({ ...current, ...live })
    if (value.unchanged || (value.revision === current.revision && value.modelsKey === current.modelsKey)) return
    if (Object.keys(seenAt).length === 0) leaveVisits([...value.bots, ...value.rooms].map(entry => entry.id))
    roster.set(indexRoster(value) as unknown as ClientRosterSnapshot)
    try {
      const ids = (value.agents ?? []).flatMap(agent => agent.sessions ?? [])
      localStorage.setItem(STORAGE.agentSessions, JSON.stringify(ids))
      agentSessionCache = new Set(ids)
    } catch {
      /* storage unavailable */
    }
    const listed = ctx.sessions.list.getSnapshot().byId ?? {}
    for (const id of pendingAdopt.keys()) {
      if (snapshot().agentOf[id] !== undefined || listed[id] === undefined) pendingAdopt.delete(id)
    }
    for (const id of [...value.bots.map(currentPart), ...value.rooms.map(room => room.id)]) {
      if (refreshed.has(id)) continue
      refreshed.add(id)
      void Promise.resolve(ctx.sessions.refreshProjections?.(id)).catch(quietly('refresh projections'))
    }
  }

  ctx.effect(() => {
    let stopped = false
    let running = false
    let failures = 0
    let force = false
    let hideNotice: ReturnType<typeof setTimeout> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async (): Promise<void> => {
      clearTimeout(timer)
      if (running || stopped) return
      running = true
      try {
        await pull(force)
        force = false
        if (failures >= RETRY_AFTER) {
          clearTimeout(hideNotice)
          showReconnectNotice(t('Back online. Catching up…'))
          hideNotice = setTimeout(() => showReconnectNotice(null), 1500)
        }
        failures = 0
      } catch (error) {
        if (!stopped) console.warn('[moon-bot] state', error)
        failures += 1
        showReconnectNotice(retryNotice(failures), () => {
          force = true
          void loop()
        })
        if (failures >= RETRY_AFTER) force = true
      } finally {
        running = false
      }
      if (!stopped) timer = setTimeout(loop, document.hidden ? 10000 : 1500)
    }
    const wake = (): void => {
      if (!document.hidden) void loop()
    }
    document.addEventListener('visibilitychange', wake)
    void loop()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      showReconnectNotice(null)
      clearTimeout(hideNotice)
    }
  }, 'moon-bot: roster poll')

  const update = createSource<UpdateState>({ available: false, phase: 'idle' })
  let updateWake: () => void = () => {}
  ctx.effect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async (): Promise<void> => {
      clearTimeout(timer)
      if (stopped) return
      const value = await call<UpdateState>('update-check', { fresh: false }).catch(() => null)
      if (stopped) return
      if (value) update.set(previous => ({ ...value, app: previous.app }))
      timer = setTimeout(loop, value?.phase === 'installing' ? 2000 : 60 * 60_000)
    }
    updateWake = () => {
      void loop()
    }
    void loop()
    return () => {
      stopped = true
      clearTimeout(timer)
      updateWake = () => {}
    }
  }, 'moon-bot: update check')

  const appUpdates = window.dshDesktop?.protocolVersion === 1 ? (window.dshDesktop.updates ?? null) : null
  if (appUpdates?.status && appUpdates.subscribe) {
    ctx.effect(() => {
      let stopped = false
      const take = (app: DshAppUpdate | undefined): void => {
        if (!stopped && app) update.set(previous => ({ ...previous, app }))
      }
      void appUpdates.status().then(take, () => {})
      const unsubscribe = appUpdates.subscribe(take)
      return () => {
        stopped = true
        unsubscribe?.()
      }
    }, 'moon-bot: app update status')
  }

  const bridge = window.dshDesktop?.protocolVersion === 1 ? (window.dshDesktop.browser ?? null) : null
  const browsers = bridge ? createBotBrowsers({ bridge, createSource }) : null
  if (browsers) {
    ctx.effect(() => {
      let stopReads: Disposer | null = null
      const sync = (): void => {
        const current = snapshot()
        if (!current.ready) return
        const on = current.browser === true
        if (on && !stopReads) stopReads = serveBrowserReads({ browsers, post: call })
        if (!on && stopReads) {
          stopReads()
          stopReads = null
        }
        void browsers.retain(current.bots.map(bot => bot.id))
        ui.set(state => (state.details && state.view === 'browser' && (!on || !current.byId[state.details]) ? { ...state, view: 'details' } : state))
      }
      sync()
      const offRoster = roster.subscribe(sync)
      return () => {
        offRoster()
        stopReads?.()
        browsers.dispose()
      }
    }, 'moon-bot: Bot browsers')
  }

  ctx.effect(
    () => () => {
      markupCache.clear()
    },
    'moon-bot: character markup',
  )

  const agentSessions = (agentId: string): string[] => {
    const ids = [...(snapshot().agentsById[agentId]?.sessions ?? [])]
    for (const [id, owner] of pendingAdopt) if (owner === agentId && !ids.includes(id)) ids.push(id)
    return ids
  }
  const mainView = (): string | undefined => Object.values(ctx.sessions.list.getSnapshot().byId ?? {}).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id
  const browserPages = browsers?.pages ?? createSource<BrowserPages>({})
  const browserTabs = browsers?.tabs ?? createSource<BrowserTabsMap>({})

  return {
    roster,
    ui,
    surface,
    activity,
    work,
    live,
    cards,
    heldCards,
    turnClock,
    memoryNews,
    update,
    reactionStore,
    savedPrefs,
    browsers,
    browserPages,
    browserTabs,
    appUpdates,
    pendingAdopt,
    navigation,
    pull,
    wakeUpdate: () => updateWake(),
    isAgentSessionId,
    agentOfSession,
    workspaceOf,
    agentSessions,
    mainView,
    setPlain,
    dropPanels,
    writeUnread,
    leaveVisits,
    seenKey,
    seenAt: () => seenAt,
  }
}

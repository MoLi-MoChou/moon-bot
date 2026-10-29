// The client's state and its connection to the host: the sources every Bot view reads,
// the state pull and its poll, the plugin and app update checks, and the Desktop browser
// bridge. `apply` calls `createClientState` once, then builds the actions and the slots
// over what it returns.

import { call } from './api.ts'
import { createBotBrowsers, serveBrowserReads } from './bot-browsers.ts'
import type { BrowserPages, BrowserTabsMap } from './bot-browsers.ts'
import { markupCache } from './characters.ts'
import type { ClientContext, Disposer } from './client-ctx.js'
import { EMPTY_SNAPSHOT } from './client-types.ts'
import type {
  CardsState, ClientRosterSnapshot, ClientState, ClientSurface, ClientUiState, ClientWork, LiveState, MemoryNews, StateAnswer, TurnClockState, UpdateState,
} from './client-types.ts'
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
  // When each conversation was last left; a visit compares new turns against it.
  const seenStore = sharedMap<Record<string, number>>(STORAGE.seen)
  let seenAt = seenStore.read()
  // `details` is the panel's subject (a Session id); `view` picks details or the
  // subject Bot's browser inside it.
  const ui = createSource<ClientUiState>({
    details: null, view: 'details', renaming: false, tab: null, newChat: null, exchange: null, menu: null,
    voice: null, palette: null, quote: null, settings: null, memory: null, toast: null, signIn: null,
    renameAgent: null, unread: unreadStore.read(), reactions: reactionStore.read(), visits: {},
  })
  // Bot mode paints the whole team surface; Agent mode withdraws every slot and
  // style so the shell's own interface returns. `plain` stays false until a Bot-mode
  // view hosts a plain session, which drops only the conversation replacements.
  const surface = createSource<ClientSurface>({ mode: readMode(), plain: false })
  // Agent Session ids from the last pull, so a reload already knows the main
  // view is a plain Session before the team answers.
  let agentSessionCache = new Set<string>()
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE.agentSessions) ?? '[]')
    agentSessionCache = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch { agentSessionCache = new Set<string>() }
  // Sessions adopted on this window (workspace pick, fork) but not yet in the roster.
  const pendingAdopt = new Map<string, string>()
  const snapshot = (): ClientRosterSnapshot => roster.getSnapshot()
  const isAgentSessionId = (id: string | null | undefined): boolean =>
    isAgentSession(snapshot(), agentSessionCache, id) || (id !== undefined && id !== null && pendingAdopt.has(id))
  const agentOfSession = (id: string | undefined): string | undefined => (id === undefined ? undefined : snapshot().agentOf[id] ?? pendingAdopt.get(id))
  // The workspace a Session lives in, for follow-up creates and switch detection.
  const workspaces = ctx.get('workspaces')
  const workspaceOf = (sessionId: string | undefined): string | undefined => {
    const items = workspaces?.list?.getSnapshot().items ?? []
    return items.find(item => item.sessionIds?.some(id => id === sessionId))?.workspaceId
  }
  // A navigation this plugin started: the surface effect trusts the id it lands on.
  const navigation: { expected: string | null } = { expected: null }
  const setPlain = (plain: boolean): void => { surface.set(state => (state.plain === plain ? state : { ...state, plain })) }
  // An Agent Session shows the plain conversation: the Bot details and browser
  // panels would follow it and report it is not on the team, so they close.
  const dropPanels = (): void => { ui.set(state => (state.details || state.renaming ? { ...state, details: null, view: 'details', renaming: false, tab: null } : state)) }
  // A Bot's chat spans several parts, so when it was last left is kept per Bot.
  const seenKey = (id: string): string => snapshot().byId[id]?.id ?? id
  const leaveVisits = (ids: readonly string[]): void => {
    seenAt = seenStore.update(seen => noteLeft(seen, ids.map(seenKey), Date.now()), seenAt)
  }
  ctx.effect(() => {
    const onPageHide = (): void => leaveVisits(Object.keys(ui.getSnapshot().visits ?? {}))
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, 'moon-bot: remember visits on page hide')
  // Unread marks, reactions and visits are shared by every window; one saved elsewhere
  // shows here at once. A `null` key is a cleared storage.
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
  // Per Bot, the turn it runs and its tool; and the approvals waiting for the user.
  const work = createSource<ClientWork>({ bots: {}, approvals: [] })
  let workKey = ''
  // Per Session, what its transcript has in flight (running tools, a streaming reply).
  const live = createSource<LiveState>({})
  // Per Session, the ask_user and request_secret calls its transcript draws; the
  // docks carry the cards of the other calls.
  const cards = createSource<CardsState>({})
  // Edited dock cards keep their component when history arrives. This source
  // holds only request identities and counts, never drafts or secret values.
  const heldCards = createSource<CardsState>({})
  // Per Session, the first visible time and the end time of each turn the transcript
  // has rendered; time separators compare one turn's end with the next turn's start.
  const turnClock = createSource<TurnClockState>({})
  let activityKey = '{}'
  // Per Bot, its latest memory change, and `seen`: when this window first saw it, or 0
  // for a change made before the window opened, which is no news.
  const memoryNews = createSource<Record<string, MemoryNews>>({})
  let memoryNewsKey: string | undefined
  const noteMemoryNews = (next: Record<string, MemoryNews>): void => {
    const key = JSON.stringify(next)
    if (key === memoryNewsKey) return
    const opening = memoryNewsKey === undefined
    memoryNewsKey = key
    memoryNews.set(state => Object.fromEntries(Object.entries(next).map(([id, entry]): [string, MemoryNews] => {
      const previous = state[id]
      return [id, previous !== undefined && previous.at === entry.at ? previous : { ...entry, seen: opening ? 0 : Date.now() }]
    })))
  }
  const PREFS_KEY = STORAGE.prefs
  let savedPrefs: Record<string, unknown> = {}
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    if (saved !== null && typeof saved === 'object') savedPrefs = saved as Record<string, unknown>
  } catch { savedPrefs = {} }
  const writeUnread = (id: string, value: boolean): void => {
    const unread = unreadStore.update(marks => setUnread(marks, id, value), ui.getSnapshot().unread ?? {})
    ui.set(state => (JSON.stringify(state.unread) === JSON.stringify(unread) ? state : { ...state, unread }))
  }
  const refreshed = new Set<string>()
  // Pulls can overlap (the poll and a navigation); an older answer never wins.
  let pulls = 0
  let applied = 0
  const pull = async (full = false): Promise<void> => {
    const order = ++pulls
    const known = snapshot()
    const value = await call<StateAnswer>('state', { since: full ? -1 : known.revision, models: known.modelsKey ?? '', locale: language() })
    if (order < applied) return
    applied = order
    const nextActivity = JSON.stringify(value.activity ?? {})
    if (nextActivity !== activityKey) { activityKey = nextActivity; activity.set(value.activity ?? {}) }
    const nextWork = JSON.stringify(value.work ?? null)
    if (nextWork !== workKey) { workKey = nextWork; work.set(value.work ?? { bots: {}, approvals: [] }) }
    noteMemoryNews(value.memoryNews ?? {})
    const current = snapshot()
    // Connector and capability states change without a new revision.
    const live: { connectors?: unknown; capabilityStatuses?: Record<string, unknown>; capabilityTools?: Record<string, readonly string[]> } = {}
    if (value.connectors !== undefined && JSON.stringify(value.connectors) !== JSON.stringify(current.connectors ?? [])) live.connectors = value.connectors
    if (value.capabilityStatuses !== undefined && JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})) live.capabilityStatuses = value.capabilityStatuses
    if (value.capabilityTools !== undefined && JSON.stringify(value.capabilityTools) !== JSON.stringify(current.capabilityTools ?? {})) live.capabilityTools = value.capabilityTools
    if (Object.keys(live).length > 0 && current.ready) roster.set({ ...current, ...live })
    if (value.unchanged || (value.revision === current.revision && value.modelsKey === current.modelsKey)) return
    // On a browser with no visit record yet, everything already there counts as seen.
    if (Object.keys(seenAt).length === 0) leaveVisits([...value.bots, ...value.rooms].map(entry => entry.id))
    // `indexRoster` only adds the id maps: the host's own rows pass through unchanged,
    // and the local view names the fields the team surface reads from them.
    roster.set(indexRoster(value) as unknown as ClientRosterSnapshot)
    try {
      const ids = (value.agents ?? []).flatMap(agent => agent.sessions ?? [])
      localStorage.setItem(STORAGE.agentSessions, JSON.stringify(ids))
      agentSessionCache = new Set(ids)
    } catch { /* storage unavailable */ }
    // Adopted ids are known by the roster now; ones gone from the list were archived.
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
        showReconnectNotice(retryNotice(failures))
        // The next good poll asks for the whole team, so changes made while the window
        // could not reach the host are not missed.
        if (failures >= RETRY_AFTER) force = true
      } finally { running = false }
      if (!stopped) timer = setTimeout(loop, document.hidden ? 10000 : 1500)
    }
    const wake = (): void => { if (!document.hidden) void loop() }
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

  // Plugin updates: every window that opens asks the host once (the host keeps its
  // answer for a while), again each hour, and every two seconds while installing.
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
    updateWake = () => { void loop() }
    void loop()
    return () => { stopped = true; clearTimeout(timer); updateWake = () => {} }
  }, 'moon-bot: update check')

  // The packaged app updates through its own updater; what that updater found is kept
  // beside the service's answer so one card can show both.
  const appUpdates = window.dshDesktop?.protocolVersion === 1 ? window.dshDesktop.updates ?? null : null
  if (appUpdates?.status && appUpdates.subscribe) {
    ctx.effect(() => {
      let stopped = false
      const take = (app: DshAppUpdate | undefined): void => { if (!stopped && app) update.set(previous => ({ ...previous, app })) }
      void appUpdates.status().then(take, () => {})
      const unsubscribe = appUpdates.subscribe(take)
      return () => { stopped = true; unsubscribe?.() }
    }, 'moon-bot: app update status')
  }

  // Bot browsers need the Desktop shell's webview bridge, and the host serves
  // read_browser only in the Desktop profile (`browser` in the state).
  const bridge = window.dshDesktop?.protocolVersion === 1 ? window.dshDesktop.browser ?? null : null
  const browsers = bridge ? createBotBrowsers({ bridge, createSource }) : null
  if (browsers) {
    ctx.effect(() => {
      let stopReads: Disposer | null = null
      const sync = (): void => {
        const current = snapshot()
        if (!current.ready) return
        const on = current.browser === true
        if (on && !stopReads) stopReads = serveBrowserReads({ browsers, post: call })
        if (!on && stopReads) { stopReads(); stopReads = null }
        // A Bot deleted here or in another window takes its guests and saved tabs along.
        void browsers.retain(current.bots.map(bot => bot.id))
        // A panel open on the browser view without a browsable subject falls back
        // to the details view.
        ui.set(state => (state.details && state.view === 'browser' && (!on || !current.byId[state.details]) ? { ...state, view: 'details' } : state))
      }
      sync()
      const offRoster = roster.subscribe(sync)
      return () => { offRoster(); stopReads?.(); browsers.dispose() }
    }, 'moon-bot: Bot browsers')
  }

  ctx.effect(() => () => { markupCache.clear() }, 'moon-bot: character markup')

  const agentSessions = (agentId: string): string[] => {
    const ids = [...(snapshot().agentsById[agentId]?.sessions ?? [])]
    for (const [id, owner] of pendingAdopt) if (owner === agentId && !ids.includes(id)) ids.push(id)
    return ids
  }
  const mainView = (): string | undefined => Object.values(ctx.sessions.list.getSnapshot().byId ?? {}).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id
  const browserPages = browsers?.pages ?? createSource<BrowserPages>({})
  const browserTabs = browsers?.tabs ?? createSource<BrowserTabsMap>({})

  return {
    roster, ui, surface, activity, work, live, cards, heldCards, turnClock, memoryNews, update,
    reactionStore, savedPrefs, browsers, browserPages, browserTabs, appUpdates, pendingAdopt, navigation,
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

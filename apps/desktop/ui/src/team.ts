// The team as the window keeps it: the Bot views' own sources and actions, fed by the
// service's `state` endpoint and live feed. The views also read a few facts that the
// plugin host used to keep for them; here the window keeps those as well.
import { useRef, useSyncExternalStore } from 'react'
import { call } from '../../../../packages/core/src/client/api.ts'
import { workPhrase } from '../../../../packages/core/src/client/cells.ts'
import { language, t } from '../../../../packages/core/src/client/i18n.ts'
import { toolState } from '../../../../packages/core/src/client/mark.tsx'
import { noteLeft, setUnread, sharedMap, toggleReaction } from '../../../../packages/core/src/client/shared-map.ts'
import { createSource, indexRoster, type Source } from '../../../../packages/core/src/client/sources.ts'
import {
  EMPTY_SNAPSHOT,
  type CardsState,
  type ClientRosterSnapshot,
  type ClientUiState,
  type LiveState,
  type MemoryNews,
  type StateAnswer,
  type TurnClockState,
} from '../../../../packages/core/src/client/client-types.ts'
import type { ReactionMap } from '../../../../packages/core/src/client/shared-map.ts'
import { STORAGE, migrateStorage } from '../../../../packages/core/src/client/storage.ts'
import { teamActions } from '../../../../packages/core/src/client/team-actions.ts'
import { currentPart } from '../../../../packages/core/src/client/text.ts'
import { registry } from '../../../../packages/core/src/client/themes.ts'
import { retryNotice, showReconnectNotice } from '../../../../packages/core/src/client/reconnect.ts'
import type {
  CellActions,
  CellsUiState,
  EarlierPage,
  RoomProgress,
} from '../../../../packages/core/src/client/cells-bubbles.tsx'
import type { StoreHook } from '../../../../packages/core/src/client/cells-bubbles.tsx'
import { openFeed } from './api.ts'

// Memory news and connector states change without a notice on the feed.
const CATCH_UP_MS = 15_000
const READ_AGAIN: ReadonlySet<string> = new Set(['hello', 'revision', 'live'])
const NO_WORK = { bots: {}, approvals: [] }

type Json = Record<string, unknown>

/** What a feed listener receives. */
type FeedHandler = (event: string, data: Json) => void

/** The state a Bot's chat reads while a turn runs. */
interface SessionStatus {
  running?: boolean
  completionUnread?: boolean
  [key: string]: unknown
}

interface SentEntry {
  placement: string
  time: number
}

interface SessionList {
  ids: readonly string[]
  byId: Record<string, Json>
}

// A selection from a source. The value is kept per snapshot and selector, so React reads
// one value until the source changes.
function useSelect<T, U>(source: Source<T>, selector: (value: T) => U): U {
  const kept = useRef<{ snapshot: T; selector: (value: T) => U; value: U } | null>(null)
  const read = (): U => {
    const snapshot = source.getSnapshot()
    const last = kept.current
    if (last !== null && last.snapshot === snapshot && last.selector === selector) return last.value
    const value = selector(snapshot)
    kept.current = { snapshot, selector, value: last !== null && Object.is(last.value, value) ? last.value : value }
    return kept.current.value
  }
  return useSyncExternalStore(source.subscribe, read)
}

function createBus(): { on: (listener: FeedHandler) => () => void; emit: FeedHandler } {
  const listeners = new Set<FeedHandler>()
  return {
    on(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(event, data) {
      for (const listener of listeners) listener(event, data)
    },
  }
}

const setChanged = <T>(source: Source<T>, value: T): void => {
  if (JSON.stringify(source.getSnapshot()) !== JSON.stringify(value)) source.set(value)
}

export type Team = ReturnType<typeof createTeam>

// The views' prop types name the slice they read (and its store hooks) by their own
// narrower shapes; the window hands over the same behaviour at the boundary.
/** The shared action set as one view's own, narrower interface. */
export const asActions = <T>(actions: object): T => actions as unknown as T

/** The window's hooks and actions as the props one view declares. */
export const asViews = <T>(views: object): T => views as unknown as T

export function createTeam() {
  migrateStorage()
  const unreadStore = sharedMap<Record<string, boolean>>(STORAGE.unread)
  const reactionStore = sharedMap<ReactionMap>(STORAGE.reactions)
  // When each conversation was last left; a visit compares new entries against it.
  const seenStore = sharedMap<Record<string, number>>(STORAGE.seen)
  let seenAt = seenStore.read()
  const roster = createSource<ClientRosterSnapshot>(EMPTY_SNAPSHOT)
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
  const activity = createSource<Json>({})
  const work = createSource<Json>(NO_WORK)
  const memoryNews = createSource<Record<string, MemoryNews>>({})
  const live = createSource<LiveState>({})
  const cards = createSource<CardsState>({})
  const heldCards = createSource<CardsState>({})
  const turnClock = createSource<TurnClockState>({})
  const update = createSource({ available: false, phase: 'idle' })
  const browserPages = createSource<Json>({})
  const browserTabs = createSource<Json>({})
  const layout = createSource({ wide: true })
  // The Session facts: the list (each one's latest entry and change, and which one fills
  // the main view), the status (running, a reply not yet seen) and what was just sent.
  const sessions = createSource<SessionList>({ ids: [], byId: {} })
  const status = createSource<Map<string, SessionStatus>>(new Map())
  const sent = createSource<Record<string, SentEntry[]>>({})
  const shown = createSource<string | null>(null)
  const chat = createBus()

  const editRow = (id: string, edit: (row: Json) => Json): void => {
    sessions.set(list => {
      const row = list.byId[id] ?? { id }
      return { ids: list.ids.includes(id) ? list.ids : [...list.ids, id], byId: { ...list.byId, [id]: edit(row) } }
    })
  }
  const setStatus = (id: string, patch: SessionStatus): void => {
    status.set(map => {
      const entry = map.get(id) ?? {}
      if (Object.entries(patch).every(([key, value]) => (entry[key] ?? false) === value)) return map
      return new Map(map).set(id, { ...entry, ...patch })
    })
  }
  const show = (id: string): void => {
    if (shown.getSnapshot() === id) return
    const before = shown.getSnapshot()
    shown.set(id)
    if (before !== null) editRow(before, row => ({ ...row, retainedBy: { mainView: 0 } }))
    editRow(id, row => ({ ...row, retainedBy: { mainView: 1 } }))
    setStatus(id, { completionUnread: false })
  }

  let newsKey: string | undefined
  const noteNews = (next: Json): void => {
    const key = JSON.stringify(next)
    if (key === newsKey) return
    const opening = newsKey === undefined
    newsKey = key
    memoryNews.set(
      state =>
        Object.fromEntries(
          Object.entries(next).map(([id, entry]) => {
            const news = entry as MemoryNews
            return [id, state[id]?.at === news.at ? state[id] : { ...news, seen: opening ? 0 : Date.now() }]
          }),
        ) as Record<string, MemoryNews>,
    )
  }
  const seenKey = (id: string): string => {
    const bot = (roster.getSnapshot().byId as Record<string, { id?: string } | undefined>)[id]
    return bot?.id ?? id
  }
  const leaveVisits = (ids: readonly string[]): void => {
    seenAt = seenStore.update(seen => noteLeft(seen, ids.map(seenKey), Date.now()), seenAt)
  }
  const writeUnread = (id: string, value: boolean): void => {
    const unread = unreadStore.update(marks => setUnread(marks, id, value), ui.getSnapshot().unread)
    ui.set(state => (JSON.stringify(state.unread) === JSON.stringify(unread) ? state : { ...state, unread }))
  }

  // Reads can overlap (the feed and a finished action); an older answer never wins.
  let pulls = 0
  let applied = 0
  const pull = async (full = false): Promise<void> => {
    const order = ++pulls
    const known = roster.getSnapshot() as Json & { revision?: number; modelsKey?: string; ready?: boolean }
    // `full` asks for the whole team again, which is what a window does after its feed was lost.
    const value = await call<StateAnswer>('state', {
      since: full ? -1 : known.revision,
      models: known.modelsKey ?? '',
      locale: language(),
    })
    if (order < applied) return
    applied = order
    setChanged(activity, value.activity ?? {})
    setChanged(work, (value.work ?? NO_WORK) as Json)
    noteNews((value.memoryNews ?? {}) as Json)
    const current = roster.getSnapshot()
    const changed: Json = {}
    if (value.connectors !== undefined && JSON.stringify(value.connectors) !== JSON.stringify(current.connectors ?? []))
      changed.connectors = value.connectors
    if (
      value.capabilityStatuses !== undefined &&
      JSON.stringify(value.capabilityStatuses) !== JSON.stringify(current.capabilityStatuses ?? {})
    )
      changed.capabilityStatuses = value.capabilityStatuses
    if (
      value.capabilityTools !== undefined &&
      JSON.stringify(value.capabilityTools) !== JSON.stringify(current.capabilityTools ?? {})
    )
      changed.capabilityTools = value.capabilityTools
    if (Object.keys(changed).length > 0 && current.ready) roster.set({ ...current, ...changed } as ClientRosterSnapshot)
    if (value.unchanged === true || (value.revision === current.revision && value.modelsKey === current.modelsKey))
      return
    // In a window with no visit record yet, everything already there counts as seen.
    if (Object.keys(seenAt).length === 0) {
      const bots = (value.bots ?? []) as readonly Json[]
      const rooms = (value.rooms ?? []) as readonly Json[]
      leaveVisits([...bots, ...rooms].map(entry => String(entry.id)))
    }
    roster.set(indexRoster(value) as unknown as ClientRosterSnapshot)
  }
  const after = <T>(promise: Promise<T>): Promise<T> =>
    promise.then(async value => {
      await pull().catch(() => {})
      return value
    })
  const partFor = (id: string): string => {
    const bot = (roster.getSnapshot().byId as Record<string, Parameters<typeof currentPart>[0] | undefined>)[id]
    return bot !== undefined ? currentPart(bot) : id
  }

  const actions = {
    ...teamActions({
      call: call as never,
      after: after as never,
      partFor,
      roster: roster as never,
      ui: ui as never,
      live: live as never,
      cards: cards as never,
      heldCards: heldCards as never,
      turnClock: turnClock as never,
    }),
    // The full-pane overlays sit above the conversation, so opening one dismisses them.
    openSession: (id: string): void => {
      ui.set(state =>
        state.newChat !== null || state.exchange !== null || state.menu !== null || state.palette !== null
          ? { ...state, newChat: null, exchange: null, menu: null, palette: null }
          : state,
      )
      show(partFor(id))
    },
    landOn: (id: string): void => {
      show(partFor(id))
    },
    toggleSidebar: (): void => {
      layout.set(state => ({ ...state, wide: !state.wide }))
    },
    markUnread: (id: string): void => {
      writeUnread(id, true)
    },
    clearUnread: (id: string): void => {
      writeUnread(id, false)
    },
    beginVisit: (id: string): void => {
      // A conversation a Bot started, never opened here, is unread from its start.
      const made =
        (roster.getSnapshot().byId as Record<string, Json | undefined>)[id] ??
        (roster.getSnapshot().roomsById as Record<string, Json | undefined>)[id]
      const createdAt = made?.createdAt
      const seen =
        seenAt[seenKey(id)] ??
        (made?.createdBy !== undefined && typeof createdAt === 'number' && Number.isFinite(createdAt)
          ? createdAt
          : null)
      ui.set(state => ({ ...state, visits: { ...(state.visits ?? {}), [id]: { seen, entered: Date.now() } } }))
    },
    endVisit: (id: string): void => {
      leaveVisits([id])
      ui.set(state => {
        const all = state.visits ?? {}
        if (!(id in all)) return state
        const visits = { ...all }
        delete visits[id]
        return { ...state, visits }
      })
    },
    toggleReaction: (key: string, index: number, emoji: string): void => {
      const reactions = reactionStore.update(
        saved => toggleReaction(saved, key, index, emoji),
        ui.getSnapshot().reactions,
      )
      ui.set(state => ({ ...state, reactions }))
    },
    // The window has no status bar, so the Bot's details show its figures.
    runStats: (botId: string): Promise<unknown> => call('run-stats', { botId }),
    // Nor a host settings page: model providers and their keys have a Models page here, and
    // a first model choice takes a missing API key itself.
    providers: (): Promise<unknown> => call('providers'),
    setProviderKey: (provider: string, value: string): Promise<unknown> =>
      after(call('provider-key', { provider, value })),
    addProvider: (body: Json): Promise<unknown> => after(call('provider-add', body)),
    providerModels: (body: Json): Promise<unknown> => call('provider-models', body),
    removeProvider: (provider: string): Promise<unknown> => after(call('provider-remove', { provider })),
    openModels: (): void => {
      actions.openSettings('models')
    },
    // The cells read these answers by their own shapes, so the window names them.
    earlier: (sessionId: string, cursor?: string | null): Promise<EarlierPage> =>
      call<EarlierPage>('earlier', { sessionId, cursor: cursor ?? null }),
    fileText: (
      file: string | undefined,
    ): Promise<{ readonly text: string; readonly whole: boolean } | null | undefined> =>
      file === undefined
        ? Promise.resolve(undefined)
        : call<{ readonly text: string; readonly whole: boolean } | null>('file-text', { file }),
    roomProgress: (sessionId: string): Promise<readonly RoomProgress[] | null | undefined> =>
      call<readonly RoomProgress[] | null>('room-progress', { sessionId }),
    // Nothing else draws in the window: no shell panels, right sidebar, "@" menu or voice plugin.
    hasRightSidebar: (): boolean => false,
    canReferenceChat: (): boolean => false,
    referenceChat: (_sessionId: string, _insertion: unknown): void => {
      /* no "@" menu in this window */
    },
    speech: (): undefined => undefined,
    voiceSetup: (): null => null,
    noteSent: (sessionId: string): void => {
      sent.set(state => ({
        ...state,
        [sessionId]: [...(state[sessionId] ?? []), { placement: 'direct', time: Date.now() }],
      }))
    },
  }

  // Running and the tool at work come with the team's state; the plugin read them from the
  // host's Session status and its own tool cells.
  const followWork = (): void => {
    const bots = (work.getSnapshot().bots ?? {}) as Record<string, Json | undefined>
    const rows = (roster.getSnapshot().bots ?? []) as readonly Parameters<typeof currentPart>[0][]
    for (const bot of rows) {
      const id = String((bot as Json).id)
      const part = currentPart(bot)
      const entry = bots[id]
      const doing = entry !== undefined && entry.roomId === undefined ? entry : undefined
      setStatus(part, { running: doing !== undefined })
      actions.noteLive(
        part,
        'tool',
        doing?.tool !== undefined
          ? { label: workPhrase(doing.tool as string), state: toolState(doing.tool as string) }
          : null,
      )
    }
  }
  roster.subscribe(followWork)
  work.subscribe(followWork)

  const onFeed: FeedHandler = (event, data) => {
    if (
      event === 'message' &&
      typeof data.sessionId === 'string' &&
      data.item !== null &&
      typeof data.item === 'object'
    ) {
      const sessionId = data.sessionId
      const item = data.item as Json
      const text = item.kind === 'bot' || item.kind === 'user' ? String(item.text ?? '') : ''
      editRow(sessionId, row => ({
        ...row,
        updatedAt: Math.max(Number(row.updatedAt ?? 0), Number(item.time ?? 0)),
        // The sidebar's preview line; turn -1 is never a hidden exchange turn.
        projectionValues:
          text !== ''
            ? { turnOutline: [{ turn: -1, [item.kind === 'bot' ? 'response' : 'prompt']: text }] }
            : row.projectionValues,
      }))
      if (item.kind === 'bot' && shown.getSnapshot() !== sessionId) setStatus(sessionId, { completionUnread: true })
      if (item.kind === 'user')
        sent.set(state =>
          (state[sessionId]?.length ?? 0) > 0 ? { ...state, [sessionId]: (state[sessionId] ?? []).slice(1) } : state,
        )
    }
    // While a reply streams in, it stands in for the activity row.
    if (event === 'stream' && typeof data.sessionId === 'string') {
      actions.noteLive(data.sessionId, 'reply', data.phase === undefined && data.text ? { text: true } : null)
    }
    chat.emit(event, data)
  }

  const start = (): (() => void) => {
    let stopped = false
    const read = (full = false): void => {
      void pull(full).catch((error: unknown) => {
        if (stopped) return
        console.warn('[moon-bot] state', error)
        if (!roster.getSnapshot().ready)
          actions.reportError(error instanceof Error ? error : new Error(String(error)), 'state')
      })
    }
    read()
    // The window's only feed is this one: when it drops, the page is stale, so say so at
    // the top and catch the team up as soon as the feed is back.
    let feedFailures = 0
    let hideNotice: ReturnType<typeof setTimeout> | undefined
    const closeFeed = openFeed((event, data) => {
      const recovered = feedFailures > 0
      if (event === 'lost') {
        feedFailures += 1
        showReconnectNotice(retryNotice(feedFailures), () => read(true))
      } else if (recovered) {
        feedFailures = 0
        // A lost feed leaves the page stale: the first read after it asks for the whole
        // team, not just what changed since the revision this window last saw.
        clearTimeout(hideNotice)
        showReconnectNotice(t('Back online. Catching up…'))
        hideNotice = setTimeout(() => {
          showReconnectNotice(null)
        }, 1500)
      }
      if (READ_AGAIN.has(event)) read(recovered)
      onFeed(event, data)
    })
    const timer = setInterval(read, CATCH_UP_MS)
    const onPageHide = (): void => {
      leaveVisits(Object.keys(ui.getSnapshot().visits ?? {}))
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      stopped = true
      closeFeed()
      showReconnectNotice(null)
      clearTimeout(hideNotice)
      clearInterval(timer)
      window.removeEventListener('pagehide', onPageHide)
    }
  }

  // The cells read the shared actions by their own, narrower signatures; the window's set
  // is the same behaviour with a few more members.
  const cellActions = asActions<CellActions>(actions)
  // The cells read the UI store by their own shape too (reactions per message, visits
  // keyed by part); the window's store keeps the same facts in its own shape.
  const cellUi = <U>(selector: (value: CellsUiState) => U): U => useSelect(ui, selector as (value: ClientUiState) => U)

  const use =
    <T>(source: Source<T>) =>
    <U>(selector: (value: T) => U): U =>
      useSelect(source, selector)
  const hooks = {
    useRoster: use(roster),
    useUi: use(ui),
    useActivity: use(activity),
    useWork: use(work),
    useMemoryNews: use(memoryNews),
    useLive: use(live),
    useCards: use(cards),
    useTurnClock: use(turnClock),
    useUpdate: use(update),
    useRegistry: use(registry),
    useBrowserPages: use(browserPages),
    useBrowserTabs: use(browserTabs),
    useSessions: use(sessions),
    useSessionStatus: use(status),
    useSessionRetainInfo: <U>(id: string, selector: (value: Json | undefined) => U): U =>
      useSelect(sessions, (list: SessionList) => selector(list.byId[id])),
    useLayout: use(layout),
    useShown: use(shown),
  }
  // The Session one view shows, as the host hands it to a view: what was just sent there.
  const sessionHook =
    (sessionId: string) =>
    <U>(selector: (value: { pendingSubmissions: readonly SentEntry[] }) => U): U =>
      useSelect(sent, state => selector({ pendingSubmissions: state[sessionId] ?? [] }))
  return { actions, cellActions, cellUi: cellUi as StoreHook<CellsUiState>, hooks, sessionHook, chat, start }
}

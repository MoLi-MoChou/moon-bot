import { countCards, heldCardKey } from './sources.ts'
import { noteClientError } from './diagnostics.ts'

// The actions every window that draws the Bot views shares: dialogs and panels (the `ui`
// source), requests to the host, and the notes the transcript keeps. The shell around the
// views adds navigation and its own panels. `after` reads the team again once a request
// is done; `partFor` maps a Bot id, or any part of its chat, to its current part.
// The windows' shared UI state: the overlays a view can open, and the toast a failed
// action away from a form shows.
export interface UiState {
  newChat?: string | null | undefined
  palette?: { token: number; query?: string } | null | undefined
  exchange?: [string, string] | null | undefined
  voice?: string | null | undefined
  details?: string | null | undefined
  view?: string | undefined
  renaming?: boolean | undefined
  tab?: string | null | undefined
  settings?: { page?: string; id?: string | null } | null | undefined
  memory?: string | null | undefined
  menu?: unknown
  quote?: { sessionId: string; text: string; token: number } | null | undefined
  toast?: { text: string; token: number } | null | undefined
}
interface Store<T> {
  getSnapshot: () => T
  set: (update: T | ((previous: T) => T)) => void
}
interface RosterSnapshot {
  byId?: Record<string, { id?: string } | undefined>
  roomsById?: Record<string, { id?: string } | undefined>
}
// The actions only read the roster; the window that owns it does the writing.
interface RosterReader {
  getSnapshot: () => RosterSnapshot
}
// One live entry of a turn: a tool or thinking note, with the time it began.
interface LiveEntry { at?: number; text?: true; thinking?: true; relay?: true; label?: string | null; state?: string; [key: string]: unknown }
type Cards = Record<string, Record<string, number>>
type TurnClock = Record<string, Record<string, Record<string, number | string | undefined>>>
export interface TeamActionsDeps {
  call: (endpoint: string, payload?: unknown) => Promise<unknown>
  after: (work: Promise<unknown>) => Promise<unknown>
  partFor: (id: string) => string
  roster: RosterReader
  ui: Store<UiState>
  live: Store<Record<string, Record<string, LiveEntry>>>
  cards: Store<Cards>
  heldCards: Store<Cards>
  turnClock: Store<TurnClock>
}

export function teamActions({ call, after, partFor, roster, ui, live, cards, heldCards, turnClock }: TeamActionsDeps) {
  // A memory is a Bot's or a group chat's; both are opened by id.
  const memoryOf = (id: string) => (roster.getSnapshot().roomsById?.[id] ? { roomId: id } : { botId: id })
  return {
    openNewChat: (mode: string) => { ui.set(state => ({ ...state, newChat: mode, menu: null, palette: null })) },
    openPalette: (query = '') => { ui.set(state => ({ ...state, palette: { query, token: Date.now() }, newChat: null, menu: null })) },
    // The token keeps a late exit timer from closing a palette opened again since.
    closePalette: (token?: number) => { ui.set(state => (state.palette && (token === undefined || state.palette?.token === token) ? { ...state, palette: null } : state)) },
    openExchange: (a: string | null | undefined, b: string | null | undefined) => { if (a && b) ui.set(state => ({ ...state, exchange: [a, b] })) },
    openVoice: (id: string | undefined) => { if (id) ui.set(state => ({ ...state, voice: id, menu: null })) },
    closeVoice: () => { ui.set(state => (state.voice ? { ...state, voice: null } : state)) },
    toggleDetails: (id: string, force?: boolean) => {
      ui.set((state) => {
        const details = force || state.details !== id || state.view !== 'details' ? id : null
        return { ...state, renaming: false, tab: null, details, view: 'details' }
      })
    },
    // The open panel follows the main view; a subject with no browser (a group
    // chat, an outside Session) settles on the details view.
    followPanel: (id: string) => {
      ui.set((state) => {
        if (!state.details || state.details === id) return state
        const view = state.view === 'browser' && roster.getSnapshot().byId?.[id] === undefined ? 'details' : state.view
        return { ...state, details: id, view, renaming: false, tab: null }
      })
    },
    showDetails: (id: string, tab: string | null = null) => { ui.set(state => ({ ...state, details: id, view: 'details', renaming: false, tab })) },
    // Opening the conversation would move focus to its composer and blur the name field.
    renameBot: (id: string) => { ui.set(state => ({ ...state, details: id, view: 'details', renaming: true, tab: null })) },
    // `id` opens one Bot (page 'bots') or one group chat (page 'groups').
    openSettings: (page = 'general', id: string | null = null) => { ui.set(state => ({ ...state, settings: { page, id }, menu: null, palette: null, newChat: null })) },
    closeSettings: () => { ui.set(state => (state.settings ? { ...state, settings: null } : state)) },
    openMemory: (id: string) => { ui.set(state => ({ ...state, memory: id, menu: null, palette: null })) },
    closeMemory: () => { ui.set(state => (state.memory ? { ...state, memory: null } : state)) },
    openConnectors: () => { ui.set(state => ({ ...state, settings: { page: 'connectors', id: null }, menu: null, palette: null, newChat: null })) },
    setPanelView: (view: string) => {
      if (view !== 'details' && view !== 'browser') return
      ui.set(state => (state.details && state.view !== view ? { ...state, view } : state))
    },
    closePanel: () => { ui.set(state => (state.details ? { ...state, details: null, view: 'details', renaming: false, tab: null } : state)) },
    quote: (sessionId: string, text: string) => ui.set(state => ({ ...state, quote: { sessionId, text, token: Date.now() } })),
    clearQuote: (token: number) => ui.set(state => (state.quote?.token === token ? { ...state, quote: null } : state)),
    setFlags: (id: string, flags: Record<string, boolean>) => after(call('set-flags', { id, ...flags })),
    deleteRoom: (id: string) => after(call('delete-room', { id })),
    openMenu: (menu: unknown) => { ui.set(state => ({ ...state, menu })) },
    closeMenu: () => { ui.set(state => (state.menu ? { ...state, menu: null } : state)) },
    closeOverlay: () => { ui.set(state => ({ ...state, newChat: null, exchange: null, details: state.newChat || state.exchange ? state.details : null })) },
    createBot: (payload: Record<string, unknown>) => after(call('create-bot', payload)),
    createRoom: (members: readonly string[], options: Record<string, unknown> = {}) => after(call('create-room', { members, ...options })),
    updateBot: (id: string, patch: Record<string, unknown>) => after(call('update-bot', { id, ...patch })),
    refreshModels: () => after(call('models')).catch(() => {}),
    refreshEngines: () => after(call('engines')).then(value => value as { engines: readonly Record<string, unknown>[]; of: Readonly<Record<string, string>> }).catch(() => ({ engines: [], of: {} })),
    efforts: (ref: string) => call('efforts', { ref }),
    runStats: (botId: string) => call('run-stats', { botId }),
    folders: () => call('folders'),
    folderPick: () => call('folder-pick'),
    folderList: (path: string | undefined) => call('folder-list', { path: path ?? '' }),
    setTeamWorkspace: (path: string) => after(call('team-workspace', { path })),
    deleteBot: (id: string) => after(call('delete-bot', { id })),
    duplicateBot: (id: string) => after(call('duplicate-bot', { id })),
    setPrefs: (prefs: Record<string, unknown>) => after(call('set-prefs', prefs)),
    setMain: (id: string, main = true, options: Record<string, unknown> = {}) => after(call('set-main', { id, main, ...options })),
    updateRoom: (id: string, patch: Record<string, unknown>) => after(call('update-room', { id, ...patch })),
    send: (sessionId: string, text: string) => after(call('send', { sessionId: partFor(sessionId), text })),
    answerQuestion: (sessionId: string, questionId: string, answer: unknown) => after(call('answer-question', { sessionId: partFor(sessionId), questionId, answer })),
    dismissQuestion: (sessionId: string) => after(call('dismiss-question', { sessionId })),
    answerView: (sessionId: string, viewId: string, action: string, values: unknown) => after(call('view-reply', { sessionId: partFor(sessionId), viewId, action, values })),
    dismissView: (sessionId: string) => after(call('dismiss-view', { sessionId: partFor(sessionId) })),
    answerApproval: (id: string, choice: string) => after(call('approval-answer', { id, choice })),
    stopMemberWork: (roomId: string, botId: string) => after(call('stop-member-work', { roomId, botId })),
    // Values go out in these requests and never come back in a response.
    secretSet: (payload: Record<string, unknown>) => after(call('secret-set', payload)),
    secretAllow: (requestId: string) => after(call('secret-allow', { requestId })),
    secretCancel: (requestId: string) => after(call('secret-cancel', { requestId })),
    secretUpdate: (name: string, scope: unknown) => after(call('secret-update', { name, scope })),
    secretDelete: (name: string) => after(call('secret-delete', { name })),
    connectorConnect: (id: string, token: string) => after(call('connector-connect', { id, token })),
    connectorDisconnect: (id: string) => after(call('connector-disconnect', { id })),
    connectorRetry: (id: string) => after(call('connector-retry', { id })),
    tasks: () => call('tasks').then(value => value as { running: readonly Record<string, unknown>[]; completed: readonly Record<string, unknown>[]; waiting: readonly Record<string, unknown>[] }),
    stopTask: (sessionId: string) => after(call('task-stop', { sessionId })),
    relayInvites: () => call('relay-invites').then(value => value as { invites: readonly { agentId: string; createdAt: number; revokedAt: number | null; lastSeenAt: number | null; online: boolean }[] }),
    relayInviteCreate: (agentId: string) => call('relay-invite-create', { agentId }).then(value => value as { agentId: string; token: string }),
    relayInviteRevoke: (agentId: string) => call('relay-invite-revoke', { agentId }).then(value => value as { invites: readonly { agentId: string; createdAt: number; revokedAt: number | null; lastSeenAt: number | null; online: boolean }[] }),
    saveCapability: (capability: Record<string, unknown>) => after(call('capability-save', capability)),
    deleteCapability: (name: string) => after(call('capability-delete', { name })),
    approveCapability: (name: string) => after(call('capability-approve', { name })),
    setBotCapability: (botId: string, name: string, attached: boolean) => after(call('bot-capability', { botId, name, attached })),
    schedules: () => call('schedules'),
    scheduleCreate: (task: Record<string, unknown>) => call('schedule-create', task),
    scheduleDelete: (sessionId: string, id: string) => call('schedule-delete', { sessionId, id }),
    exchange: (a: string, b: string) => call('exchange', { a, b }).catch(() => []),
    exchangeText: (id: string) => call('exchange-text', { id }).catch(() => undefined),
    fileText: (file: string) => call('file-text', { file }).catch(() => undefined),
    roomProgress: (roomId: string) => call('room-progress', { roomId }).catch(() => []),
    earlier: (sessionId: string, cursor: string | null | undefined) => call('earlier', { sessionId, cursor: cursor ?? null }),
    // Hours come back in this browser's time zone, so days start at local midnight.
    usage: () => call('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    // `summarize` starts a summary when the entries changed; `regenerate` always does.
    memoryView: (id: string, flags: Record<string, unknown> = {}) => call('memory-view', { ...memoryOf(id), ...flags }),
    memoryAsk: (id: string, text: string) => call('memory-ask', { ...memoryOf(id), text }),
    memoryForget: (id: string, entry: { scope?: string; topic?: string; text?: string }) => call('memory-forget', { ...memoryOf(id), scope: entry.scope, topic: entry.topic, text: entry.text }),
    diagnostics: (payload: Record<string, unknown>) => call('diagnostics', payload),
    diagnosticsLog: () => call('diagnostics-log'),
    diagnosticsClear: () => call('diagnostics-clear'),
    repoStars: () => call('repo-stars'),
    // A failed action away from any form (a menu, the palette) shows as a toast.
    reportError: (error: { message?: string } | null | undefined, where = 'action') => {
      noteClientError(where, error)
      ui.set(state => ({ ...state, toast: { text: error?.message ?? String(error), token: Date.now() } }))
    },
    dismissToast: (token?: number) => ui.set(state => (state.toast && (token === undefined || state.toast?.token === token) ? { ...state, toast: null } : state)),
    noteTurnTime: (sessionId: string | undefined, turn: number, key: string, time: number) => {
      if (sessionId === undefined || !Number.isFinite(turn) || !Number.isFinite(time)) return
      turnClock.set((state) => {
        const turns = state[sessionId] ?? {}
        const entry = turns[turn] ?? {}
        const first = entry.first
        const next = key === 'first' && typeof first === 'number' ? Math.min(first, time) : time
        if (entry[key] === next) return state
        return { ...state, [sessionId]: { ...turns, [turn]: { ...entry, [key]: next } } }
      })
    },
    noteTurnPeer: (sessionId: string | undefined, turn: number, peerId: string) => {
      if (sessionId === undefined || !Number.isFinite(turn)) return
      turnClock.set((state) => {
        const turns = state[sessionId] ?? {}
        const entry = turns[turn] ?? {}
        if (entry.peer === peerId) return state
        return { ...state, [sessionId]: { ...turns, [turn]: { ...entry, peer: peerId } } }
      })
    },
    noteLive: (sessionId: string | undefined, id: string, entry: LiveEntry | null) => {
      if (sessionId === undefined) return
      live.set((state) => {
        const own = state[sessionId] ?? {}
        const prev = own[id]
        if (entry === null ? prev === undefined : prev !== undefined && JSON.stringify({ ...prev, at: 0 }) === JSON.stringify({ ...entry, at: 0 })) return state
        const next = { ...own }
        if (entry === null) delete next[id]
        else next[id] = { ...entry, at: prev?.at ?? Date.now() }
        return { ...state, [sessionId]: next }
      })
    },
    noteCards: (sessionId: string | undefined, callIds: readonly string[], delta: number) => {
      if (sessionId !== undefined) cards.set(state => countCards(state, sessionId, callIds, delta))
    },
    noteHeldCard: (sessionId: string | undefined, kind: string, requestId: string, delta: number) => {
      if (sessionId !== undefined) heldCards.set(state => countCards(state, sessionId, [heldCardKey(kind, requestId)], delta))
    },
    clearLive: (sessionId: string) => live.set((state) => {
      if (!state[sessionId]) return state
      const next = { ...state }
      delete next[sessionId]
      return next
    }),
  }
}

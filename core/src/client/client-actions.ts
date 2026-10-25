// The actions every rendered Bot view drives: navigation, the panels, the browser tabs,
// sign-in and the update cards. `apply` builds them once over the client state; the slot
// components receive them through `inject`, so their types here are the shapes a view reads.

import { call } from './api.ts'
import { CHATS_SOURCE } from './at-menu.ts'
import type { ClientState, UpdateState } from './client-types.ts'
import type { AtMenuSlot, ClientContext, SlotEntry, SpeechRemote } from './client-ctx.js'
import type { PanelRect } from './bot-browsers.ts'
import { sameVersion } from './update-state.ts'
import { openShellOnboardingPanel, openShellSettingsPanel } from './sidebar.tsx'
import { toggleReaction } from './shared-map.ts'
import { VOICE_BUNDLE } from './speech.ts'
import { writeMode } from './surface.ts'
import { teamActions } from './team-actions.ts'
import { currentPart } from './text.ts'

/** What `add-agent` answers: the Sessions the new Agent already owns. */
interface AgentCreated {
  sessions?: readonly string[] | undefined
}
/** The Bot conversation a view held before it cleared, for `landOn`. */
export interface LandedConversation {
  botId: string
  sessionId: string
}

export interface ClientActionExtras {
  isAgentSession(id: string | null | undefined): boolean
  openSession(id: string): void
  openAgentSession(sessionId: string): void
  addAgent(): Promise<unknown>
  openAgent(agentId: string): void
  newAgentSession(agentId: string): Promise<string | undefined>
  archiveAgentSession(agentId: string, sessionId: string): Promise<void>
  renameAgentSession(agentId: string, sessionId: string, title: string): Promise<unknown>
  beginAgentRename(sessionId: string): void
  endAgentRename(): void
  removeAgent(agentId: string): Promise<unknown>
  landOn(id: string, last?: LandedConversation | null): Promise<void>
  selectPanel(id: string): void
  toggleSidebar(): void
  setSurface(mode: string): void
  markUnread(id: string): void
  beginVisit(id: string): void
  endVisit(id: string): void
  toggleReaction(key: string, index: number, emoji: string): void
  clearUnread(id: string): void
  hasRightSidebar(): boolean
  toggleRightSidebar(): void
  // Without the Desktop browser bridge these stay undefined, and no browser control renders.
  openBrowser?(id: string): void
  browserNewTab?(id: string): string | null
  browserPick?(id: string, tabId: string): void
  browserEnsure?(botId: string): void
  browserCloseTab?(botId: string, tabId: string): Promise<void>
  browserActivate?(botId: string, tabId: string): void
  browserShow?(tabId: string, box?: PanelRect | null): Promise<void>
  browserNavigate?(tabId: string, input: string): Promise<boolean>
  browserCommand?(tabId: string, name: string): void
  browserFocus?(tabId: string): void
  // The account launcher's seat, sign-in, the Voice plugin and the update cards.
  signInEntry(): SlotEntry | null
  canSignIn(): boolean
  signIn(): void
  closeSignIn(): void
  accountT(): (key: string, params?: Record<string, unknown>) => string
  speech(): SpeechRemote | undefined
  openShellSettingsPanel(section?: string): void
  openShellOnboardingPanel(id?: string): void
  voiceSetup(): (() => void) | null
  seatAccount(on: boolean): void
  installUpdate(): Promise<void>
  openAppUpdates(verified: string): Promise<void>
  checkUpdate(): Promise<void>
  canReferenceChat(): boolean
  referenceChat(sessionId: string, span: unknown): void
}

export type ClientActions = ReturnType<typeof teamActions> & ClientActionExtras

export interface ClientActionsDeps {
  ctx: ClientContext
  client: ClientState
  /** Reads the team again once a request is done. */
  after: <T>(work: Promise<T>) => Promise<T>
  /** A Bot id, or any part of its chat, opens the Bot's current part. */
  partFor(id: string): string
  /** Opens a Session in the shell's main view, waiting for its list when needed. */
  show(target: string): void
  atMenu: AtMenuSlot
}

export function createActions({ ctx, client, after, partFor, show, atMenu }: ClientActionsDeps): ClientActions {
  const { roster, ui, surface, live, cards, heldCards, turnClock, update, browsers, appUpdates } = client
  const actions: ClientActions = {
    ...teamActions({ call, after, partFor, roster, ui, live, cards, heldCards, turnClock }),
    // The full-pane overlays sit above the conversation, so opening one must dismiss them
    // or the click appears to do nothing.
    isAgentSession: id => client.isAgentSessionId(id),
    openSession: (id) => {
      // A DSH Agent Session id lands on the plain surface, not the Bot skin.
      if (client.isAgentSessionId(id)) { actions.openAgentSession(id); return }
      ui.set(state => (state.newChat || state.exchange || state.menu || state.palette ? { ...state, newChat: null, exchange: null, menu: null, palette: null } : state))
      client.setPlain(false)
      const target = partFor(id)
      show(target)
    },
    // The conversation replacements withdraw for a plain Session; set the surface
    // before the navigation so the Bot skin never flashes.
    openAgentSession: (sessionId) => {
      ui.set(state => ({ ...state, newChat: null, exchange: null, menu: null, palette: null, details: null, view: 'details', renaming: false, tab: null }))
      client.setPlain(true)
      show(sessionId)
    },
    addAgent: async () => {
      const agent = await after(call<AgentCreated>('add-agent'))
      const first = agent?.sessions?.[0]
      if (first !== undefined) actions.openAgentSession(first)
      return agent
    },
    openAgent: (agentId) => {
      const agent = roster.getSnapshot().agentsById[agentId]
      if (agent === undefined) return
      const list = ctx.sessions.list.getSnapshot()
      const recent = client.agentSessions(agentId).sort((a, b) => (list.byId?.[b]?.updatedAt ?? 0) - (list.byId?.[a]?.updatedAt ?? 0))
      const first = recent[0]
      if (first === undefined) return actions.newAgentSession(agentId)
      actions.openAgentSession(first)
    },
    newAgentSession: async (agentId) => {
      const agent = roster.getSnapshot().agentsById[agentId]
      if (agent === undefined) return undefined
      const list = ctx.sessions.list.getSnapshot()
      const recent = client.agentSessions(agentId).sort((a, b) => (list.byId?.[b]?.updatedAt ?? 0) - (list.byId?.[a]?.updatedAt ?? 0))
      const first = recent[0]
      // An untouched Session is already the new conversation the user wants.
      if (first !== undefined && list.byId?.[first]?.blank === true) {
        actions.openAgentSession(first)
        return first
      }
      const { sessionId } = await after(call<{ sessionId: string }>('agent-session', { agentId, workspaceId: client.workspaceOf(first) }))
      actions.openAgentSession(sessionId)
      return sessionId
    },
    archiveAgentSession: async (agentId, sessionId) => {
      await after(call('agent-archive', { agentId, sessionId }))
      if (client.mainView() !== sessionId) return
      const rest = roster.getSnapshot().agentsById[agentId]?.sessions ?? []
      if (rest.length > 0) actions.openAgent(agentId)
      else {
        const mainBotId = roster.getSnapshot().mainBotId
        if (mainBotId) actions.openSession(mainBotId)
      }
    },
    renameAgentSession: (agentId, sessionId, title) => after(call('agent-rename', { agentId, sessionId, title })),
    beginAgentRename: sessionId => ui.set(state => ({ ...state, renameAgent: sessionId })),
    endAgentRename: () => ui.set(state => (state.renameAgent ? { ...state, renameAgent: null } : state)),
    // Removing the Agent archives every Session it owns; one of them may fill the
    // main view, and it must not stay there wearing the Bot surface afterwards.
    removeAgent: async (agentId) => {
      const owned = client.agentSessions(agentId)
      const result = await after(call('remove-agent', { agentId }))
      const main = client.mainView()
      if (main !== undefined && owned.includes(main)) {
        const mainBotId = roster.getSnapshot().mainBotId
        if (mainBotId) actions.openSession(mainBotId)
      }
      return result
    },
    // `last` is the Bot conversation the view held before it cleared: when that part
    // was archived for a fresh one, the view goes on in the fresh one.
    landOn: async (id, last) => {
      if (last) await client.pull().catch(() => {})
      const bot = last ? roster.getSnapshot().byId?.[last.botId] : undefined
      client.setPlain(false)
      const target = bot && last && currentPart(bot) !== last.sessionId ? currentPart(bot) : partFor(id)
      show(target)
    },
    selectPanel: (id) => { ctx.layout.selectPanel(id) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    // Agent mode hands the surface back to the shell; everything open on the Bot
    // surface closes first so nothing stale reopens on the way back.
    setSurface: (mode) => {
      if (mode !== 'bot' && mode !== 'agent') return
      if (surface.getSnapshot().mode === mode) return
      if (mode === 'agent') {
        ui.set(state => ({ ...state, details: null, view: 'details', settings: null, palette: null, newChat: null, menu: null, voice: null, exchange: null, memory: null, toast: null }))
      }
      writeMode(mode)
      surface.set(state => ({ ...state, mode }))
      if (mode !== 'bot') return
      // Back in Bot mode the view must hold a team conversation; an outside
      // Session left over from Agent mode would wear the Bot skin without one.
      const home = (): void => {
        const snapshot = roster.getSnapshot()
        const mainBotId = snapshot.mainBotId
        if (!snapshot.ready || !mainBotId) return
        const main = client.mainView()
        if (main !== undefined && snapshot.byId[main] === undefined && snapshot.roomsById[main] === undefined) {
          actions.openSession(mainBotId)
        }
      }
      if (roster.getSnapshot().ready) home()
      else {
        const off = roster.subscribe(() => {
          if (!roster.getSnapshot().ready) return
          off()
          home()
        })
      }
    },
    markUnread: id => client.writeUnread(id, true),
    beginVisit: (id) => {
      // A conversation a Bot started, never opened here, is unread from its start.
      const snapshot = roster.getSnapshot()
      const made = snapshot.byId[id] ?? snapshot.roomsById[id]
      const createdAt = made?.createdAt
      const seen = client.seenAt()[client.seenKey(id)] ?? (made?.createdBy && typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : null)
      ui.set(state => ({ ...state, visits: { ...state.visits, [id]: { seen, entered: Date.now() } } }))
    },
    endVisit: (id) => {
      client.leaveVisits([id])
      ui.set((state) => {
        if (!(id in (state.visits ?? {}))) return state
        const visits = { ...state.visits }
        delete visits[id]
        return { ...state, visits }
      })
    },
    toggleReaction: (key, index, emoji) => {
      const reactions = client.reactionStore.update(saved => toggleReaction(saved, key, index, emoji), ui.getSnapshot().reactions ?? {})
      ui.set(state => ({ ...state, reactions }))
    },
    clearUnread: id => client.writeUnread(id, false),
    // DSH's right sidebar (files, terminals), which a plugin may load after this one.
    hasRightSidebar: () => ctx.get('sidebarRight') !== undefined,
    toggleRightSidebar: () => {
      try {
        ctx.get('sidebarRight')?.toggleExpanded()
      } catch (error) {
        actions.reportError(error instanceof Error ? error : new Error(String(error)), 'right-sidebar')
      }
    },
    // Whether AccountLauncher holds the shell's settings seat; FooterAccount steps aside if so.
    signInEntry: () => ctx.slots.entries?.('settings.models.sign-in')?.[0] ?? null,
    canSignIn: () => Boolean(actions.signInEntry()),
    signIn: () => { ui.set(state => ({ ...state, signIn: (state.signIn ?? 0) + 1 })) },
    closeSignIn: () => ui.set(state => ({ ...state, signIn: null })),
    accountT: () => ctx.get('locale').bind('settings.account'),
    // The Voice Input plugin's speech Remote; absent while that plugin is off.
    speech: () => ctx.get('remote.speech') ?? undefined,
    // DSH's own settings: models, providers, keys and its plugins.
    openShellSettingsPanel,
    openShellOnboardingPanel,
    voiceSetup: () => {
      const navigation = ctx.get('pluginNavigation')
      return navigation ? () => navigation.openBundle(VOICE_BUNDLE) : null
    },
    seatAccount: on => ui.set(state => (state.accountSeated === on ? state : { ...state, accountSeated: on })),
    // The install runs on the host; the check loop follows it every two seconds.
    installUpdate: async () => {
      const value = await call<UpdateState>('update-install')
      update.set(previous => ({ ...previous, ...value }))
      client.wakeUpdate()
    },
    // The app's panel installs whatever its updater found by now, so it opens only
    // while that is still the verified version.
    openAppUpdates: async (verified) => {
      const app = await appUpdates?.status?.()
      if (app) update.set(previous => ({ ...previous, app }))
      if (sameVersion(app?.version, verified)) await appUpdates?.open()
    },
    checkUpdate: async () => {
      const value = await call<UpdateState>('update-check', { fresh: true })
      update.set(previous => ({ ...value, app: previous.app }))
      client.wakeUpdate()
    },
    canReferenceChat: () => atMenu.current !== null,
    referenceChat: (sessionId, span) => {
      const controller = atMenu.current?.controllerOf(sessionId)
      if (controller === undefined || span === undefined) return
      controller.toggleSource(CHATS_SOURCE, { trigger: '@', query: '', quoted: false, position: 'inline', span })
    },
  }
  if (browsers) {
    Object.assign(actions, {
      // The globe button: the Bot's active tab in the browser view, or a new tab.
      openBrowser: (id: string) => {
        const bot = roster.getSnapshot().byId[id]
        if (!bot) return
        browsers.ensureTabs(bot.id)
        if (browsers.tabs.getSnapshot()[bot.id]?.active == null) browsers.openTab(bot.id)
        ui.set(state => ({ ...state, details: id, view: 'browser', renaming: false, tab: null }))
      },
      // '+' on the strip or the drawer's new-tab card: a blank tab in the browser view.
      browserNewTab: (id: string) => {
        const bot = roster.getSnapshot().byId[id]
        if (!bot) return null
        browsers.ensureTabs(bot.id)
        const tabId = browsers.openTab(bot.id)
        ui.set(state => ({ ...state, details: id, view: 'browser', renaming: false, tab: null }))
        return tabId
      },
      // A drawer card: its tab active, the panel on the browser view.
      browserPick: (id: string, tabId: string) => {
        const bot = roster.getSnapshot().byId[id]
        if (!bot) return
        browsers.activate(bot.id, tabId)
        ui.set(state => ({ ...state, details: id, view: 'browser' }))
      },
      browserEnsure: (botId: string) => browsers.ensureTabs(botId),
      browserCloseTab: (botId: string, tabId: string) => browsers.closeTab(botId, tabId),
      browserActivate: (botId: string, tabId: string) => browsers.activate(botId, tabId),
      browserShow: (tabId: string, box?: PanelRect | null) => browsers.show(tabId, box),
      browserNavigate: (tabId: string, input: string) => browsers.navigate(tabId, input),
      browserCommand: (tabId: string, name: string) => browsers.command(tabId, name),
      browserFocus: (tabId: string) => browsers.focus(tabId),
    })
  }
  return actions
}

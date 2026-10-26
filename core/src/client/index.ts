// The client entry: it exports the injection names and `apply`, which paints the Bot
// surface. The state and the pull live in `client-boot.ts`, the actions in
// `client-actions.ts`, and the surface's own painters (mentions, theme, registry) in
// `client-install.ts`.

import { ABOUT_CSS } from './about.tsx'
import { addAlwaysAllow } from './approval-always.ts'
import { noticeApprovals } from './approval-notices.ts'
import { call } from './api.ts'
import { CHATS_SOURCE, atSources } from './at-menu.ts'
import type { ChatRefRow, MentionRow } from './at-menu.ts'
import { createActions } from './client-actions.ts'
import { createClientState } from './client-boot.ts'
import type { AtMenuSlot, ChatSnapshot, ClientContext, Disposer, SelectionOwner } from './client-ctx.js'
import { installMentions, installRegistry, installTheme } from './client-install.ts'
import { AssistantCell, TriggerCell, TurnProcessCell, Nothing, TurnTailCell, ToolCell } from './cells.ts'
import { ChatWelcome, WELCOME_CSS } from './chat-welcome.tsx'
import { ComposerPlus, ComposerVoice, menuIcons } from './composer.tsx'
import { CONVERSATION_CSS, SHELL_CSS, installCompiledStyles } from './ui/design/index.ts'
import { quietly } from './diagnostics.ts'
import { EMPTY_STATE_CSS } from './empty-state.tsx'
import { ErrorToast, FEEDBACK_CSS } from './feedback.tsx'
import { installFilesPanel, FILES_PANEL_CSS } from './files-panel.ts'
import { HeaderPill } from './header.tsx'
import { installHeaderNavigation } from './header-navigation.ts'
import { installLocale, t } from './i18n.ts'
import { installImeGuard } from './ime-guard.ts'
import { MEMBER_CSS, MemberDock } from './member-status.tsx'
import { ModelChoiceDock, DeepSeekSignIn } from './model-choice.tsx'
import { MODEL_CSS } from './model-menu-css.ts'
import { listedOpener } from './open-listed.ts'
import { Overlays } from './overlays.tsx'
import { QuestionCard, QuestionDock } from './questions.tsx'
import { RetryCell, RETRY_CSS } from './retry-cell.tsx'
import { SCHEDULE_CSS } from './schedules.tsx'
import { SecretDock } from './secret-card.tsx'
import { SECRET_CSS } from './secret-card-css.ts'
import { quietShellOnboarding, relabelShellVersion, relabelTitle, quietShellDeepSeekCtas, quietShellRejectionCopy } from './shell-quiet.ts'
import { TeamSidebar, ConnectPlugins, YouAvatar, AccountLauncher, FooterAccount, BrandMark, BrandName, BotReturn, SIDEBAR_CSS, RETURN_CSS, holdShellShortcuts } from './features/sidebar/sidebar.tsx'
import { StarterChips, STARTERS_CSS } from './starters.tsx'
import { freePriority, groupsFor, surfaceGroups } from './surface.ts'
import { currentPart } from './text.ts'
import { registry } from './themes.ts'
import { USER_MESSAGE_CSS, UserMessageCell, canDrawUserMessages } from './user-message.tsx'
import { USAGE_CSS } from './features/usage/index.ts'
import { AnsweredReply, WidgetDock, WIDGET_CSS } from './widget-cell.tsx'
import { BROWSER_CSS } from './features/browser/index.ts'
import { BOT_SETTINGS_CSS } from './features/settings/bot-settings.tsx'
import { GROUP_SETTINGS_CSS } from './features/settings/group-settings.tsx'
import { FOLDER_CSS } from './folder-menu.tsx'
import { PROCESS_CSS } from './features/conversation/index.ts'

export const inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout']

// A thrown value's message, for the copy and the error report that show it.
const errorText = (error: unknown): string => (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : String(error))

// What a slot's `inject` receives: the shared face plus the hooks the view reads.
type Face = Record<string, unknown> & { hooks: Record<string, unknown> }

interface ShadowOptions {
  priority?: number
  id?: string
  key?: string
  order?: number
  inject?: unknown
  select?: (owner: SelectionOwner) => unknown
  locale?: string
}

export function apply(ctx: ClientContext): void {
  quietShellOnboarding()
  installImeGuard()
  relabelTitle()
  ctx.effect(() => installFilesPanel({ call, onPickFolder: () => { const id = mainView(); if (id) actions.showDetails(id) } }), 'moon-bot: workspace file downloads')
  relabelShellVersion(typeof __MOON_BOT_VERSION__ === 'string' ? __MOON_BOT_VERSION__ : '')
  quietShellDeepSeekCtas()
  quietShellRejectionCopy()
  ctx.effect(() => installLocale(ctx.get('locale')), 'ds-bot: interface copy')

  const client = createClientState(ctx)
  ctx.effect(() => installRegistry(ctx), 'ds-bot: registry')
  ctx.inject(['shortcuts'], scope => { scope.effect(() => holdShellShortcuts(scope.shortcuts), 'ds-bot: settings shortcut') })
  const after = <T>(promise: Promise<T>): Promise<T> => promise.then(async (value) => { await client.pull().catch(() => {}); return value })
  // A Bot id, or any part of its chat, opens the Bot's current part.
  const partFor = (id: string): string => {
    const bot = client.roster.getSnapshot().byId?.[id]
    return bot ? currentPart(bot) : id
  }
  const mainView = (): string | undefined => client.mainView()
  const show = listedOpener({
    list: ctx.sessions.list,
    refresh: () => Promise.resolve(ctx.sessions.refresh?.()).catch(quietly('refresh sessions')),
    open: (target) => { client.navigation.expected = target; ctx.uiWorkspace.openSession(target) },
    current: mainView,
  })
  const atMenu: AtMenuSlot = { current: null }
  const actions = createActions({ ctx, client, after, partFor, show, atMenu })

  const face = (): Face => ({ actions, hooks: {
    roster: client.roster, ui: client.ui, activity: client.activity, work: client.work, memoryNews: client.memoryNews,
    registry, turnClock: client.turnClock, live: client.live, cards: client.cards, heldCards: client.heldCards,
    browserPages: client.browserPages, browserTabs: client.browserTabs, surface: client.surface, update: client.update,
  } })

  ctx.effect(() => noticeApprovals({
    work: client.work,
    roster: client.roster,
    shownSession: () => mainView(),
    openSession: id => actions.openSession(id),
  }), 'ds-bot: approval notifications')
  ctx.effect(() => addAlwaysAllow({
    work: client.work,
    shownSession: () => mainView(),
    raise: (botId, permission) => actions.updateBot(botId, { permission }),
  }), 'ds-bot: always-allow approvals')

  const assistantFace = (sessionId: string): Face => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ds-bot: unknown session "${sessionId}"`)
    const chat = ctx.uiConversation.binding(binding).target('chat')
    const nodes = (): ChatSnapshot => {
      const snapshot = chat.getSnapshot()
      if (snapshot === undefined) throw new Error('ds-bot: Chat target is unavailable')
      return snapshot
    }
    return { ...face(), keyedHooks: {
      turnSteps: (turn: number) => nodes().nodes.turnDataSource(Number(turn), 'assistant-step'),
      turnTools: (turn: number) => nodes().nodes.turnDataSource(Number(turn), 'tool-call'),
      turnContext: (turn: number) => nodes().nodes.turnDataSource(Number(turn), 'context'),
    } }
  }

  // A Bot surface owns the cells it shadows. It starts far below the -10 that plugins
  // commonly use and goes below whatever already holds the cell, so a plugin that
  // shadows the same cell neither breaks the install nor shows through.
  const BOT_PRIORITY = -100
  const shadow = (name: string, options: ShadowOptions, component: unknown): Disposer => ctx.slots.inject(name, () => ctx.slots.register({
    name, ...options, ...(options.priority === undefined ? {} : { priority: freePriority(ctx.slots.entries(name), options) }),
  }, component))
  const installHeader = (): Disposer => ctx.slots.inject('conversation.session.header', () => installHeaderNavigation(ctx.slots, face, HeaderPill, BOT_PRIORITY))

  // The "@" menu's Bot group and the chats "+" references. The composer's controller
  // for a Session is the shell's own, so the chats open at its caret.
  const installAtMenu = (): Disposer => {
    const fiber = ctx.inject(['inputTriggers'], (scope) => {
      scope.effect(() => {
        const triggers = scope.inputTriggers
        const controllerOf = (sessionId: string) => {
          const binding = ctx.sessions.binding(sessionId)
          return binding === undefined ? undefined : triggers.sessionOf(binding.ctx)
        }
        const launched = (sessionId: string): boolean => controllerOf(sessionId)?.launcher.getSnapshot() === CHATS_SOURCE
        const iconOf = menuIcons(client.roster)
        const iconFor = (row: MentionRow | ChatRefRow): unknown => iconOf(row.bot ? { bot: row.bot } : {})
        const offs = atSources({ roster: client.roster, sessions: ctx.sessions, launched, iconFor }).map(source => triggers.registerSource(source))
        atMenu.current = { controllerOf }
        return () => {
          atMenu.current = null
          for (const off of offs) off()
        }
      }, 'ds-bot: @ menu')
    })
    return () => { fiber.dispose() }
  }

  // The shell group paints the team surface around the session; the conversation
  // group re-skins the session itself. Each step returns a disposer from slots.inject,
  // so a surface change withdraws the whole group and the outlets re-render.
  const installShell = (): readonly (() => Disposer | undefined)[] => [
    () => installCompiledStyles(SHELL_CSS, 'shell'),
    () => installCompiledStyles(SIDEBAR_CSS, 'sidebar'),
    () => installCompiledStyles(SECRET_CSS, 'secrets'),
    () => installCompiledStyles(MODEL_CSS + FOLDER_CSS + BOT_SETTINGS_CSS + GROUP_SETTINGS_CSS, 'models'),
    () => installCompiledStyles(USAGE_CSS, 'usage'),
    () => installCompiledStyles(SCHEDULE_CSS, 'schedules'),
    () => installCompiledStyles(FEEDBACK_CSS, 'feedback'),
    () => installCompiledStyles(ABOUT_CSS, 'about'),
    () => installCompiledStyles(MEMBER_CSS, 'members'),
    () => installCompiledStyles(USER_MESSAGE_CSS, 'user-messages'),
    () => installCompiledStyles(WIDGET_CSS, 'widgets'),
    () => installCompiledStyles(EMPTY_STATE_CSS + WELCOME_CSS + PROCESS_CSS + RETRY_CSS + STARTERS_CSS + FILES_PANEL_CSS, 'work-process'),
    ...(client.browsers ? [() => installCompiledStyles(BROWSER_CSS, 'browser')] : []),
    () => installTheme({ ctx, client }),
    () => shadow('sidebar.workspaces', { priority: BOT_PRIORITY, inject: face }, TeamSidebar),
    () => shadow('sidebar.brand.mark', { priority: BOT_PRIORITY }, BrandMark),
    () => shadow('sidebar.brand.name', { priority: BOT_PRIORITY }, BrandName),
    () => shadow('sidebar.footer.action', { id: 'bot-account', order: -200, inject: face }, FooterAccount),
    () => shadow('sidebar.footer.action', { id: 'bot-connect', order: -100, inject: face }, ConnectPlugins),
    () => shadow('settings.trigger', { priority: BOT_PRIORITY }, YouAvatar),
    // The whale wins the seat over a shell account plugin's own launcher (the
    // Desktop's "··· More"), which comes back in Agent mode.
    () => shadow('settings.launcher', { priority: BOT_PRIORITY, inject: face }, AccountLauncher),
    () => shadow('shell.overlay', { id: 'bot', order: 50, inject: face }, Overlays),
    () => shadow('shell.overlay', { id: 'bot-signin', order: 55, inject: face }, DeepSeekSignIn),
    () => shadow('shell.overlay', { id: 'bot-toast', order: 60, inject: face }, ErrorToast),
  ]
  const installConversation = (): readonly (() => Disposer | undefined)[] => [
    () => installCompiledStyles(CONVERSATION_CSS, 'conversation'),
    () => installMentions(client),
    () => installAtMenu(),
    installHeader,
    () => shadow('conversation.chat.node', { key: 'assistant-step', priority: BOT_PRIORITY, locale: 'chat', inject: assistantFace }, AssistantCell),
    () => shadow('conversation.chat.node', { key: 'turn-trigger', priority: BOT_PRIORITY, locale: 'chat', inject: face }, TriggerCell),
    () => shadow('conversation.chat.node', { key: 'tool-call', priority: BOT_PRIORITY, locale: 'chat', inject: face }, ToolCell),
    () => shadow('conversation.chat.node', { key: 'model-retry', priority: BOT_PRIORITY, locale: 'chat' }, RetryCell),
    () => shadow('conversation.chat.node', { key: 'turn-process', priority: BOT_PRIORITY, locale: 'chat', inject: face }, TurnProcessCell),
    // DSH's own turn tail stays, so what other plugins add there shows, such as the
    // cards of the files a turn delivered; its copy and branch row is hidden.
    () => shadow('conversation.chat.turnTail', { id: 'bot-turn-separators', order: 1000, inject: face }, TurnTailCell),
    // A Bot condenses its conversation without telling anyone; the chat keeps showing
    // every message.
    () => shadow('conversation.chat.node', { key: 'question-reply', priority: BOT_PRIORITY, locale: 'chat' }, AnsweredReply),
    () => shadow('conversation.chat.node', { key: 'compaction', priority: BOT_PRIORITY, locale: 'chat' }, Nothing),
    ...(canDrawUserMessages() ? ['user', 'steering'].map(key => () => shadow('conversation.chat.node', { key, priority: BOT_PRIORITY, locale: 'chat', inject: face }, UserMessageCell)) : []),
    () => shadow('conversation.input.permission', { priority: BOT_PRIORITY }, Nothing),
    () => shadow('conversation.input.plan', { priority: BOT_PRIORITY }, Nothing),
    // The composer carries no model picker or run statistics; a Bot's model lives
    // in its details panel.
    () => shadow('conversation.input.model', { priority: BOT_PRIORITY }, Nothing),
    () => shadow('conversation.composer.dock', { id: 'activity', order: 0, priority: BOT_PRIORITY }, Nothing),
    () => shadow('conversation.composer.dock', { id: 'usage', order: 1, priority: BOT_PRIORITY }, Nothing),
    () => shadow('conversation.input.left', { id: 'bot-plus', order: -100, inject: face }, ComposerPlus),
    () => shadow('conversation.input.right', { id: 'bot-voice', order: 100, inject: face }, ComposerVoice),
    () => shadow('conversation.composer', {
      priority: BOT_PRIORITY,
      select: owner => (owner.pendingInteraction?.kind === 'question' ? owner.pendingInteraction : null),
    }, QuestionCard),
    () => shadow('conversation.input.dock', { id: 'bot-members', order: -120, inject: face }, MemberDock),
    () => shadow('conversation.input.dock', { id: 'bot-model', order: -110, inject: face }, ModelChoiceDock),
    () => shadow('conversation.input.dock', { id: 'bot-question', order: -100, inject: face }, QuestionDock),
    () => shadow('conversation.input.dock', { id: 'bot-view', order: -95, inject: face }, WidgetDock),
    () => shadow('conversation.input.dock', { id: 'bot-secret', order: -90, inject: face }, SecretDock),
    () => shadow('conversation.input.dock', { id: 'bot-welcome', order: -85, inject: face }, ChatWelcome),
    () => shadow('conversation.input.dock', { id: 'bot-starters', order: -80, inject: face }, StarterChips),
  ]
  // The return button belongs to neither group: it renders only in Agent mode.
  ctx.effect(() => installCompiledStyles(RETURN_CSS, 'return'), 'ds-bot: return styles')
  shadow('sidebar.footer.action', { id: 'bot-return', order: -300, inject: face }, BotReturn)

  // The main view decides `plain`: a DSH Agent Session keeps the Bot shell but
  // withdraws the conversation replacements, so the native dsh page shows. A jump
  // this plugin did not start — the hero's workspace picker or a fork — opens an
  // unowned Session; coming from a DSH Agent Session it is adopted into that Agent.
  ctx.effect(() => {
    let previous: string | undefined
    const sync = (): void => {
      const list = ctx.sessions.list.getSnapshot()
      const main = mainView()
      const plain = client.isAgentSessionId(main)
      client.setPlain(plain)
      if (plain) client.dropPanels()
      if (main === previous) return
      const before = previous
      previous = main
      const ours = client.navigation.expected !== null && main === client.navigation.expected
      client.navigation.expected = null
      if (ours || main === undefined) return
      // Adoption is a Bot-mode affair: in Agent mode the native sidebar owns
      // navigation, and opening an existing Session there must not pull it in.
      if (client.surface.getSnapshot().mode !== 'bot') return
      const agentId = before !== undefined ? client.agentOfSession(before) : undefined
      if (agentId === undefined) return
      const snapshot = client.roster.getSnapshot()
      if (snapshot.byId[main] !== undefined || snapshot.roomsById[main] !== undefined || client.agentOfSession(main) !== undefined) return
      // Only a Session this jump created joins the Agent: a blank one from the
      // workspace picker, or a fork of a Session the same Agent owns. An existing
      // Session the user opened from the sidebar keeps its team tools and stays out.
      const row = list.byId?.[main]
      // The client list maps the fork's parent to `parentId`; the raw field is
      // the fallback for shapes that skip the mapping.
      const parent = row?.parentId ?? row?.parentSessionId
      const forkedFromAgent = parent !== undefined && client.agentOfSession(parent) === agentId
      if (row?.blank !== true && !forkedFromAgent) return
      client.pendingAdopt.set(main, agentId)
      client.setPlain(true)
      void call('agent-adopt', { agentId, sessionId: main }).then(() => client.pull()).catch((error: unknown) => {
        client.pendingAdopt.delete(main)
        console.warn('[ds-bot] agent-adopt', error)
        // The Session never joined the Agent: the sync puts the team surface
        // back (a Map delete fires no subscription), and the user hears why.
        sync()
        actions.reportError(error instanceof Error ? error : { message: errorText(error) }, 'agent-adopt')
      })
      // The hero's workspace picker leaves the blank Session it switched away from
      // behind; in another workspace it stays empty forever, so it is archived.
      const next = client.workspaceOf(main)
      if (list.byId?.[String(before)]?.blank === true && next !== undefined && client.workspaceOf(before) !== next) {
        void call('agent-archive', { agentId, sessionId: before }).then(() => client.pull()).catch(() => {})
      }
    }
    const offList = ctx.sessions.list.subscribe(sync)
    const offRoster = client.roster.subscribe(sync)
    sync()
    return () => { offList(); offRoster() }
  }, 'ds-bot: agent surface')

  ctx.effect(() => {
    const groups = surfaceGroups({ shell: installShell, conversation: installConversation }, {
      onError: (_group, error) => actions.reportError(new Error(t('Bot mode could not be set up here: {error}', { error: errorText(error) })), 'surface'),
    })
    const reconcile = (): void => groups.reconcile(groupsFor(client.surface.getSnapshot()))
    reconcile()
    const unsub = client.surface.subscribe(reconcile)
    return () => {
      unsub()
      groups.dispose()
    }
  }, 'ds-bot: surface')
}

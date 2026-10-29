// The host client context `apply(ctx)` receives, as far as Moon Bot's client entry reads it.
//
// the host hands the client a context object that no package here declares; these are structural
// types for the services the client uses, written without depending on files inside a host
// install. Nothing in this module runs: it is types only.
//
// A value the host owns but this client only passes along (a speech remote, a slot entry's store)
// stays `unknown`; everything the client reads is named here.

import type { CustomShape, ThemeDefinition } from './themes.ts'

export type Disposer = () => void

// ---------------------------------------------------------------------------
// Effects, injection and the services `ctx.get` answers

export interface EffectScope {
  effect(execute: () => void | Disposer, label?: string): Disposer
}

/** The handle `ctx.inject` hands back; disposing it withdraws the injected effect. */
export interface PluginFiber {
  dispose(): unknown
}

export interface LocaleService {
  register: (namespace: string, language: string, table: Record<string, string>) => unknown
  bind: (namespace: string) => (key: string, params?: Record<string, unknown>) => string
  getLocale?: () => { active?: string }
}

/** One workspace in the shell's list, as `workspaceOf` reads it. */
export interface WorkspaceItem {
  readonly workspaceId?: string | undefined
  readonly sessionIds?: readonly string[] | undefined
}
export interface WorkspacesService {
  readonly list?: { getSnapshot(): { readonly items?: readonly WorkspaceItem[] | undefined } } | undefined
}

export interface SidebarRightService {
  toggleExpanded(): void
}

/** The Voice Input plugin's speech remote; this client only hands it to its views. */
export interface SpeechRemote {
  readonly [member: string]: unknown
}

export interface PluginNavigation {
  openBundle(id: string): void
}

/** The shell's keyboard shortcuts, held for the settings seat. */
/** The shell shortcuts service: the catalog the Bot mode watches for its shortcut. */
export interface ShortcutsService {
  readonly catalog: {
    getSnapshot(): readonly {
      readonly id?: string
      readonly binding?: { readonly code: string; readonly modifiers: readonly string[] }
    }[]
  }
  readonly [member: string]: unknown
}

// ---------------------------------------------------------------------------
// Sessions and the shell's conversation targets

export interface SessionRetainInfo {
  readonly mainView?: number | undefined
}
/** One row of the shell's Session list, as the client reads it for navigation. */
export interface SessionRow {
  readonly id: string
  readonly updatedAt?: number | undefined
  readonly blank?: boolean | undefined
  readonly parentId?: string | undefined
  readonly parentSessionId?: string | undefined
  readonly retainedBy?: SessionRetainInfo | undefined
}
export interface SessionListSnapshot {
  readonly byId?: Record<string, SessionRow | undefined>
}
export interface SessionList {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): Disposer
}
/** What `sessions.binding` answers: the shell's conversation handle for one Session. */
export interface SessionBinding {
  readonly ctx: unknown
}
export interface ChatSnapshot {
  readonly nodes: { turnDataSource(turn: number, kind: string): unknown }
}
export interface ChatTarget {
  getSnapshot(): ChatSnapshot | undefined
}
export interface SessionsService {
  readonly list: SessionList
  refresh?(): Promise<unknown>
  refreshProjections?(sessionId: string): unknown
  binding(sessionId: string): SessionBinding | undefined
}

// ---------------------------------------------------------------------------
// Slots

export interface SlotEntryOptions {
  readonly key?: string
  readonly id?: string
  readonly priority?: number
}
/** An entry another plugin already holds in a cell; only what `freePriority` reads is named. */
export interface SlotEntry {
  readonly store?: unknown
  readonly inject?: (...args: readonly unknown[]) => Record<string, unknown>
  readonly component?: unknown
  readonly options?: SlotEntryOptions
}
/** What a slot's `select` receives; only the pending question is read. */
export interface SelectionOwner {
  readonly pendingInteraction?: { readonly kind?: string | undefined } | undefined
}
/** The registration options a slot call takes. The rest are the shell's, passed through. */
export interface SlotRegistration {
  readonly name: string
  readonly priority?: number | undefined
  readonly id?: string | undefined
  readonly key?: string | undefined
  readonly order?: number | undefined
  readonly locale?: string | undefined
  readonly select?: ((owner: SelectionOwner) => unknown) | undefined
  readonly [option: string]: unknown
}
export interface SlotService {
  inject(name: string, install: () => Disposer): Disposer
  register(options: SlotRegistration, component: unknown): Disposer
  entries(name: string): readonly SlotEntry[]
  subscribe(name: string, listener: () => void): Disposer
}

// ---------------------------------------------------------------------------
// The composer's input triggers and its "@" menu

/** One Session's composer controller, as the chat references drive it. */
export interface TriggerController {
  readonly launcher: { getSnapshot(): unknown }
  toggleSource(source: string, options: { trigger: string; query: string; quoted: boolean; position: string; span: unknown }): void
}
export interface InputTriggersService {
  sessionOf(context: unknown): TriggerController | undefined
  registerSource(source: unknown): Disposer
}
/** The window's current "@" menu, or null while its conversation group is withdrawn. */
export interface AtMenuController {
  controllerOf(sessionId: string): TriggerController | undefined
}
export interface AtMenuSlot {
  current: AtMenuController | null
}

// ---------------------------------------------------------------------------
// The context itself

/** One the host theme token, light and dark, as `theme.overrideTokens` takes it. */
export interface ThemeTokenPair {
  readonly light: string
  readonly dark: string
}
export type ThemeTokens = Readonly<Record<string, ThemeTokenPair>>

export interface ClientContext extends EffectScope {
  get(service: 'locale'): LocaleService
  get(service: 'workspaces'): WorkspacesService | undefined
  get(service: 'sidebarRight'): SidebarRightService | undefined
  get(service: 'remote.speech'): SpeechRemote | undefined
  get(service: 'pluginNavigation'): PluginNavigation | undefined
  inject(names: readonly ['shortcuts'], run: (scope: EffectScope & { readonly shortcuts: ShortcutsService }) => void | Disposer): PluginFiber
  inject(names: readonly ['inputTriggers'], run: (scope: EffectScope & { readonly inputTriggers: InputTriggersService }) => void | Disposer): PluginFiber
  readonly sessions: SessionsService
  readonly uiWorkspace: { openSession(target: string): void }
  readonly uiConversation: { binding(binding: SessionBinding): { target(name: 'chat'): ChatTarget } }
  readonly slots: SlotService
  readonly theme: { overrideTokens(owner: string, tokens: ThemeTokens): Disposer }
  readonly layout: { selectPanel(id: string): void; toggleSidebar(): void }
}

// ---------------------------------------------------------------------------
// Globals the client bundle runs with

/** The registration hub a theme or shape plugin receives through `window.moonBot`. */
export interface BotHub {
  registerShape(id: string, shape: CustomShape): Disposer
  registerTheme(id: string, theme: ThemeDefinition): Disposer
  themes(): string[]
  shapes(): string[]
}
export type BotTask = (hub: BotHub) => void
/** Before this plugin loads, tasks queue on an array; afterwards, on `push`. */
export type BotQueue = BotTask[] | { push(task: BotTask): void }

declare global {
  interface Window {
    moonBot?: BotHub
    moonBotQueue?: BotQueue
  }
  /** The app version the client build writes in. */
  const __MOON_BOT_VERSION__: string | undefined
}

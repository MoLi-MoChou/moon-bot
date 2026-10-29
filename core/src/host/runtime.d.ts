// The runtime object the plugin builds once and threads through every host module.
//
// `core/index.js` creates it with the context and the config, then calls each module's
// `install(rt)`. A module both reads what earlier modules put on `rt` and adds its own
// functions. This interface holds the slice today's TypeScript modules need; it grows a
// batch at a time as the rest of `src/host` moves over. Nothing here runs: types only.
import type { Agent, AttachmentRef, HostContext, SessionEvent } from './host-types.js'
import type { ToolEntry } from '../engine/registry.ts'
import type { UsageView, UsageViewOptions } from './usage/view.ts'
import type { SecretRequest, SecretView } from './secrets/store.ts'
import type { ChildProcess } from 'node:child_process'

export interface HostConfig {
  readonly home?: string
  readonly workspace?: string
  readonly mainName?: string
  readonly mainRole?: string
  readonly timeRefreshIntervalMs?: number
  readonly updateCheck?: boolean
  readonly diagnosticsFile?: boolean
  readonly textOnlyModels?: readonly string[]
  readonly browser?: boolean
  readonly ocrModel?: string
  readonly updateRegistry?: string
  readonly github?: Readonly<Record<string, unknown>> | false
  readonly timeZone?: string
  /** How much of a fresh part the latest messages may take, in tokens. */
  readonly handoffRecentTokens?: number
  /** How much of the anchored message list the handoff package may take. */
  readonly handoffListTokens?: number
  /** The share of the usable window at which a part makes room. */
  readonly checkRatio?: number
}

export interface HostDefaults {
  readonly mainName: string
  readonly mainRole: string
}

/** The runtime selected for one Bot's turns. */
export interface StoredBotEngine {
  readonly kind: 'builtin' | 'acp' | 'acp-remote'
  readonly command?: string
  readonly args?: readonly string[]
  readonly key?: string
  /** `acp-remote`: the relay invite this Bot's agent dials in under. */
  readonly agentId?: string
}

/** A Bot as `state.json` stores it. */
export interface StoredBot {
  readonly id: string
  name: string
  role?: string
  instructions?: string
  permission?: string
  sessionId?: string
  model?: string
  appliedModel?: string
  effort?: string
  appliedEffort?: string
  engine?: StoredBotEngine
  runtimeId?: string
  segments?: readonly { readonly sessionId: string; readonly endedAt?: number }[]
  workDir?: string
  capabilities?: string[]
  color?: string | undefined
  createdAt?: number
  lab?: string
  kickoff?: { text: string; from?: string | null; main?: boolean }
  pinned?: boolean
  hidden?: boolean
  avatar?: { shape?: string; image?: string }
  readonly [key: string]: unknown
}

/** A group as `state.json` stores it. */
export interface StoredRoom {
  readonly id: string
  name: string
  admin?: string | null | undefined
  permission?: string | null
  members?: string[]
  mode?: string
  notice?: string
  named?: boolean
  log?: readonly ({ readonly text: string; readonly seq: number; readonly [key: string]: unknown } | Record<string, unknown>)[]
  botRounds?: number
  seen?: Record<string, unknown>
  sessions?: Record<string, string>
  segments?: Record<string, readonly { readonly sessionId: string; readonly endedAt?: number }[]>
  workDir?: string
  archivedAt?: number
  readonly [key: string]: unknown
}

/** One recorded exchange between two Bots, in `state.exchanges`. */
export interface ExchangeEntry {
  readonly id: string
  readonly from: string | undefined
  readonly to: string
  text: string
  readonly role?: string
  readonly time?: number
  length?: number
  readonly sessionId?: string
  readonly files?: readonly AttachmentRef[]
  readonly replyTo?: string
  readonly audience?: string
}

/** One result a Bot handed back for a work item. */
export interface WorkResult {
  readonly id: string
  readonly name: string
  readonly text: string
  readonly length?: number
}

/** A piece of work one Bot gave another, in `state.works`. */
export interface StoredWork {
  from?: string
  to?: string
  room?: string
  parent?: string
  fromRoom?: string
  open: string[]
  results: WorkResult[]
  at?: number
  held?: string
  readonly [key: string]: unknown
}

/** What a running turn is doing, as `rt.live` records it. */
export interface TurnInfo {
  readonly kind?: string
  readonly role?: string
  readonly exchangeId?: string
  readonly work?: string
  readonly senderSessionId?: string | undefined
  readonly roomId?: string | undefined
  readonly askedBy?: string
  readonly audience?: string
  readonly senderRoomId?: string | undefined
  readonly resumed?: boolean | undefined
}

export interface LiveEntry {
  readonly since?: number
  readonly turn?: unknown
  readonly info?: TurnInfo
  /** Requests that joined the turn in progress, kept with the info they came with. */
  readonly joined?: readonly { readonly info: TurnInfo; readonly text?: string }[]
}

export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One model a provider serves, as the picker lists it. */
export interface ModelEntry {
  ref: string
  provider?: string
  providerName?: string
  id?: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  needsKey?: boolean
  reasoning?: ModelReasoning
}

/** The team's one plain Agent, as `state.json` stores it. */
export interface StoredAgent {
  readonly id: string
  readonly name: string
  sessions: string[]
  readonly createdAt?: number
  readonly [key: string]: unknown
}

/** What `deliver` puts into a Session. */
export interface DeliveryInput {
  readonly fromId?: string | undefined
  readonly toId: string
  readonly sessionId?: string | undefined
  readonly text: string
  readonly role: string
  readonly replyTo?: string | undefined
  readonly roomId?: string | undefined
  readonly audience?: string | undefined
  readonly note?: string | undefined
  readonly exchangeId?: string | undefined
  readonly steer?: boolean | undefined
  readonly deferred?: boolean | undefined
  readonly resumed?: boolean | undefined
  readonly retried?: boolean | undefined
  readonly resent?: boolean | undefined
  readonly merged?: boolean | undefined
  readonly askedBy?: string | undefined
  readonly fromRoomId?: string | undefined
  readonly files?: readonly AttachmentRef[] | undefined
  readonly length?: number | undefined
  readonly work?: string | undefined
}


/** One saved capability: an MCP server, a skill, or a pack of them. */
export interface CapabilityItem {
  name: string
  kind: string
  description?: string
  createdBy?: string | null | undefined
  createdAt?: number
  updatedAt?: number
  transport?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  approved?: boolean
  content?: string
  items?: string[]
  readonly [key: string]: unknown
}

export interface StoredState {
  readonly version: number
  revision: number
  capabilities: { items: Record<string, CapabilityItem> }
  prefs: Record<string, unknown>
  switching: Record<string, unknown>
  whaleStored?: boolean
  moonLook?: boolean
  mainBotId?: string
  bots: Record<string, StoredBot>
  agents: Record<string, StoredAgent>
  rooms: Record<string, StoredRoom>
  exchangeTurns: Record<string, readonly number[]>
  workspaceId?: string
  mainBotIds: string[]
  exchanges: ExchangeEntry[]
  connectors?: Record<string, { readonly login?: string | null; readonly connectedAt?: number }>
  works?: Record<string, StoredWork>
  questions: Record<string, unknown>
  views: Record<string, unknown>
  /** The secret cards waiting for the user, keyed by Bot id. Values are never here. */
  secretRequests?: Record<string, SecretRequest[]>
  readonly [key: string]: unknown
}

/** An approval entry as the team view reads it. */
export interface ApprovalDetail {
  readonly text?: string
  readonly code?: string
}

export interface ApprovalNote {
  readonly tool: string
  readonly reason: string
}

export interface HostRuntime {
  readonly ctx: HostContext
  readonly config: HostConfig
  readonly otherAppHome: string
  readonly home: string
  readonly statePath: string
  readonly defaults: HostDefaults

  // --- provided by store.ts
  readonly state: StoredState
  readonly live: Map<string, LiveEntry>
  readonly chatOwners: Map<string, string>
  readonly groupOwners: Map<string, { readonly botId: string; readonly roomId: string }>
  readonly pastOwners: Map<string, { readonly botId: string; readonly roomId?: string }>
  load(): Promise<unknown>
  botOf(botId: string | undefined): StoredBot | undefined
  findBot(ref: string | undefined): StoredBot | undefined
  findRooms(ref: string | undefined): StoredRoom[]
  isAdminOf(room: StoredRoom, id: string | undefined): boolean
  roomOf(roomId: string | undefined): StoredRoom | undefined
  chatOf(botId: string): string
  selfOf(sessionId: string | undefined): string | undefined
  isBotSession(sessionId: string): boolean
  isMain(id: string | undefined): boolean
  groupSessionsOf(botId: string): readonly string[]

  // --- provided by chat-index.ts
  eventsBackwards(
    sessionId: string,
    signal?: AbortSignal,
    maxPages?: number,
  ): AsyncIterable<SessionEvent>

  // --- provided by delivery.ts and diagnostics.ts
  resolveAgent(sessionId: string): Promise<Agent>
  warn(template: string, ...args: readonly unknown[]): void
  save(): Promise<unknown>
  browserEnabled?: boolean
  browserChannel?: unknown
  browserOpen?: (value: unknown) => Record<string, { readonly url: string; readonly title: string }>
  deliver(args: DeliveryInput): Promise<string>
  postToRoom(
    room: StoredRoom,
    bot: StoredBot,
    text: string,
    options?: {
      readonly late?: boolean | undefined
      readonly quiet?: boolean | undefined
      readonly progress?: boolean | undefined
      readonly stopped?: boolean | undefined
      readonly done?: boolean | undefined
      readonly resumed?: boolean | undefined
      readonly again?: boolean | undefined
      readonly failed?: { readonly code?: string; readonly message?: string; readonly status?: number } | undefined
      readonly askedBy?: string | undefined
      readonly member?: boolean | undefined
      readonly reportBack?: boolean | undefined
      readonly sub?: string | undefined
      readonly length?: number | undefined
    },
    files?: readonly AttachmentRef[],
  ): Promise<void>
  unreadOf?(sessionId: string): Iterable<DeliveryInput>
  forgetDelivery?(exchangeId: string): void
  own<T>(record: Readonly<Record<string, T>> | null | undefined, id: string | undefined): T | undefined
  ensureWorkspace(): Promise<string>
  indexAgents?(): void
  dshSpawn?(command: string, argv: readonly string[], options: { readonly windowsHide?: boolean }): ChildProcess
  // --- provided by tasks-panel.ts
  /** Async because each running Session's Agent is resolved for its queued messages. */
  tasksView?(): Promise<{ readonly running: readonly Readonly<Record<string, unknown>>[]; readonly completed: readonly Readonly<Record<string, unknown>>[]; readonly waiting: readonly { readonly botId: string; readonly botName: string; readonly for: readonly string[] }[] }>
  noteTurn?(sessionId: string, event: { readonly type?: string; readonly reason?: unknown }): void
  stopTask?(sessionId: string): Promise<boolean>
  /** Drops one queued message that has not started. False when it is already gone. */
  removeQueued?(sessionId: string, id: string): Promise<boolean>

  // --- provided by secrets/install.ts
  loadSecrets(): Promise<unknown>
  secretsView(): readonly SecretView[]
  secretValue(name: string): string | undefined
  canUseSecret(name: string, botId: string | undefined): boolean
  redactSecrets(text: string): string
  secretEndpoint(endpoint: string, body: Readonly<Record<string, unknown>>): Promise<unknown>
  forgetBotSecrets(botId: string): Promise<void>
  secretsChanged?(): void

  // --- provided by turns.ts, groups.ts and resume.ts
  /** A message the chat accepted (`true`) or a send it turned away (`false`). */
  noteSent?(sessionId: string, sent: boolean): void
  /** The live figures moved without a save: the feed tells its windows to read again. */
  liveChanged?(): void
  callDetail?(sessionId: string | undefined, callId?: string): ApprovalDetail
  yieldRoomTurn?(sessionId: string | undefined): void
  noteApproval?(sessionId: string | undefined, note: ApprovalNote | undefined): void

  readOnly(): string | undefined
  approvalsView?(): readonly { readonly botId: string; readonly sessionId: string; readonly tool?: string; readonly at: number }[]
  switchJobs?(): Iterable<{ readonly botId: string; readonly roomId?: string }>
  doingOf?(entry: LiveEntry): { readonly tool?: string; readonly target?: string; readonly said?: string }
  catalog(options?: { readonly fresh?: boolean }): Promise<readonly ModelEntry[]>
  cachedCatalog(): readonly ModelEntry[]
  missingKeys?(providers: readonly string[]): Promise<ReadonlySet<string>> | ReadonlySet<string>
  dropCatalog(): void
  keepGroupLine?(roomId: string, line: { readonly text: string; readonly seq: number }, text: string): unknown
  autoRoomName?(members: readonly string[]): string
  retitleRoom?(room: StoredRoom): Promise<unknown>
  capabilitiesStateSaved?(): void
  archiveGroupMemory?(room: StoredRoom): Promise<unknown>
  archiveBotMemory?(botId: string): Promise<unknown>
  /**
   * One short model call as that Bot, with the profile fallback memory uses. For work that
   * needs judgement but not a whole turn: a summary, a prepared suggestion.
   */
  smallShot?(botId: string, system: string, text: string): Promise<string>
  /** Proactive messages (2026-10-29 proactive-messages): the channel's surface. */
  proactiveStore?(): {
    readonly subscriptionsOf: (botId: string) => readonly unknown[]
    readonly addSubscription: (input: Record<string, unknown>) => unknown
    readonly setEnabled: (id: string, enabled: boolean) => boolean
    readonly removeSubscription: (id: string) => boolean
  }
  proactiveSubscriptionsOf?(botId: string): readonly { readonly id: string, readonly topics: string, readonly dailyCap: number, readonly quietFrom: string | null, readonly quietTo: string | null, readonly enabled: boolean }[]
  proactiveReview?(botId: string): Promise<unknown>
  proactiveLocalTime?(): string
  proactiveSend?(sessionId: string, message: Record<string, unknown>): boolean
  proactiveRules?(): {
    readonly rulesForBot: (botId: string) => readonly Record<string, unknown>[]
    readonly add: (input: Record<string, unknown>) => Record<string, unknown>
    readonly revoke: (id: string) => boolean
    readonly auditOf: (ruleId: string) => readonly Record<string, unknown>[]
  }
  /** A Bot's own remembered lines, read-only, for work that is not the memory panel. */
  memoryLinesOf?(botId: string): readonly { readonly topic: string | null, readonly text: string, readonly added: string | null }[]
  /** Empties a Bot's memory for good (a reset, not a delete). */
  clearBotMemory?(botId: string): Promise<void>
  /** Empties one Session's transcript; the Session row stays. */
  clearSessionHistory?(sessionId: string): void
  /** Moves a Session on to a fresh part, keeping the old one readable. */
  startFreshPart?(sessionId: string): Promise<void>
  /** Moves a Bot's own chat on to a fresh part without a running turn. */
  freshChatPart?(botId: string): Promise<void>
  readonly roomInbox: Map<string, unknown>
  readonly roomProgress: ReadonlyMap<string | undefined, { readonly roomId?: string }>
  dropGroupLines?(roomId: string): void
  followFolder?(botId: string): void
  uiLanguage?(): string | undefined
  releaseBot?(botId: string, sessions: readonly string[]): Promise<unknown>
  syncModels?(): Promise<unknown>
  capabilityEnsureTimeoutMs?: number
  cancelApprovals?(sessionId: string): void
  ownRequest(options: { readonly sessionId?: string | undefined; readonly messages?: unknown }): boolean
  partsOf(botId: string): readonly { readonly sessionId: string; readonly number: number; readonly startedAt: number; readonly endedAt?: number | undefined }[]
  historyEntry(event: SessionEvent, forDisplay: boolean): { readonly text: string; readonly who?: string; readonly answer?: boolean; readonly keepAnswers?: boolean } | undefined
  clock(time: number | undefined): string
  partLines(sessionId: string, signal: AbortSignal): AsyncIterable<{ readonly text: string; readonly time: number }>
  defaultRef?(): string | undefined
  tagUsage(messages: readonly unknown[], tag: { readonly sessionId: string; readonly kind: string }): readonly unknown[]
  renewMemory(sessionId: string): void
  carryUsageTag(from: unknown, to: unknown): void
  usageView(options?: UsageViewOptions): Promise<UsageView>

  // --- provided by capabilities.ts and tools.ts
  ensureCapabilities(sessionId: string): Promise<unknown>
  hideBotUnusedTools(agent: Agent): void
  /** One tool on both paths at once: the Zod registry entry and its the host derivation. */
  registerTool(entry: ToolEntry): void
  /** The tool registry, for mounts that add tools at run time (capabilities). */
  readonly toolRegistry?: import('../engine/registry.ts').ToolRegistry | undefined

  // --- provided by parts.ts and folders.ts
  displayItems(sessionId: string, events: readonly SessionEvent[]): readonly unknown[]
  isFolder(path: string): Promise<boolean>
  resolveModel(text: unknown): Promise<string>
  defaultModel(): Promise<string | undefined>
  resolveEffort(ref: string, text: unknown): Promise<string>
  applyModel(bot: StoredBot, options?: { readonly force?: boolean }): Promise<string | undefined>
  waitForModel(bot: StoredBot, ms?: number): Promise<string | undefined>
  setPermission(bot: StoredBot, name: unknown): Promise<void>
  cleanRoomPermission(name: unknown): string | null
  setRoomPermission(room: StoredRoom, name: string | null | undefined): Promise<boolean>
  dropGroupSession(room: StoredRoom, botId: string): void
  cleanWorkDir(input: unknown): Promise<string | undefined>
  teamFolder(): string | undefined
  defaultTeamFolder(): string

  // --- provided by thinking.ts and feed.ts
  thinkingOf?: (sessionId: string, turn: number) => Promise<number | undefined>
  stateSaved?: () => void

  // --- provided by workspace-files.ts
  workspaceDownload?: (path: string) => Promise<unknown>
  workspaceDescribe?: (path: string) => Promise<unknown>
}

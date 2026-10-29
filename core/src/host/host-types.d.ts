// The DeepSeek Harness plugin API, as far as Moon Bot uses it.
//
// The host owns these shapes and must not be patched or re-exported: these are structural types for the
// context and services a plugin receives, written here so the host can be checked without
// depending on files inside a host install. When the host changes an API, this file changes.
//
// Nothing in this module runs: it is types only, so JS and TS host code can both use it.

/** The disposer cordis hands back for anything it registers. */
export type Disposer = () => void

export interface PluginFiber {
  await?(): Promise<unknown>
  dispose(): unknown
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// ---------------------------------------------------------------------------
// Sessions and agents

export interface SessionHeader {
  /** The folder the host runs the session's tools in. */
  readonly cwd?: string
  readonly [key: string]: unknown
}

export interface SessionEvent {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: SessionEventData
}

/** The payload of a Session event. `turn`/`step` identify the turn the event belongs to. */
export interface SessionEventData {
  readonly turn?: number
  readonly step?: number
  readonly source?: Record<string, unknown>
  readonly [key: string]: unknown
}

/** One message the host put in a Session's inbox, as a plugin sees it before delivery. */
export interface InboxMessage {
  readonly id: string
  readonly source?: Record<string, unknown>
  readonly content?: unknown
}

export interface LoaderService {
  import?(specifier: string): Promise<unknown>
  unwrapExports?(loaded: unknown): unknown
}

export interface AgentSession {
  readonly id: string
  readonly seq: number
  readonly header?: SessionHeader
  /** The event at `seq`, when the host keeps history in memory. */
  readonly surface?: { readonly nodes: readonly number[] }
  eventAt?(seq: number): SessionEvent | undefined
  deriveEventMessage?(event: SessionEvent): { readonly content?: readonly MessageContentBlock[] } | undefined
  append?(type: string, data: unknown): unknown
  deriveMessages?(): unknown[]
}

export interface SessionInbox {
  readonly nextStep: readonly InboxMessage[]
  readonly nextTurn: readonly InboxMessage[]
  remove(id: string): boolean
}

export interface Agent {
  readonly id: string
  readonly session: AgentSession
  readonly inbox?: SessionInbox
  readonly status?: string
  /** An Agent carries its own tool surface, which the Agent page restricts. */
  readonly ctx?: {
    readonly tools?: { restrict?(options: { readonly deny: readonly string[] }): void }
    plugin?(plugin: unknown, config?: unknown): PluginFiber
    effect?(execute: () => void | Disposer, label?: string): void
  }
  followup(message: unknown): void
  steer(message: unknown): void
  inject(message: unknown): void
  cancel(cause?: { readonly kind?: string; readonly reason?: string }): void
  whenIdle?(): Promise<void>
  runMaintenance?<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** `agent/status`: a Bot's agent changed status. */
export interface AgentStatusEvent {
  readonly agent: Agent
  readonly status?: string
}

/** One frame of the reply a model is writing. */
export interface AssistantStreamFrame {
  readonly type: string
  readonly attemptId: string
  readonly turn?: number
  readonly chunk?: { readonly type?: string; readonly text?: string }
}

/** `agent/assistant-stream`: an attempt starts, streams a chunk, or ends. */
export interface AssistantStreamEvent {
  readonly agent: Agent
  readonly frame: AssistantStreamFrame
}

export interface SessionCreateOptions {
  /** A folder outside the team workspace; the host makes the session by cwd alone. */
  readonly cwd?: string
  readonly workspaceId?: string
  readonly agentPreset?: string
}

export interface SessionPageRecord {
  readonly event: SessionEvent
}

export interface SessionPage {
  readonly records: readonly SessionPageRecord[]
  readonly hasMore: boolean
}

/** A Session's page address: its own id, or a subagent read through its parent. */
export type SessionAddress =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'subagent'; readonly parentSessionId: string; readonly childSessionId: string; readonly mode?: string }

/** A listing row's projection block; only a 'sequenced' block shares the log's seq. */
export interface SessionProjectionHint {
  readonly kind?: string
  readonly asOfSeq?: number
  readonly values?: Readonly<Record<string, unknown>>
}

/** One row of `sessionController.list`. */
export interface SessionListEntry {
  readonly sessionId: string
  readonly parentSessionId?: string
  readonly origin?: string
  readonly blank?: boolean
  readonly projections?: SessionProjectionHint
}

export interface SessionListing {
  readonly items?: readonly SessionListEntry[]
}

/** A Session's exact projection watermark, read when the listing carries no hint. */
export interface SessionProjections {
  readonly asOfSeq?: number
  readonly values?: Readonly<Record<string, unknown>>
}

export interface SessionController {
  create(options: SessionCreateOptions): Promise<{ readonly sessionId: string }>
  resolveAgent(sessionId: string): Promise<
    { readonly agent: Agent } | { readonly error: { readonly code?: string; readonly message?: string } }
  >
  /** Every Session the host knows, including archived parts and subagents. */
  list(options: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<SessionListing>
  /** A Session's projection watermark; null once the Session is gone. */
  projections(options: { readonly sessionId: string }, signal?: AbortSignal): Promise<SessionProjections | null | undefined>
  page(options: {
    readonly address: SessionAddress
    readonly throughSeq?: number
    readonly beforeSeq?: number
    readonly maxMessages?: number
  }, signal?: AbortSignal): Promise<SessionPage>
  selectModel(options: { readonly sessionId: string; readonly provider: string; readonly model: string; readonly reasoningEffort?: string }): Promise<{ readonly selected?: ModelSelection }>
  /** Admit one prompt after explicitly resuming its Session. */
  prompt(request: {
    readonly requestId: string
    readonly sessionId: string
    readonly mode: 'queue' | 'steer'
    readonly content: readonly MessageContentBlock[]
    readonly clientTimeZone?: string
  }, signal?: AbortSignal): Promise<{ readonly accepted: true }>
}

export interface SessionsService {
  flush(session: unknown): Promise<void>
  readonly messageProjections: readonly { readonly type: string }[]
  list?: { getSnapshot?(): { readonly byId?: Record<string, unknown> } }
  refreshProjections?(sessionId: string): Promise<void>
}

export interface SessionTitleService {
  rename(session: unknown, title: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Session events a plugin listens to

export type MessageContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool-call'; readonly [key: string]: unknown }
  | { readonly type: 'file'; readonly attachment?: unknown }
  | { readonly type: 'image'; readonly [key: string]: unknown }
  | { readonly type: string; readonly [key: string]: unknown }

export interface UserMessageEvent {
  readonly content?: readonly MessageContentBlock[]
  readonly source?: Record<string, unknown>
}

export interface AssistantMessageEvent {
  readonly turn?: number
  readonly step?: number
  readonly message?: { readonly content?: readonly MessageContentBlock[] }
}

/** A message's delivery source, as the host reads it back. */
export interface LlmMessageSource {
  readonly kind?: unknown
  readonly [key: string]: unknown
}

/** A user message as the inbox carries it. */
export interface LlmUserMessage {
  readonly role?: 'user'
  readonly content: readonly unknown[]
  readonly source?: LlmMessageSource | undefined
  readonly [key: string]: unknown
}

/** One text block of a message. */
export interface LlmTextBlock {
  readonly type: 'text'
  readonly text: string
  readonly [key: string]: unknown
}

/** A tool's execution context, the slice the tools read. */
export interface ToolRunContext {
  readonly name?: string | undefined
  readonly callId?: string | undefined
  readonly agent?: { readonly id?: string, readonly session?: unknown, readonly [key: string]: unknown } | undefined
  readonly signal?: AbortSignal | undefined
  concludeTurn?(): void
  readonly [key: string]: unknown
}

export interface TurnEndReason {
  readonly kind?: 'completed' | 'aborted' | 'error' | string
  readonly error?: { readonly code?: string; readonly message?: string; readonly status?: number }
}

export interface TurnEndEvent {
  readonly turn?: number
  readonly reason?: TurnEndReason
}

// ---------------------------------------------------------------------------
// Tools

export interface ToolParameter {
  readonly type: string
  readonly description?: string
  readonly enum?: readonly string[]
  readonly items?: ToolParameter
  readonly [key: string]: unknown
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, ToolParameter>>
  readonly output?: unknown
  execute(args: Readonly<Record<string, unknown>>, exec: ToolExecution): Promise<unknown>
}

export interface ToolExecution {
  readonly name?: string
  readonly callId?: string
  readonly agent?: Agent
  readonly signal?: AbortSignal
}

export interface ToolsService {
  register(tool: ToolDefinition): Disposer
  guard(guard: (exec: ToolExecution) => Promise<unknown> | unknown): void
  schemas(agent?: unknown): readonly { readonly name: string }[]
}

// ---------------------------------------------------------------------------
// LLM, workspaces, connections

export interface LlmService {
  listProviders(): readonly LlmProvider[]
  listModels(providerId: string): Promise<readonly LlmModel[]>
  resolveModelInfo(provider: string, model: string): Promise<LlmModelInfo>
  stream(options: unknown): AsyncIterable<unknown>
  listConfigurableProviders(): readonly ConfigurableProvider[]
  discoverModels(adapter: string, request: unknown): Promise<readonly LlmModel[]>
}

export interface Workspace {
  readonly id: string
  readonly path: string
  readonly title?: string
}

export interface WorkspaceRegistry {
  get(id: string | undefined): Workspace | undefined
  list?(): readonly Workspace[]
  resolveByPath(path: string): Promise<Workspace | undefined>
  create(path: string, title?: string): Promise<Workspace>
  archiveSession(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
}

export interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody?: 'buffered' | 'stream'
  fetch(request: Request): Promise<Response>
}

export interface ConnectionService {
  readonly fetch: { register(route: FetchRoute): Disposer }
}

export interface PromptSectionContext {
  readonly agent?: { readonly id?: string }
}

export interface PromptSection {
  readonly name: string
  readonly order: number
  readonly interpolate?: boolean
  text(context: PromptSectionContext | undefined): string
}

export interface SystemPromptService {
  section(section: PromptSection): Disposer
}

// ---------------------------------------------------------------------------
// Services a plugin asks for by name (`ctx.get`)

export interface AttachmentRef {
  readonly attachmentId: string
  readonly name: string
  readonly bytes?: number
}

export interface AttachmentsService {
  saveFile(input: { readonly data: Uint8Array; readonly name: string }): Promise<AttachmentRef>
  readFileStream(ref: AttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

export interface ApprovalRequest {
  readonly agent: Agent
  readonly toolName?: string
  readonly callId?: string
  readonly reason: string
  readonly displayReason?: { readonly en: string; readonly zh?: string }
  readonly signal?: AbortSignal
}

export type ApprovalOutcome = 'allowed-once' | 'allowed' | 'rejected' | 'cancelled'

export interface ApprovalService {
  request(request: ApprovalRequest): Promise<ApprovalOutcome>
}

export interface SandboxPolicy {
  resolve(input?: { readonly session?: AgentSession }): { readonly mode: string }
}

export interface WorkingDirectoryService {
  get(session: AgentSession): string | undefined
  set(agent: Agent, path: string, signal?: AbortSignal): Promise<void>
}

export interface DirectoryListing {
  readonly path: string
  readonly home: string
  readonly crumbs: readonly unknown[]
  readonly entries: readonly unknown[]
  readonly truncated?: boolean
}

export interface DirectoryPicker {
  capability(): {
    readonly kind: 'native' | 'browse' | string
    pick(signal?: AbortSignal): Promise<string>
    list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  }
}

export interface AgentPresetsService {
  list(): Promise<readonly { readonly id: string; readonly broken?: string }[]>
}

export interface LocaleService {
  getLocale(): { readonly active: string }
}

/** A provider a Session may run on. */
export interface LlmProvider {
  readonly id: string
  readonly name?: string
}

/** A model a provider serves. */
export interface LlmModel {
  readonly id: string
  readonly name?: string
  readonly inputModalities?: readonly string[]
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** One thinking level a model serves. */
export interface LlmReasoningEffort {
  readonly id: string
  readonly name?: string
  readonly description?: string
}

export interface LlmReasoning {
  readonly efforts?: readonly LlmReasoningEffort[]
  readonly defaultEffort?: string
}

/** What a model declares: its modalities and thinking levels. */
export interface LlmModelInfo {
  readonly id?: string
  readonly name?: string
  readonly inputModalities?: readonly string[]
  readonly reasoning?: LlmReasoning
  /** The window the model declares for context, when it declares one. */
  readonly context?: { readonly contextWindow?: unknown } | undefined
  /** The output budget the model serves by default. */
  readonly defaultMaxTokens?: unknown
}

/** One chunk of a model stream, as `BlockAssembler` takes it. */
export interface LlmStreamChunk {
  readonly type?: string
  readonly [key: string]: unknown
}

/** A block the assembler collected. */
export interface LlmBlock {
  readonly type: string
  readonly text?: string
  readonly [key: string]: unknown
}

/** How a stream ended. */
export interface LlmStreamFinish {
  readonly kind: string
  readonly failure?: { readonly message?: string }
}

/** The options a `llm/stream` request carries. */
export interface LlmStreamOptions {
  readonly provider: string
  readonly model: string
  readonly sessionId?: string
  readonly messages: readonly unknown[]
  /** The system prompt this request carries; the secrets listener redacts it in place. */
  readonly system?: unknown
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

/** A model selection, as the profile's default model and a Session keep it. */
export interface ModelSelection {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** The profile's default model service (`agentDefaultModel`). */
export interface AgentDefaultModelService {
  currentSelection?(): ModelSelection | undefined
  saveSelection?(selection: ModelSelection): Promise<unknown>
}

/** One provider the host's directory of configurable providers offers. */
export interface ConfigurableProvider {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly declared?: boolean
  readonly error?: string
}

/** One settings section as `settings.describe` shows it. */
export interface SettingsSection {
  readonly ns: string
  readonly revision?: number
  readonly value?: Readonly<Record<string, unknown>>
  readonly user?: Readonly<Record<string, unknown>>
  readonly base?: Readonly<Record<string, unknown>>
}

export interface SettingsOperation {
  readonly op: string
  readonly path: readonly string[]
  readonly value?: unknown
}

export interface SettingsService {
  describe(options: { readonly redactSecrets: boolean }): readonly SettingsSection[]
  mutate(ns: string, operations: readonly SettingsOperation[], revision?: number): Promise<unknown>
}

/** Whether a credential reference holds a value, and whether this plugin may change it. */
export interface CredentialInfo {
  readonly configured?: boolean
  readonly writable?: boolean
}

export interface CredentialsService {
  describe(ref: string): Promise<CredentialInfo>
  set(ref: string, value: string): Promise<unknown>
  unset(ref: string): Promise<unknown>
}

/** A plugin manager's registry configuration. */
export interface PluginManagerRegistries {
  readonly registry?: string
  readonly resolved?: string
  readonly fallbackRegistries?: readonly string[]
}

/** A bundle the host's plugin manager installed. */
export interface PluginManagerBundle {
  readonly name?: string
  readonly source?: unknown
}

/** the host's plugin manager, as far as the update check reads it. */
export interface PluginManagerService {
  registries?(): Promise<PluginManagerRegistries | null> | PluginManagerRegistries | null
  listBundles?(): Promise<readonly PluginManagerBundle[]> | readonly PluginManagerBundle[] | null
  installBundle?(spec: string, options?: { readonly registry?: string }): Promise<unknown> | unknown
}

/** The profile this plugin runs in. */
export interface ProfileContextService {
  readonly dir?: string
  readonly packageManager?: { readonly command?: string }
}

/** The services `ctx.get(name)` may return, by the names the host asks for. */
export interface DshServices {
  readonly attachments: AttachmentsService
  readonly approval: ApprovalService
  readonly sandboxPolicy: SandboxPolicy
  readonly workingDirectory: WorkingDirectoryService
  readonly directoryPicker: DirectoryPicker
  readonly agentPresets: AgentPresetsService
  readonly locale: LocaleService
}

export type DshServiceName = keyof DshServices

// ---------------------------------------------------------------------------
// The plugin context

export interface HostContext {
  readonly logger: Logger
  get<T>(name: string): T | undefined
  // The second argument is `next()` for a waterfall event and another value for events
  // that pass one (a Session and its new event, say), so the caller names its type.
  on<TPayload = unknown, TSecond = unknown>(
    name: string,
    listener: (payload: TPayload, second: TSecond) => unknown,
    options?: { readonly prepend?: boolean },
  ): Disposer
  emit?(name: string, payload: unknown): void
  effect(execute: () => void | Disposer, label?: string): void
  plugin?(plugin: unknown, config?: unknown): PluginFiber
  inject?(dependencies: readonly string[], inject: (ctx: HostContext) => void): void
  readonly tools: ToolsService
  readonly llm: LlmService
  readonly sessions: SessionsService
  readonly sessionController: SessionController
  readonly sessionTitle: SessionTitleService
  readonly workspaceRegistry: WorkspaceRegistry
  readonly connection: ConnectionService
  readonly systemPrompt: SystemPromptService
  readonly fiber?: unknown
}

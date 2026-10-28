// Client channel: the team view the browser renders, and the POST /api/bot endpoints.
//
// The handlers live in `channel/` by area; this file keeps the public surface, the
// shared read-only and error handling, and the Fetch route. Endpoint names come from
// `src/shared/rpc.ts`, so a typo in the handler map fails to compile.
import type { ChatPage, RpcEndpoint, WorkBot } from '../shared/rpc.ts'
import type { AttachmentRef } from './dsh-types.ts'
import type { ExchangeEntry, HostRuntime, ModelReasoning, StoredAgent, StoredBot, StoredRoom } from './runtime.js'
import { ROUTE } from './constants.ts'
import type {
  BrowserChannel,
  ChannelBody,
  ChannelHandlers,
  ChannelResult,
  DiagnosticsService,
  FailureNote,
  MessageText,
  PermissionCatalog,
  RoomProgress,
  RoomWork,
  WorkspaceDownload,
  WorkspaceDescription,
} from './channel/envelope.ts'
import { errorCode, fail, failureCodeOf, messageOf, recordOf, stackOf } from './channel/envelope.ts'
import { hostHandlers } from './channel/ops-host.ts'
import { teamHandlers } from './channel/ops-team.ts'
import { engineHandlers } from './channel/ops-engines.ts'
import { relayHandlers } from './channel/ops-relay.ts'
import { taskHandlers } from './channel/ops-tasks.ts'
import type { LocaleState } from './channel/ops-team.ts'
import type { SecretView } from './secrets/store.ts'

/** What a Bot is created with; `roster.js` normalizes every field itself. */
export interface CreateBotOptions {
  readonly name: unknown
  readonly role?: unknown
  readonly color?: unknown
  readonly instructions?: unknown
  readonly brief?: unknown
  readonly avatar?: unknown
  readonly model?: unknown
  readonly effort?: unknown
  readonly workDir?: unknown
  readonly engine?: unknown
  readonly runtimeId?: unknown
}

/** What a group is created with; `roster.js` normalizes every field itself. */
export interface CreateRoomOptions {
  readonly members: readonly unknown[]
  readonly name?: unknown
  readonly admin?: string
}

/**
 * The runtime a channel handler sees. It is `HostRuntime` plus the methods the host
 * modules install for the channel; `runtime.ts` keeps the shared slice, this adds the
 * rest of this module's surface without forcing the shared file over the line gate.
 */
export interface ChannelRuntime extends HostRuntime {
  uiLanguage?: () => string | undefined
  browserEnabled?: boolean
  browserChannel?: BrowserChannel
  memoryEnabled?: boolean

  refresh(): Promise<void>
  bootstrap(): Promise<void>
  cachedDefault(): string | undefined
  reasoningOf(ref: string): Promise<ModelReasoning | undefined>
  thinkingOf(sessionId: string, turn: number): Promise<number | undefined>
  approvalsView(): readonly { readonly botId: string; readonly sessionId: string; readonly tool?: string; readonly at: number }[]
  browserOpen(value: unknown): Record<string, { readonly url: string; readonly title: string }>
  waitingView?(): Readonly<Record<string, { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }>>
  turnsView?(): Readonly<Record<string, number>>

  providersView(): Promise<Record<string, unknown>>
  clearProviderKey(provider: string): Promise<void>
  setProviderKey(provider: string, value: unknown): Promise<void>
  addProvider(body: ChannelBody): Promise<Record<string, unknown>>
  discoverModels(body: ChannelBody): Promise<readonly Record<string, unknown>[]>
  removeProvider(provider: string): Promise<Record<string, unknown>>

  duplicateBot(id: unknown): Promise<StoredBot>
  createBot(options: CreateBotOptions): Promise<StoredBot>
  updateBot(id: unknown, patch: ChannelBody): Promise<StoredBot>
  deleteBot(id: unknown): Promise<void>
  setMain(id: unknown, main: boolean, options: { readonly primary?: boolean; readonly replace?: string | undefined }): Promise<void>
  setFlags(id: unknown, patch: ChannelBody): Promise<unknown>
  createRoom(options: CreateRoomOptions): Promise<StoredRoom>
  updateRoom(id: unknown, patch: ChannelBody): Promise<{ readonly room: StoredRoom; readonly changes: readonly string[] }>
  deleteRoom(id: unknown): Promise<void>
  greetRoom(roomId: string): Promise<void>

  folderEndpoint(endpoint: string, body: ChannelBody, signal: AbortSignal): Promise<unknown>
  setTeamWorkspace(path: string): Promise<string>

  addAgent(): Promise<StoredAgent>
  createAgentSession(agentId: unknown, workspaceId?: unknown): Promise<string>
  adoptAgentSession(agentId: unknown, sessionId: unknown): Promise<string>
  archiveAgentSession(agentId: unknown, sessionId: unknown): Promise<void>
  renameAgentSession(agentId: unknown, sessionId: unknown, title: unknown): Promise<void>
  removeAgent(agentId: unknown): Promise<void>

  answerApproval(id: unknown, choice: unknown): void
  stopMemberWork(roomId: string, botId: string): Promise<boolean>

  exchangeText(entry: ExchangeEntry): Promise<MessageText>
  fileText(file: AttachmentRef): Promise<MessageText | undefined>
  earlierPage(sessionId: string, cursor: unknown): Promise<ChatPage & { readonly startedAt: number | null }>
  chatPage(botId: string, cursor: unknown): Promise<ChatPage>

  roomProgress: ReadonlyMap<string, RoomProgress>

  secretsView(): readonly SecretView[]
  capabilityLibraryView(): readonly Readonly<Record<string, unknown>>[]
  capabilityStatusesView(): Readonly<Record<string, Readonly<Record<string, unknown>>>>
  capabilityToolsView(): Readonly<Record<string, readonly string[]>>
  permissionCatalog?(): PermissionCatalog | undefined
  memoryNews(): Readonly<Record<string, unknown>>
  memoryReviews(): number
  connectorsView(): readonly Readonly<Record<string, unknown>>[]
  activityView(): Readonly<Record<string, string>>
  workView(): Readonly<Record<string, WorkBot>>
  roomWorkView(): Readonly<Record<string, readonly RoomWork[]>>

  secretEndpoint(endpoint: string, body: ChannelBody): Promise<unknown>
  connectorEndpoint(endpoint: string, body: ChannelBody): Promise<unknown>
  capabilityEndpoint(endpoint: string, body: ChannelBody): Promise<unknown>
  scheduleEndpoint(endpoint: string, body: ChannelBody): Promise<unknown>
  memoryEndpoint(endpoint: string, body: ChannelBody): Promise<unknown>

  workspaceDownload(path: unknown): Promise<WorkspaceDownload>
  workspaceDescribe(path: unknown): Promise<WorkspaceDescription>

  /** Deliverables (2026-10-28 files-and-library): the files a turn left behind. */
  deliverablesOf?(sessionId: string, turn: number): readonly { readonly name: string; readonly path: string; readonly size: number; readonly createdAt: number }[]
  libraryOf?(options: { readonly since?: number | undefined; readonly limit?: number | undefined }): readonly { readonly sessionId: string; readonly turn: number | null; readonly ownerId: string | null; readonly name: string; readonly path: string; readonly size: number; readonly createdAt: number }[]

  noteFailure(entry: FailureNote): void
  diagnostics: DiagnosticsService

  updateCheck(options?: { readonly fresh?: boolean }): Promise<Record<string, unknown> | undefined>
  updateStart(): Record<string, unknown>
  repoStars(): Promise<number | null>
}


const LANGUAGES: Readonly<Record<string, string>> = { zh: 'Chinese (简体中文)', en: 'English' }

// What a host that only reads the team may still answer.
// Updates change the dsh profile, not the team, so a reading host may run them too.
const READS: ReadonlySet<RpcEndpoint> = new Set<RpcEndpoint>(['state', 'models', 'efforts', 'engines', 'providers', 'provider-models', 'earlier', 'chat', 'run-stats', 'room-progress', 'exchange', 'exchange-text', 'file-text', 'usage', 'schedules', 'memory-view', 'browser-wait', 'browser-result', 'diagnostics', 'diagnostics-log', 'diagnostics-clear', 'update-check', 'update-install', 'repo-stars', 'approval-answer', 'thinking', 'workspace-download', 'workspace-describe'])

export function install(rt: ChannelRuntime): void {
  const { ctx } = rt

  // The DSH interface language of the last browser that asked for the team.
  const locale: LocaleState = { value: undefined }
  rt.uiLanguage = (): string | undefined => {
    if (locale.value === undefined) return undefined
    return LANGUAGES[(locale.value.split('-')[0] ?? '').toLowerCase()] ?? locale.value
  }

  const handlers: ChannelHandlers = { ...teamHandlers(rt, locale), ...hostHandlers(rt), ...engineHandlers(rt), ...relayHandlers(rt), ...taskHandlers(rt) }

  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<ChannelResult> => {
    try {
      const body = (payload ?? {}) as ChannelBody
      await rt.refresh()
      const readOnly = rt.readOnly()
      if (readOnly !== undefined && !READS.has(endpoint as RpcEndpoint)) return fail(readOnly, 'bot/read-only')
      const handler = handlers[endpoint as RpcEndpoint]
      if (handler === undefined) return fail(`Unknown endpoint ${endpoint}`, 'bot/not-found')
      return await handler(body, signal)
    } catch (error) {
      const code = errorCode(error)
      const message = messageOf(error)
      if (code === 'bot/internal') rt.noteFailure({ source: 'api', text: `${endpoint}: ${message}`, code: failureCodeOf(error), stack: stackOf(error) })
      return fail(message, code)
    }
  }

  // An exact Fetch route on the shared /api channel; the browser authenticates with its session cookie.
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try { body = await request.json() } catch { body = {} }
      const record = recordOf(body) ?? {}
      const result = await handle(String(record.endpoint ?? ''), record.payload, request.signal)
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }), 'ds-bot: api route')

  ctx.effect(() => {
    void rt.load()
    return () => {}
  }, 'ds-bot: load state')
}

export { errorCode } from './channel/envelope.ts'

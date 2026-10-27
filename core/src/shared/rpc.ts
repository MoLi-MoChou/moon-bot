// The one table both ends of the plugin's channel share: every `api/bot` endpoint with the
// payload it takes and the value it answers. The client's `call(endpoint, payload)` and the
// host's `handle(endpoint, payload)` are typed from this map, so a renamed endpoint or a
// changed payload fails to compile on whichever side was left behind.
//
// Phase 1 declares the map against the current endpoints; Phase 4 makes the host
// handlers conform to it.
import type {
  BotView,
  ExchangeTurn,
  MemoryEntry,
  MemoryLimits,
  ProducedFile,
  RoomView,
  SchedulesView,
} from './schema.js'
import type { WidgetView } from './views.ts'

/** The error codes the host raises, plus the two the client makes up itself. */
export type RpcErrorCode =
  | 'bot/invalid'
  | 'bot/stale'
  | 'bot/not-found'
  | 'bot/browser-off'
  | 'bot/unavailable'
  | 'bot/read-only'
  | 'bot/refused'
  | 'bot/internal'
  | 'bot/error'
  | 'NETWORK'
  | `HTTP_${number}`

/** The envelope every endpoint answers with. */
export type RpcResultBody<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcError }

export interface RpcError {
  readonly code: RpcErrorCode
  readonly message: string
  readonly details?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Shared pieces

export interface ChatCursor {
  readonly part?: number
  readonly beforeSeq?: number
}

export interface ChatItem {
  readonly kind: 'bot' | 'user' | 'event' | 'divider' | 'answer'
  readonly text?: string
  readonly time: number
  readonly turn?: number
  readonly produced?: readonly ProducedFile[]
  readonly producedMore?: number
}

export interface ChatPage {
  readonly sessionId: string
  readonly items: readonly ChatItem[]
  readonly cursor: ChatCursor | null
}

export interface ActivityView {
  readonly [botId: string]: string
}

export interface WorkBot {
  readonly since?: number
  readonly tool?: string
  readonly said?: string
  readonly note?: string
  readonly target?: string
  readonly switching?: boolean
  readonly roomId?: string
}

export interface WorkView {
  readonly bots: Record<string, WorkBot>
  readonly rooms: Record<string, readonly { readonly botId: string; readonly since?: number; readonly speaking?: boolean }[]>
  readonly approvals: readonly { readonly botId: string; readonly callId?: string; readonly text?: string; readonly code?: string }[]
  readonly waiting: Record<string, string>
  readonly turns: Record<string, number>
}

export interface RunnerStats {
  readonly [key: string]: unknown
}

export interface TurnFileEntry {
  readonly produced: readonly ProducedFile[]
  readonly more?: number
}

/** `state` answers with `unchanged: true` when nothing but live figures moved. */
export interface StateView {
  readonly revision: number
  readonly unchanged?: boolean
  readonly workspaceId: string | null
  readonly mainBotId: string | null
  readonly mainBotIds: readonly string[]
  readonly bots: readonly BotView[]
  readonly rooms: readonly RoomView[]
  readonly activity: ActivityView
  readonly work: WorkView
  readonly exchangeTurns: Record<string, readonly number[]>
  readonly turnFiles: Record<string, { readonly turns: Record<string, TurnFileEntry> }>
  readonly questions: Record<string, unknown>
  readonly views: Record<string, unknown>
  readonly agents: readonly Record<string, unknown>[]
  readonly secrets: readonly Record<string, unknown>[]
  readonly capabilities: readonly Record<string, unknown>[]
  readonly models: readonly Record<string, unknown>[]
  readonly defaultModel: string | null
  readonly prefs: Record<string, unknown>
  readonly readOnly?: string | null
}

export interface StateRequest {
  readonly since?: number
  readonly models?: string
  readonly locale?: string
}

/** One relay invite, as the settings page reads it (2026-10-27 remote-agents). */
export interface RelayInviteView {
  readonly agentId: string
  readonly createdAt: number
  readonly revokedAt: number | null
  readonly lastSeenAt: number | null
  readonly online: boolean
}

// -----------------------------------------------------------------__________
// The endpoint map

export interface BotChannelRpcMap {
  // Reading the team
  state: { request: StateRequest; response: StateView }
  models: { request: Record<string, never>; response: readonly Record<string, unknown>[] }
  efforts: { request: { model?: string }; response: readonly Record<string, unknown>[] }
  thinking: { request: Record<string, never>; response: Record<string, unknown> }
  providers: { request: Record<string, never>; response: readonly Record<string, unknown>[] }
  'provider-key': { request: { provider: string; key?: string }; response: Record<string, unknown> }
  'provider-add': { request: { protocol: string; base?: string; key?: string }; response: readonly Record<string, unknown>[] }
  'provider-models': { request: { provider?: string }; response: readonly string[] }
  'provider-remove': { request: { provider: string }; response: readonly Record<string, unknown>[] }
  'duplicate-bot': { request: { id: string }; response: BotView }
  'set-prefs': { request: { theme?: string | null; accent?: string | null; motion?: string | null }; response: Record<string, unknown> }

  // Engines (plan §四): which runtime runs each Bot's turns — the built-in one, or an
  // ACP agent registered as a Bot. The list reads; `engine-set` moves one Bot.
  engines: { request: Record<string, never>; response: { readonly engines: readonly { readonly id: string; readonly label: string; readonly kind: string }[]; readonly of: Readonly<Record<string, string>> } }
  'engine-set': { request: { botId: string; engine: string }; response: { readonly of: Readonly<Record<string, string>> } }

  // Remote agents (2026-10-27 remote-agents): invites for the relay, and who is online.
  // The create answer carries the token once — the UI shows it, the store keeps a hash.
  'relay-invites': { request: Record<string, never>; response: { readonly invites: readonly RelayInviteView[] } }
  'relay-invite-create': { request: { agentId: string }; response: { readonly agentId: string; readonly token: string } }
  'relay-invite-revoke': { request: { agentId: string }; response: { readonly invites: readonly RelayInviteView[] } }

  // Conversations
  chat: { request: { botId: string; cursor?: ChatCursor }; response: ChatPage }
  earlier: { request: { sessionId: string; cursor?: ChatCursor }; response: ChatPage & { startedAt: number | null } }
  exchange: { request: { a: string; b: string }; response: readonly ExchangeTurn[] }
  'exchange-text': { request: { id: string }; response: { readonly text: string; readonly whole: boolean } }
  'file-text': { request: { file: Record<string, unknown> }; response: { readonly text: string; readonly whole: boolean } }
  // The files a turn left behind (2026-10-28 files-and-library): cards in the chat,
  // and the library page across sessions. Paths are workspace-relative.
  'turn-files': { request: { sessionId: string; turn: number }; response: { readonly files: readonly { readonly name: string; readonly path: string; readonly size: number; readonly createdAt: number }[] } }
  'library': { request: { since?: number; limit?: number }; response: { readonly items: readonly { readonly sessionId: string; readonly turn: number | null; readonly ownerId: string | null; readonly name: string; readonly path: string; readonly size: number; readonly createdAt: number }[] } }
  'workspace-download': { request: { path: string; sessionId?: string }; response: { readonly name: string; readonly mime: string; readonly size: number; readonly data: string; readonly folder?: boolean } }
  'workspace-describe': { request: { path: string; sessionId?: string }; response: { readonly name: string; readonly size: number; readonly folder: boolean; readonly mime: string; readonly modified: string; readonly downloadable: boolean } }
  'run-stats': { request: { sessionId: string }; response: RunnerStats }
  usage: { request: { timeZone?: string }; response: Record<string, unknown> }
  'room-progress': { request: { roomId: string }; response: readonly Record<string, unknown>[] }

  // Bots and groups
  'create-bot': { request: { name: string; role?: string; instructions?: string; color?: string; brief?: string; avatar?: Record<string, unknown>; model?: string; effort?: string; workDir?: string }; response: BotView }
  'update-bot': { request: { id: string; [field: string]: unknown }; response: BotView }
  'delete-bot': { request: { id: string }; response: StateView }
  'set-main': { request: { id: string; main: boolean; primary?: boolean; replace?: string }; response: StateView }
  'create-room': { request: { members: readonly string[]; name?: string; admin?: string; greet?: boolean }; response: RoomView }
  'update-room': { request: { id: string; [field: string]: unknown }; response: { readonly room: RoomView | undefined; readonly changes: readonly string[] } }
  'delete-room': { request: { id: string }; response: StateView }
  folders: { request: Record<string, never>; response: { readonly team: string; readonly picker: string | null; readonly folders: readonly { readonly path: string; readonly title: string }[] } }
  'folder-pick': { request: Record<string, never>; response: string }
  'folder-list': { request: { path?: string }; response: Record<string, unknown> }
  'team-workspace': { request: { path: string }; response: { readonly team: string } }
  'set-flags': { request: { id: string; pinned?: boolean; hidden?: boolean }; response: Record<string, unknown> }

  // Agents (plain dsh Sessions the team can see)
  'add-agent': { request: { sessionId: string; name?: string }; response: StateView }
  'agent-session': { request: Record<string, unknown>; response: StateView }
  'agent-adopt': { request: Record<string, unknown>; response: StateView }
  'agent-archive': { request: Record<string, unknown>; response: StateView }
  'agent-rename': { request: Record<string, unknown>; response: StateView }
  'remove-agent': { request: Record<string, unknown>; response: StateView }

  // Turns, questions, views, approvals
  // These take the current part's **Session id** (client resolves it through `partFor()`),
  // never a Bot id.
  send: { request: { sessionId: string; text: string }; response: Record<string, unknown> }
  'answer-question': { request: { sessionId: string; questionId: string; answer?: unknown }; response: Record<string, unknown> }
  'view-reply': { request: { sessionId: string; viewId: string; action?: string; values?: Record<string, unknown> }; response: Record<string, unknown> }
  'approval-answer': { request: { id: string; choice: string }; response: Record<string, unknown> }
  'stop-member-work': { request: { roomId: string; botId: string }; response: Record<string, unknown> }
  'dismiss-question': { request: { sessionId: string }; response: Record<string, unknown> }
  'dismiss-view': { request: { sessionId: string }; response: Record<string, unknown> }

  // Keys and connectors
  'secret-set': { request: Record<string, unknown>; response: Record<string, unknown> }
  'secret-allow': { request: Record<string, unknown>; response: Record<string, unknown> }
  'secret-cancel': { request: Record<string, unknown>; response: Record<string, unknown> }
  'secret-update': { request: Record<string, unknown>; response: Record<string, unknown> }
  'secret-delete': { request: { name: string }; response: Record<string, unknown> }
  'connector-connect': { request: Record<string, unknown>; response: Record<string, unknown> }
  'connector-disconnect': { request: Record<string, unknown>; response: Record<string, unknown> }
  'connector-retry': { request: Record<string, unknown>; response: Record<string, unknown> }
  'capability-save': { request: Record<string, unknown>; response: Record<string, unknown> }
  'capability-delete': { request: Record<string, unknown>; response: Record<string, unknown> }
  'capability-approve': { request: Record<string, unknown>; response: Record<string, unknown> }
  'bot-capability': { request: Record<string, unknown>; response: Record<string, unknown> }

  // Schedules and memory
  schedules: { request: Record<string, never>; response: SchedulesView }
  'schedule-create': { request: { target: string; title: string; prompt: string; when: Record<string, unknown> }; response: SchedulesView }
  'schedule-delete': { request: { sessionId: string; id: string }; response: SchedulesView }
  'memory-view': { request: { botId?: string; roomId?: string; summarize?: boolean; regenerate?: boolean }; response: { readonly entries: readonly MemoryEntry[]; readonly limits: MemoryLimits; readonly sizes: Record<string, number>; readonly summary: { readonly text: string; readonly at: number } | null } }
  'memory-ask': { request: { botId?: string; roomId?: string; text: string }; response: Record<string, unknown> }
  'memory-forget': { request: { botId?: string; roomId?: string; entry: string }; response: Record<string, unknown> }

  // Updates, diagnostics, browsers
  'update-check': { request: Record<string, never>; response: Record<string, unknown> }
  'update-install': { request: Record<string, never>; response: Record<string, unknown> }
  'repo-stars': { request: Record<string, never>; response: Record<string, unknown> }
  'browser-wait': { request: Record<string, unknown>; response: Record<string, unknown> }
  'browser-result': { request: Record<string, unknown>; response: Record<string, unknown> }
  diagnostics: { request: Record<string, never>; response: Record<string, unknown> }
  'diagnostics-log': { request: Record<string, never>; response: Record<string, unknown> }
  'diagnostics-clear': { request: Record<string, never>; response: Record<string, unknown> }
}

export type RpcEndpoint = keyof BotChannelRpcMap
export type RpcRequest<E extends RpcEndpoint> = BotChannelRpcMap[E]['request']
export type RpcResponse<E extends RpcEndpoint> = BotChannelRpcMap[E]['response']

/** What the client's `call` looks like, typed by the map. */
export type CallHost = <E extends RpcEndpoint>(endpoint: E, payload: RpcRequest<E>, signal?: AbortSignal) => Promise<RpcResponse<E>>

/** A view card's blueprint, for endpoints that carry one. */
export type { WidgetView }

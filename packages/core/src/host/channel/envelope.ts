// The shapes and helpers every `api/bot` handler shares: the request/response envelope,
// the runtime methods this module calls, and what the team view returns.
//
// Endpoint names and error codes come from `src/shared/rpc.ts`; this file adds no
// second list of endpoints. The runtime surface lives here rather than in `runtime.ts`
// because it is only this module's slice of the plugin, and the file gate keeps the
// shared interface from growing without bound.
import type { RpcEndpoint, RpcErrorCode, RpcResultBody, WorkBot } from '../../shared/rpc.ts'
import type { SecretView } from '../secrets/store.ts'
import type { ModelEntry, StoredAgent } from '../runtime.js'

/** A decoded `payload`; JSON has no schema, so every field is read as unknown. */
export type ChannelBody = Readonly<Record<string, unknown>>

/** What one endpoint answers: the shared envelope, with the value typed by its handler. */
export type ChannelResult = RpcResultBody<unknown>

/** One endpoint's handler. `signal` is the fetch request's abort signal. */
export type ChannelHandler = (body: ChannelBody, signal: AbortSignal) => Promise<ChannelResult>

/**
 * The handlers by endpoint. Partial because a build can carry a map from an earlier
 * version; a missing key answers `Unknown endpoint` exactly as the old switch did.
 */
export type ChannelHandlers = Readonly<Partial<Record<RpcEndpoint, ChannelHandler>>>

/** The bot entry the team view sends: stored fields, its current part, earlier parts. */
export interface BotRow {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly sessionId: string
  readonly parts: readonly string[]
  readonly waiting?: boolean
  readonly [key: string]: unknown
}

/** The group entry the team view sends: stored fields, hidden Sessions, last line. */
export interface RoomRow {
  readonly id: string
  readonly name: string
  readonly parts: readonly string[]
  readonly preview?: string
  readonly [key: string]: unknown
}

/** The team view: what changes only with a new revision. */
export interface TeamView {
  readonly revision: number
  readonly workspaceId: string | null
  readonly mainBotId: string | null
  readonly mainBotIds: readonly string[]
  readonly bots: readonly BotRow[]
  readonly rooms: readonly RoomRow[]
  readonly exchangeTurns: Readonly<Record<string, readonly number[]>>
  readonly questions: Readonly<Record<string, unknown>> | undefined
  readonly views: Readonly<Record<string, unknown>>
  readonly agents: readonly StoredAgent[]
  readonly secrets: readonly SecretView[]
  readonly capabilities: readonly Readonly<Record<string, unknown>>[]
  readonly secretRequests: Readonly<Record<string, unknown>>
  readonly colors: readonly string[]
  readonly models: readonly ModelEntry[]
  readonly defaultModel: string | null
  readonly permissions: PermissionCatalog | null
  readonly modelsKey: string
  readonly prefs: Readonly<Record<string, unknown>>
  readonly browser: boolean | undefined
  readonly memory: boolean
  readonly readOnly: string | null
}

/** A member's turn in a group, as the live view sends it. */
export interface RoomWork {
  readonly botId: string
  readonly since?: number
  readonly tool?: string
  readonly said?: string
  readonly note?: string
  readonly target?: string
  readonly switching?: boolean
  readonly speaking?: boolean
}

/** The live figures sent with every state answer. */
export interface TeamLive {
  readonly activity: Readonly<Record<string, string>>
  readonly work: {
    readonly bots: Readonly<Record<string, WorkBot>>
    readonly rooms: Readonly<Record<string, readonly RoomWork[]>>
    readonly approvals: readonly Readonly<Record<string, unknown>>[]
    readonly waiting: Readonly<Record<string, unknown>>
    readonly turns: Readonly<Record<string, number>>
  }
  readonly memoryNews: Readonly<Record<string, unknown>>
  readonly memoryReviews: number
  readonly connectors: readonly Readonly<Record<string, unknown>>[]
  readonly capabilityStatuses: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly capabilityTools: Readonly<Record<string, readonly string[]>>
}

/** A permission preset list, as the settings page asks for it. */
export interface PermissionCatalog {
  readonly options: readonly { readonly value: string }[]
  readonly defaultPreset: string
}

/** What `file-text` and `exchange-text` send. */
export interface MessageText {
  readonly text: string
  readonly whole: boolean
}

/** What `workspace-download` sends. */
export interface WorkspaceDownload {
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly data: string
  readonly folder?: boolean
}

/** What `workspace-describe` sends. */
export interface WorkspaceDescription {
  readonly name: string
  readonly size: number
  readonly folder: boolean
  readonly mime: string
  readonly modified: string
  readonly downloadable: boolean
}

/** One running group round, as `rt.roomProgress` records it. */
export interface RoomProgress {
  readonly roomId: string
  readonly replies: readonly unknown[]
  readonly members?: readonly string[]
  readonly speaking?: string | null
}

/** the host's projection state for a Session, read for `run-stats`. */
export interface SessionProjectionsService {
  snapshot(session: unknown, types: readonly string[]): { readonly values: Readonly<Record<string, unknown>> }
}

/** The Desktop window's long poll for browser reads. */
export interface BrowserChannel {
  wait(clientId: string, open: unknown): Promise<readonly Record<string, unknown>[]>
  result(payload: Readonly<Record<string, unknown>>): boolean
}

/** The diagnostics store `diagnostics`, `diagnostics-log` and `diagnostics-clear` read. */
export interface DiagnosticsService {
  report(body: ChannelBody): Promise<Record<string, unknown>>
  logText(): Promise<string>
  clear(): Promise<void>
}

/** What `noteFailure` takes, as `diagnostics.ts` reads it. */
export interface FailureNote {
  readonly source: string
  readonly text: string
  readonly code?: string | undefined
  readonly stack?: string | undefined
}

/** The empty-object answer an endpoint uses when it has nothing else to say. */
export const ok = <T>(value: T): RpcResultBody<T> => ({ ok: true, value })

/** A refusal or fault, in the envelope the client reads. */
export const fail = (message: string, code: RpcErrorCode = 'bot/error'): RpcResultBody<never> => ({
  ok: false,
  error: { code, message, details: {} },
})

/** A bad request the handler refuses itself. */
export const invalid = (message: string): Error & { readonly code: string } =>
  Object.assign(new Error(message), { code: 'bot/invalid' })

/** `error.code`, only when it is a string; works for any thrown value. */
const codeOf = (error: unknown): string | undefined => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** `error.name`, only when it is a string. */
const nameOf = (error: unknown): string | undefined => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined
  const name = (error as { readonly name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/** The message the envelope carries for a thrown value. */
export const messageOf = (error: unknown): string => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return String(error)
  const message = (error as { readonly message?: unknown }).message
  if (typeof message === 'string') return message
  return message === undefined || message === null ? String(error) : String(message)
}

/** A failed internal call's stack, for the diagnostics log. */
export const stackOf = (error: unknown): string | undefined => {
  if (error === null || typeof error !== 'object') return undefined
  const stack = (error as { readonly stack?: unknown }).stack
  return typeof stack === 'string' ? stack : undefined
}

/** The two failure names a diagnostics entry records. */
export const failureCodeOf = (error: unknown): string | undefined => codeOf(error) ?? nameOf(error)

// Programming and file system errors are DS Bot's own faults, logged with their stack;
// any other error is a refusal whose message is meant for the user.
const isInternal = (error: unknown): boolean => error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError
  || error instanceof SyntaxError || /^E[A-Z_]+$/.test(codeOf(error) ?? '')

/** The envelope code for a thrown value: its own `bot/*` code, else internal/refused. */
export function errorCode(error: unknown): RpcErrorCode {
  const code = codeOf(error)
  if (code !== undefined && code.startsWith('bot/')) return code as RpcErrorCode
  return isInternal(error) ? 'bot/internal' : 'bot/refused'
}

/** A JSON value read as an object, for fields the contract declares as records. */
export const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  value !== null && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : undefined


/** A pending question, as `parts.ts` stores and answers it. */
export interface PendingQuestion {
  readonly id: string
  readonly question?: string
  readonly detail?: string
  readonly options?: readonly { readonly label: string }[]
  readonly multiSelect?: boolean
  readonly callId?: string
}

/** A pending card, as `parts.ts` stores and answers it. */
export interface PendingView {
  readonly id: string
  readonly title: string
  readonly view: unknown
  readonly callId?: string
}

/** What `validateViewAnswer` returns: an error, or the values it accepted. */
export type ViewAnswerCheck =
  | { readonly error: string }
  | { readonly selected: readonly string[] }
  | { readonly confirmed: boolean }
  | { readonly fields: Readonly<Record<string, string>> }

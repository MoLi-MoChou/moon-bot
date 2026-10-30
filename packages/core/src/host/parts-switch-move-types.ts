/** Types extracted. */
import type { LlmMessageSource, LlmTextBlock } from './host-types.js'
import type { HostContext } from './host-types.js'
import type { TurnInfo } from './runtime.js'

/** A Bot's own chat, or its Session in one group. */
export interface SwitchOwner {
  readonly botId: string
  readonly roomId?: string | undefined
}
/** One message the switch hands on, as the host's inbox keeps it. */
export interface SwitchMessage {
  readonly id: string
  readonly content?: readonly LlmTextBlock[] | undefined
  readonly source?: LlmMessageSource | undefined
}
export type InboxTarget = 'next-step' | 'next-turn'
export interface SwitchInbox {
  readonly nextStep: readonly SwitchMessage[]
  readonly nextTurn: readonly SwitchMessage[]
  remove(id: string): boolean
  prepend(target: InboxTarget, message: SwitchMessage): void
}
export interface SwitchEvent {
  readonly type?: string
  readonly data?:
    | {
        readonly reason?:
          | { readonly kind?: string; readonly error?: { readonly code?: string | undefined } | undefined }
          | undefined
      }
    | undefined
}
export interface SwitchSession {
  readonly id: string
  readonly seq: number
  readonly header?: { readonly cwd?: string | undefined } | undefined
  deriveMessages(): readonly { readonly role?: unknown }[]
  eventAt?(seq: number): SwitchEvent | undefined
  requestHeader():
    | {
        readonly config?:
          | { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: string | undefined }
          | undefined
      }
    | undefined
}
export interface SwitchAgent {
  readonly id: string
  readonly session: SwitchSession
  readonly inbox: SwitchInbox
  readonly status?: string | undefined
  followup(message: unknown): void
  inject(message: unknown): void
  send(message: SwitchMessage, target: InboxTarget, wake: boolean): void
  whenIdle(): Promise<void>
  runMaintenance<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>
}
export type SwitchFallback = 'whole' | 'failure' | 'overflow' | 'failed'
/** The record one part leaves for the part that follows it. */
export interface SwitchSegment {
  readonly sessionId: string
  readonly endedAt?: number | undefined
  readonly tokens?: number | undefined
  readonly note?: string | undefined
  readonly noteFrom?: number | undefined
  readonly fallback?: SwitchFallback | undefined
}
export interface SwitchPart extends SwitchSegment {
  readonly number: number
  readonly startedAt: number
}
/** A Bot as the switch changes it: its parts gain a segment, its chat a new Session. */
export interface SwitchBot {
  readonly id: string
  name: string
  sessionId?: string | undefined
  segments?: SwitchSegment[] | undefined
}
/** A group as the switch changes it. */
export interface SwitchRoom {
  readonly id: string
  name: string
  members: string[]
  sessions: Record<string, string>
  segments?: Record<string, SwitchSegment[]> | undefined
}
/** A job in a Bot's move to a fresh part. */
export interface SwitchJob extends SwitchOwner {
  readonly carry: SwitchMessage[]
  readonly info?: TurnInfo | undefined
  readonly joined?: readonly unknown[] | undefined
  readonly resume: boolean
  readonly overflow: boolean
  readonly failed?: string | undefined
  readonly bare: boolean
  readonly folder: boolean
  readonly hard: boolean
  readonly since: number
  started?: boolean
  moved?: boolean
  kept?: boolean
  noteFailed?: boolean
}
/** The tables the switch lifecycle keeps; the move reads and writes the ones it needs. */
export interface SwitchTables {
  readonly switches: Map<string, SwitchJob>
  readonly folderRetry: Map<string, number>
  readonly rescued: Map<string, 'carried' | 'bare'>
  readonly freshParts: Map<string, number>
  readonly partBase: Map<string, number | undefined>
  readonly noteFailures: Map<string, { readonly count: number; readonly until: number }>
  readonly checking: Set<string>
}
export interface SwitchState {
  switching: Record<string, SwitchOwner>
  questions: Record<string, unknown>
  views?: Record<string, unknown> | undefined
}
export interface Lines {
  readonly window: number
  readonly usable: number
  readonly hard: number
  readonly check: number
}
/** What a fresh part carries of the part that ends. */
export interface HandoffLines {
  readonly recent: string[]
  readonly earlier: string[]
  readonly unlisted: number
  readonly complete: boolean
  readonly whole?: boolean | undefined
}
export interface WrittenNote {
  readonly note: string
  readonly attempts: number
}
export interface HandoffPackageOptions {
  readonly room: SwitchRoom | undefined
  readonly segment: SwitchSegment
  readonly lines: HandoffLines
  readonly number: number
  readonly resume: boolean
  readonly overflow: boolean | undefined
  readonly failed: string | undefined
  readonly bare: boolean | undefined
  readonly folder: string | undefined
}
export interface SwitchLiveEntry {
  info?: TurnInfo | undefined
  joined?: readonly { readonly info: TurnInfo }[] | undefined
  switched?: boolean
}
export interface FreshRoute {
  readonly ref: string
  readonly effort: string | undefined
}

/** The runtime surface this module calls: routing, folders, and Session creation. */
export interface PartMoveRuntime {
  botOf(botId: string | undefined): SwitchBot | undefined
  roomOf(roomId: string | undefined): SwitchRoom | undefined
  chatOf(botId: string): string
  resolveAgent(sessionId: string): Promise<SwitchAgent>
  ensureCapabilities(sessionId: string): Promise<unknown>
  isFolder(path: string): Promise<boolean>
  teamFolder(): string | undefined
  ensureWorkspace(): Promise<string>
  workDirOf(owner: SwitchOwner | undefined): string | undefined
  createSession(title: string, options?: { readonly dir?: string | undefined }): Promise<string>
  desiredModel(bot: SwitchBot): Promise<string | undefined>
  desiredEffort(bot: SwitchBot, ref: string | undefined): Promise<string | undefined>
  selectSessionModel(
    sessionId: string,
    selection: {
      readonly provider?: string | undefined
      readonly model?: string | undefined
      readonly reasoningEffort?: string | undefined
    },
  ): Promise<unknown>
  applyPermission(bot: SwitchBot, sessionId: string, room: SwitchRoom | undefined): Promise<void>
  moveSchedules(from: string, to: string): unknown
  load(): Promise<unknown>
  save(): Promise<unknown>
  readOnly(): string | undefined
  isBotSession(sessionId: string): boolean
  warn(template: string, ...args: readonly unknown[]): void
}
export interface PartMoveOptions {
  readonly ctx: HostContext
  readonly rt: PartMoveRuntime
  readonly state: SwitchState
  readonly tables: SwitchTables
  placeOf(sessionId: string): SwitchOwner | undefined
  tokensOf(session: SwitchSession): number | undefined
  contextLines(session: SwitchSession): Promise<Lines | undefined>
  writeNote(
    agent: SwitchAgent,
    signal: AbortSignal,
    options?: { readonly folder?: boolean | undefined },
  ): Promise<WrittenNote>
  handoffLines(
    sessionId: string,
    options: { readonly budget: number; readonly group: boolean; readonly number: number },
  ): Promise<HandoffLines>
  handoffPackage(options: HandoffPackageOptions): string
  handoffSource(job: SwitchJob, resume: boolean): LlmMessageSource
  partsOf(botId: string, roomId?: string): readonly SwitchPart[]
  readonly recentTokens: number
  readonly noteTimeoutMs: number
  readonly noteCooldownMs: readonly number[]
}
export interface PartMove {
  forward(owner: SwitchOwner, messages: readonly SwitchMessage[]): Promise<void>
  restore(agent: SwitchAgent, messages: readonly SwitchMessage[]): void
  wake(agent: SwitchAgent): void
  heldBack(): Promise<void>
  folderMove(agent: SwitchAgent, options?: { readonly midTurn?: boolean | undefined }): Promise<string | undefined>
  moveOn(agent: SwitchAgent, job: SwitchJob, signal: AbortSignal): Promise<void>
}

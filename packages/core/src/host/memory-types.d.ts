// The shapes memory works with: the stored record format, the storage surface, the
// prompt and review inputs, and the runtime slice the memory modules install.
//
// Types only: nothing here runs. They sit beside memory.ts, as runtime.d.ts does for
// the host, so the five modules under memory/ stay logic files under the size gate.
import type { ToolRunContext } from './host-types.js'
import type { ToolContext } from '../engine/registry.ts'
import type { HostConfig, HostRuntime, StoredBot, StoredRoom } from './runtime.ts'
import type { MemoryActor, MemoryFile, MemoryScope, TaggedEntry } from './memory/records.ts'
import type { AskResult, Caller, MemoryView } from './memory/recall.ts'

// ---------------------------------------------------------------------------
// Records.

/** What a stored change did. */
export interface ChangeResult {
  readonly changed: boolean
  readonly file: MemoryFile
  readonly message: string
}

/** One change shown in a conversation header, keyed by Bot or group chat id. */
export interface MemoryNewsItem {
  readonly at: number
  readonly op: string
  readonly text: string
}

/** What a writer records in a conversation header. */
export type NoteNews = (scope: MemoryScope, actor: MemoryActor, op: string, line: unknown) => void

/** A model call the memory panel and the review share. */
export type BotShot = (bot: StoredBot, system: string, text: string, tag: UsageTag | undefined) => Promise<string>

/** What usage accounting files a memory model call under. */
export interface UsageTag {
  readonly sessionId: string
  readonly kind: string
}

/** One remembered line, as `parts.ts` reads it back for the review. */
export interface MemoryLine {
  readonly text: string
  readonly time?: number | undefined
  readonly seq: number
  readonly who?: string | undefined
}

/** A request body the memory endpoints read; ids arrive untyped. */
export type MemoryBody = Readonly<Record<string, unknown>>

/** One change the panel or the review model answered with; fields are checked where used. */
export type ModelChange = Readonly<Record<string, unknown>>

/** The memory settings the host config carries (the shared slice in runtime.ts is generic). */
export interface MemoryConfig extends HostConfig {
  readonly memory?: boolean
  readonly memoryReview?: boolean
  readonly memoryReviewDelayMs?: number
}

/**
 * `HostRuntime` plus the methods the memory modules install and the two calls they
 * need that the shared runtime slice does not declare yet.
 */
export interface MemoryRuntime extends Omit<HostRuntime, 'config' | 'partLines'> {
  readonly config: MemoryConfig
  desiredModel(bot: StoredBot): Promise<string | undefined>
  partLines(
    sessionId: string,
    signal: AbortSignal,
    options?: { readonly group?: boolean; readonly pages?: number },
  ): AsyncIterable<MemoryLine>
  memoryEnabled?: boolean
  renewMemory?(sessionId: string | undefined): void
  archiveBotMemory?(botId: string): Promise<unknown>
  archiveGroupMemory?(room: StoredRoom): Promise<unknown>
  memoryEndpoint?(endpoint: string, body: MemoryBody): Promise<unknown>
  memoryNews?(): Readonly<Record<string, MemoryNewsItem>>
  memoryReviews?(): number
}

export interface ScopeChoice {
  readonly scope?: MemoryScope | undefined
  readonly error?: string | undefined
}

export interface AddEntryInput {
  readonly scope: MemoryScope
  readonly topic?: string | undefined
  readonly text: string
  readonly meta: MemoryMetaInput
  readonly actor: MemoryActor
  readonly label: string
}

export interface ReplaceEntryInput {
  readonly scope: MemoryScope
  readonly topic?: string | undefined
  readonly match: unknown
  readonly text: string
  readonly meta: MemoryMetaInput
  readonly actor: MemoryActor
  readonly label: string
}

export interface RemoveEntryInput {
  readonly scope: MemoryScope
  readonly topic?: string | undefined
  readonly match: unknown
  readonly actor: MemoryActor
  readonly label: string
}

/** The storage surface the review, the panel and the tools share. */
export interface MemoryStorage {
  readonly root: string
  readonly TEAM: MemoryScope
  ownScope(botId: string): MemoryScope
  groupScope(roomId: string): MemoryScope
  dirOf(scope: MemoryScope): string
  scopeKey(scope: MemoryScope): string
  safeId(id: string): string
  roomIdOf(sessionId: string | undefined): string | undefined
  keeperOf(room: StoredRoom): StoredBot | undefined
  loadScope(scope: MemoryScope): MemoryFile[]
  allEntries(files: readonly MemoryFile[]): TaggedEntry[]
  limitOf(file: MemoryFile): number
  fileName(file: MemoryFile): string
  sizeNote(file: MemoryFile, size: number): string
  today(): string
  writeText(path: string, text: string): Promise<void>
  journal(record: Readonly<Record<string, unknown>>): Promise<void>
  enqueue<T>(job: () => Promise<T>): Promise<T>
  addEntry(input: AddEntryInput): Promise<ChangeResult>
  replaceEntry(input: ReplaceEntryInput): Promise<ChangeResult>
  removeEntry(input: RemoveEntryInput): Promise<ChangeResult>
  writesTeam(botId: string): boolean
  namedScope(raw: unknown, botId: string, roomId: string | undefined): ScopeChoice
  writeDenied(scope: MemoryScope, botId: string | undefined): string | undefined
  labelOf(scope: MemoryScope, botId: string): string
  secretEntry(text: string): boolean
  entryProblem(text: string): string | undefined
  sectionFor(sessionId: string | undefined): string
  renewMemory(sessionId: string | undefined): void
}

// ---------------------------------------------------------------------------
// Storage.

// ---------------------------------------------------------------------------
// Prompt.

export interface SummaryRequestInput {
  readonly name: string
  readonly own: readonly string[]
  readonly team: readonly string[]
  readonly language: string
}

export interface GroupSummaryRequestInput {
  readonly name: string
  readonly lines: readonly string[]
  readonly language: string
}

export interface ReviewSystemInput {
  readonly teamWrites?: boolean
  readonly group?: boolean
}

export interface ReviewRequestInput {
  readonly who: string
  readonly tag?: string
  readonly numbered: readonly ScopedEntry[]
  readonly left?: number
  readonly sizes?: { readonly home: number; readonly team: number } | undefined
  readonly where: string
  readonly earlier: readonly string[]
  readonly fresh: readonly string[]
  readonly more: boolean
  readonly language: string
}

export interface AskRequestInput {
  readonly name: string
  readonly group?: boolean
  readonly numbered: readonly ScopedEntry[]
  readonly language: string
  readonly text: string
}

// ---------------------------------------------------------------------------
// News and the review.

export interface RoomLine {
  readonly [key: string]: unknown
  readonly seq: number
  readonly text: string
  readonly who?: string | undefined
  readonly botId?: string | undefined
  readonly kind?: string | undefined
}

/** A group's log at one moment, kept while the review waits. */
export interface RoomCopy {
  readonly id: string
  readonly name: string
  readonly seq: number
  readonly log: readonly RoomLine[]
}

export interface Batch {
  readonly through: number | undefined
  readonly fresh: readonly MemoryLine[]
  readonly earlier: readonly MemoryLine[]
  readonly where: string
  readonly source: (lines: readonly MemoryLine[]) => string | undefined
}

/** A conversation waiting for its review, or being reviewed. */
export interface Seen {
  readonly key: string
  readonly sessionId?: string | undefined
  readonly botId?: string | undefined
  readonly roomId?: string | undefined
  readonly room?: RoomCopy | undefined
}

export interface BatchInput {
  readonly key: string
  readonly since: number | undefined
  readonly batch: Batch
  readonly keeper: StoredBot
  readonly name: string
  readonly home: MemoryScope
  readonly teamWrites: () => boolean
  readonly group?: boolean
  readonly who: string
  readonly tag: UsageTag
  readonly alive: () => boolean
  readonly next: () => void
}

export interface ApplyInput {
  readonly keeper: StoredBot
  readonly name: string
  readonly home: MemoryScope
  readonly numbered: readonly ScopedEntry[]
  readonly changes: readonly ModelChange[]
  readonly source: string | undefined
  readonly teamWrites: () => boolean
}

export interface ReviewStatus {
  readonly agent?: { readonly id?: string | undefined } | undefined
  readonly status?: string | undefined
}

export interface NewsDeps {
  readonly rt: MemoryRuntime
  readonly root: string
  readonly reviewOn: boolean
  readonly delay: number
  readonly botShot: BotShot
  readonly getStorage: () => MemoryStorage
}

export interface MemoryNewsService {
  readonly noteNews: NoteNews
  delete(id: string): void
  memoryNews(): Readonly<Record<string, MemoryNewsItem>>
  memoryReviews(): number
}

// ---------------------------------------------------------------------------
// Recall and the panel.

export type PanelScopes = Readonly<Record<string, MemoryScope>>

export interface PanelBase {
  readonly id: string
  readonly name: string
  readonly tag: UsageTag
  readonly scopes: PanelScopes
}

export interface BotPanel extends PanelBase {
  readonly group: false
  readonly keeper: StoredBot
}

export interface GroupPanel extends PanelBase {
  readonly group: true
  readonly keeper: StoredBot | undefined
}

export type Panel = BotPanel | GroupPanel

export interface ScopeList {
  readonly error: string
}

export interface Scopes {
  readonly scopes: MemoryScope[]
}

export interface RecallDeps {
  readonly rt: MemoryRuntime
  readonly storage: MemoryStorage
  readonly botShot: BotShot
}

export interface RecallService {
  callerOf(exec: ToolRunContext | ToolContext): Caller | undefined
  sourceOf(sessionId: string): Promise<string>
  metaFor(caller: Caller, scope: MemoryScope): Promise<Record<string, string>>
  installTools(): void
  memoryView(body: MemoryBody): MemoryView
  memoryAsk(body: MemoryBody): Promise<AskResult>
  memoryForget(body: MemoryBody): Promise<MemoryView>
  forgetSummary(id: string, clearFailure?: boolean): void
}

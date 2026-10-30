// The shapes the note, the checkpoint, and the steward call work with: the part reader,
// the Session surface they read, the engine they condense through, and the sizes and
// injections the factory takes.
//
// Types only: nothing here runs, so the four logic modules around it stay under the
// size gate and carry no declaration noise.
import type { HostContext } from './host-types.js'
import type {
  HandoffLines,
  Lines,
  SwitchAgent,
  SwitchOwner,
  SwitchPart,
  SwitchSession,
  WrittenNote,
} from './parts-switch-move.ts'

/** One message of a part, newest first, as the parts reader yields it. */
export interface PartLine {
  readonly text: string
  readonly time: number
  readonly seq: number
  readonly who: string
}

export interface PartLinesOptions {
  readonly group?: boolean | undefined
  readonly pages?: number | undefined
}

/** Reads one part's messages newest first. */
export type PartLinesReader = (
  sessionId: string,
  signal: AbortSignal,
  options?: PartLinesOptions,
) => AsyncGenerator<PartLine>

/** One route a Session last called; a note is written on the same one. */
// The route a Session last called, as the switch's Session declares it, plus the output
// budget the note and the checkpoint ask for.
interface NoteRoute {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string | undefined
}

interface NoteHeader {
  readonly tools?: readonly unknown[] | undefined
  readonly config?: NoteRoute | undefined
}

/** The Session surface a note, a checkpoint, or a steward call reads. */
export interface NoteSession extends SwitchSession {
  requestHeader(): NoteHeader | undefined
  deriveMessages(): readonly { readonly role?: unknown }[]
  toolHistory(): readonly unknown[]
}

/** The agent surface the same calls read: its Session. */
export type NoteAgent = Omit<SwitchAgent, 'session'> & { readonly session: NoteSession }

/** A compaction engine DS Bot can condense through. */
export interface PartEngine {
  compactIfNeeded(agent: SwitchAgent, trigger: string, signal: AbortSignal): Promise<unknown>
  compactNow(agent: SwitchAgent, signal: AbortSignal): Promise<unknown>
}

/** The runtime surface this module calls. */
export interface PartNoteRuntime {
  warn(template: string, ...args: readonly unknown[]): void
  tagUsage(messages: readonly unknown[], tag: { readonly sessionId: string; readonly kind: string }): void
  renewMemory(sessionId: string): void
}

/** The sizes this module works to, taken from the host's config. */
export interface NoteLimits {
  readonly recentTokens: number
  readonly recentLineMax: number
  readonly listTokens: number
  readonly listLineMax: number
  readonly handoffReadMs: number
  readonly noteMaxTokens: number
  readonly noteTimeoutMs: number
  readonly noteAttempts: number
  readonly stewardMaxTokens: number
  readonly stewardTimeoutMs: number
  readonly stewardLines: number
}

/** A checkpoint request, as the compaction engine makes it. */
export interface CheckpointInput {
  readonly messages: readonly unknown[]
  readonly tools?: readonly unknown[] | undefined
}

/** What a checkpoint replaces the region with, as the engine takes it. */
export interface CheckpointResult {
  readonly summary: readonly { readonly type: string; readonly text: string }[]
  readonly rawOutput: readonly { readonly type: string; readonly text?: string | undefined }[]
  readonly llmStreamCall: true
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number | undefined
  readonly usage?: unknown
}

export interface PartNoteOptions {
  readonly ctx: HostContext
  readonly rt: PartNoteRuntime
  readonly clock: (time: number) => string
  readonly limits: NoteLimits
  /** Sessions DS Bot itself is condensing right now. */
  readonly condensing: Set<string>
  engineOf(agent: SwitchAgent): PartEngine | undefined
  placeOf(sessionId: string): SwitchOwner | undefined
  partsOf(botId: string, roomId?: string): readonly SwitchPart[]
  partLines: PartLinesReader
  tokensOf(session: SwitchSession): number | undefined
  contextLines(session: SwitchSession): Promise<Lines | undefined>
  setPartBase(sessionId: string, tokens: number | undefined): void
}

/** One part, as the reader and the writer name it. */
export interface PartSpan {
  readonly budget: number
  readonly group: boolean
  readonly number: number
}

/** What the part reading needs, injected so it never touches the Session record. */
export interface PartReadDeps {
  readonly clock: (time: number) => string
  readonly partLines: PartLinesReader
  readonly warn: (template: string, ...args: readonly unknown[]) => void
  readonly limits: NoteLimits
}

export interface PartNote {
  handoffLines(sessionId: string, options: PartSpan): Promise<HandoffLines>
  writeNote(
    agent: SwitchAgent,
    signal: AbortSignal,
    options?: { readonly folder?: boolean | undefined },
  ): Promise<WrittenNote>
  keptMessages(sessionId: string, options: PartSpan): Promise<{ readonly kept: string[]; readonly more: boolean }>
  writeCheckpoint(input: CheckpointInput, agent: SwitchAgent, signal: AbortSignal): Promise<CheckpointResult>
  askSteward(agent: SwitchAgent, options: { readonly midTurn: boolean }): Promise<'switch' | 'compact' | undefined>
  decide(agent: SwitchAgent, options: { readonly midTurn: boolean }): Promise<'compact' | 'switch'>
  condense(
    agent: SwitchAgent,
    lines: Lines,
    options: { readonly inTurn: boolean; readonly signal?: AbortSignal | undefined },
  ): Promise<boolean | undefined>
}

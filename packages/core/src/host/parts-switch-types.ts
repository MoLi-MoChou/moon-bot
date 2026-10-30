/** Types extracted. */
import type {
  Lines,
  PartMoveOptions,
  PartMoveRuntime,
  SwitchAgent,
  SwitchJob,
  SwitchLiveEntry,
  SwitchMessage,
  SwitchOwner,
  SwitchSession,
  SwitchState,
} from './parts-switch-move.ts'
import type { TurnInfo } from './runtime.js'

/** The runtime surface the switch lifecycle calls. */
export interface PartSwitchRuntime extends PartMoveRuntime {
  readonly pastOwners: Map<string, SwitchOwner>
  liveOf(sessionId: string): SwitchLiveEntry
  renewMemory(sessionId: string): void
  keepTeamFolder(): Promise<string | undefined>
}

export interface WorkingDirectoryService {
  get(session: SwitchSession): string | undefined
  set(agent: SwitchAgent, target: string, signal?: AbortSignal): Promise<void>
}

export interface PreStepPayload {
  readonly agent: SwitchAgent
  readonly step: number
  readonly messages: readonly SwitchMessage[]
  readonly signal?: AbortSignal | undefined
}

export interface RequestErrorPayload {
  readonly agent: SwitchAgent
  readonly failure?: { readonly code?: string | undefined } | undefined
  readonly signal?: AbortSignal | undefined
}

export interface AssembleContext {
  readonly agent?: SwitchAgent | undefined
  readonly signal?: AbortSignal | undefined
}

export type Next = () => unknown

export interface StartSwitchOptions {
  readonly resume?: boolean
  readonly carry?: readonly SwitchMessage[]
  readonly info?: TurnInfo | undefined
  readonly joined?: readonly unknown[] | undefined
  readonly overflow?: boolean
  readonly failed?: string | undefined
  readonly bare?: boolean
  readonly folder?: boolean
  readonly hard?: boolean
}

export interface PartSwitchOptions extends Omit<PartMoveOptions, 'rt' | 'tables'> {
  readonly rt: PartSwitchRuntime
  readonly state: SwitchState
  readOnly(): boolean
  condense(
    agent: SwitchAgent,
    lines: Lines,
    options: { readonly inTurn: boolean; readonly signal?: AbortSignal | undefined },
  ): Promise<boolean | undefined>
  decide(agent: SwitchAgent, options: { readonly midTurn: boolean }): Promise<'compact' | 'switch'>
  adoptCompaction(agent: SwitchAgent): void
}

export interface PartSwitch {
  heldBack(): Promise<void>
  followFolder(botId: string): Promise<void>
  switchJobs(): Iterable<SwitchJob>
  switching(sessionId: string): boolean
  setPartBase(sessionId: string, tokens: number | undefined): void
}

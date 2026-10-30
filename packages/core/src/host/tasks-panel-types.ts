/** Types extracted from tasks-panel.ts. */
import type { TaskHold } from 'moon-bot-contracts'
import type { HostRuntime } from './runtime.js'
export interface PanelRuntime extends HostRuntime {
  closeWork?(id: string | undefined, name: string, text: string): string | undefined
  workView?(): Readonly<
    Record<
      string,
      {
        readonly since?: number
        readonly tool?: string
        readonly target?: string
        readonly said?: string
        readonly switching?: boolean
        readonly roomId?: string
      }
    >
  >
  workOf?(info: unknown): string | undefined
  workAsker?(workId: string): { readonly senderSessionId?: string } | undefined
  waitingView?(): Readonly<
    Record<
      string,
      { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }
    >
  >
  approvalsView?(): readonly {
    readonly botId: string
    readonly sessionId: string
    readonly tool?: string
    readonly at: number
  }[]
  parkedTurns?(): readonly { readonly sessionId: string; readonly botId: string; readonly roomId?: string }[]
}
export interface PanelLive {
  readonly turn?: unknown
  readonly sentAt?: number
}
export interface QueueMessage {
  readonly id?: string
  readonly content?: unknown
  readonly source?: {
    readonly kind?: string
    readonly role?: string
    readonly audience?: string
    readonly exchangeId?: string
    readonly senderSessionId?: string
    readonly senderRoomId?: string
  }
}
export interface PanelAgent {
  pendingTurns?(): number
  readonly inbox?:
    | {
        readonly nextTurn: readonly unknown[]
        remove?(id: string): boolean
      }
    | undefined
  /** A runner's explicit state; only `running` is enough to report engine-busy. */
  readonly status?: 'running' | 'idle' | string
  cancel?(cause: { readonly kind: string }): void
}
export interface TaskRunningView {
  readonly sessionId: string
  readonly botId: string
  readonly botName: string
  readonly since: number
  readonly roomId?: string
  readonly roomName?: string
  readonly tool?: string
  readonly target?: string
  readonly said?: string
  readonly switching?: boolean
  readonly fromName?: string
  /** Messages waiting behind the running turn (the engine's queue); absent when none. */
  readonly queued?: number
  /** The same messages, in queue order. Absent when the host cannot name them. */
  readonly queue?: readonly { readonly id: string; readonly preview: string }[]
  /** A reason is included only when the host has a matching live fact. */
  readonly hold?: TaskHold
}
export interface TaskDoneView {
  readonly sessionId: string
  readonly botId: string
  readonly botName: string
  readonly startedAt: number
  readonly endedAt: number
  readonly reason: string
  readonly roomId?: string
  readonly roomName?: string
  readonly fromName?: string
}
export interface TaskWaitingView {
  readonly botId: string
  readonly botName: string
  readonly for: readonly string[]
  /** Set for a turn parked by a restart, so Continue knows which session. */
  readonly sessionId?: string
  /** A reason is included only when the host has a matching live fact. */
  readonly hold?: TaskHold
}
export interface TasksView {
  readonly running: readonly TaskRunningView[]
  readonly completed: readonly TaskDoneView[]
  readonly waiting: readonly TaskWaitingView[]
}

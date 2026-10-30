/** Types extracted from delivery.ts. */
import type { AgentSession, AttachmentRef } from '../host-types.js'
import type { HostRuntime, TurnInfo } from '../runtime.ts'
import type { FailureDetail, GroupRound, RoomPost, RoomWaiter } from '../groups/types.ts'
import type { TurnFailure } from './failure.ts'
export interface JoinedInfo {
  readonly info: SourceInfo
  readonly text: string
}
export interface SourceInfo extends TurnInfo {
  readonly replyTo?: string | undefined
  readonly retried?: boolean | undefined
  readonly handoff?: boolean | undefined
  readonly resume?: boolean | undefined
  readonly joined?: readonly JoinedInfo[] | undefined
  readonly senderName?: string | undefined
  readonly reportBack?: boolean | undefined
  readonly member?: boolean | undefined
  readonly sub?: string | undefined
  readonly late?: boolean | undefined
  readonly progress?: boolean | undefined
  readonly quiet?: boolean | undefined
  readonly failed?: FailureDetail | undefined
  readonly again?: boolean | undefined
  readonly stopped?: boolean | undefined
  readonly done?: boolean | undefined
  readonly logged?: number | undefined
  readonly references?: readonly { readonly label?: unknown }[] | undefined
}
export interface TurnEntry {
  turn?: number | undefined
  since?: number | undefined
  /** When this Session's message was accepted, before its turn starts (the optimistic state). */
  sentAt?: number | undefined
  texts: string[]
  shown: number
  info?: SourceInfo | undefined
  pending?: SourceInfo | undefined
  joined?: JoinedInfo[] | undefined
  later?: { info: SourceInfo; text: string }[] | undefined
  calls?: Map<string, { readonly name: string; readonly args: string }> | undefined
  switched?: boolean | undefined
  opened?: boolean | undefined
  answers?: boolean | undefined
  tool?: string | undefined
  step?: string | undefined
  lastText?: string | undefined
  lastCalled?: boolean | undefined
}
export interface LongText {
  readonly text: string
  readonly files: readonly AttachmentRef[]
  readonly length?: number | undefined
}
export interface SwitchJob {
  readonly botId: string
  readonly roomId?: string
  readonly since: number
}
export interface TurnsRuntime extends HostRuntime {
  noteFailure(entry: {
    readonly source: string
    readonly text: string
    readonly code?: string | undefined
    readonly status?: number | undefined
    readonly requestId?: string | undefined
    readonly bot?: string | undefined
    readonly where?: string | undefined
    readonly sessionId?: string | undefined
  }): void
  dropKickoff(botId: string | undefined): void
  attachLong(text: string, name: string): Promise<LongText | undefined>
  closeWork?(id: string | undefined, name: string, text: string): string | undefined
  forgetBotWork?(botId: string): readonly (SourceInfo | undefined)[]
  roomStepText?(sessionId: string, info: TurnInfo | undefined, raw: string, first: boolean): Promise<void>
  takeRoomSteps?(sessionId: string): string
  withRoomSteps?(lines: string, reply: string): string
  lateRoomReply?(
    sessionId: string,
    info: TurnInfo,
    reply: string,
    options?: { readonly shown?: boolean | undefined },
  ): Promise<void>
  lateRoomFailure?(sessionId: string, info: TurnInfo, failure: FailureDetail): Promise<void>
  failRoomTurn?(sessionId: string, failure: FailureDetail): boolean
  touchRoomTurn?(sessionId: string): void
  workRoomTurn?(sessionId: string, tool: string): void
  takenWork?(workId: string, id: string): void
  workOf?(info: TurnInfo | undefined): string | undefined
  ownsWork?(botId: string | undefined, workId: string | undefined): boolean
  waitsWork?(workId: string): boolean
  holdWork?(workId: string, text: string): void
  workAsker?(workId: string): TurnInfo | undefined
  answerText?(workId: string, reply: string, botName: string): string
  switchJobs?(): Iterable<SwitchJob>
  sessionFolder?(session: AgentSession | undefined): string | undefined
  waitingView?(): Readonly<
    Record<
      string,
      { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }
    >
  >
}
export interface TurnsCore {
  readonly live: Map<string, TurnEntry>
  readonly roomWaiters: Map<string | undefined, RoomWaiter>
  readonly roomProgress: Map<string | undefined, GroupRound>
  readonly roomInbox: Map<string, RoomPost[]>
  readonly stoppedRoomTurns: Set<string | undefined>
  liveOf(id: string): TurnEntry
  queueRoomMessage(roomId: string, item: RoomPost): void
  setActivity(id: string, value: string | undefined): void
  startCall(id: string, entry: TurnEntry, callId: unknown, name: string, args: string): void
  endCall(id: string, entry: TurnEntry, callId: unknown): void
  claimTrigger(sessionId: string, entry: TurnEntry, info: SourceInfo): void
  showSteps(id: string, entry: TurnEntry, upTo: number): void
  markExchangeTurn(sessionId: string, turn: number | undefined): void
  unmarkExchangeTurn(sessionId: string, turn: number | undefined): void
  tellSender(id: string, source: TurnInfo, text: string, long?: LongText): void
  speaksInGroup(id: string, info: TurnInfo | undefined): boolean
  noteTurnFailure(id: string, failure: TurnFailure): void
  activityNow(): Record<string, string>
}

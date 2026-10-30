// The shapes a group chat works with: the stored room plus its log state, a round and
// its replies, a running member turn, and the runtime slice the group modules install.
//
// Types only: nothing here runs. Keeping them out of the modules that use them lets the
// log, the round runner, and the tool surface share one definition without importing
// each other's runtime.
import type { AttachmentRef } from '../host-types.js'
import type { HostRuntime, StoredBot, StoredRoom, TurnInfo } from '../runtime.ts'

/** Why a member's model call failed, as a group shows it. */
export interface FailureDetail {
  readonly code: string
  readonly status?: number | string | undefined
  readonly message: string
}

/** A failure as `failureLine`/`failureSay` read it; the fields are best-effort. */
export interface FailureText {
  readonly code?: string | undefined
  readonly status?: number | string | undefined
  readonly message?: string | undefined
}

/** One line of a group's log, as `state.json` and the lost-line files keep it. */
export interface RoomLine {
  readonly [key: string]: unknown
  seq: number
  who?: string | undefined
  botId?: string | undefined
  text: string
  kind?: string | undefined
  /** Set when only the start is in `state.json`; the whole line is in its file. */
  length?: number | undefined
  files?: readonly AttachmentRef[] | undefined
}

/** A conversation the user referenced in this round. */
export interface RoomReference {
  readonly labels: readonly string[]
  readonly text: string
}

/** A group as the host works on it: stored fields plus the room's live log state. */
export interface GroupRoom extends StoredRoom {
  members: string[]
  log?: RoomLine[]
  /** The sequence number of `log`'s last line; absent in logs written before rooms were versioned. */
  seq?: number
  /** Per member, the last sequence that member has seen. */
  seen?: Record<string, number>
  /** Late rounds answered since the user last spoke. */
  lateRounds?: number
}

/** A room whose log state `ensureRoomLog` has repaired. */
export interface ReadyRoom extends GroupRoom {
  log: RoomLine[]
  seq: number
  seen: Record<string, number>
}

export type SlotStatus =
  | 'waiting'
  | 'speaking'
  | 'posted'
  | 'passed'
  | 'missed'
  | 'working'
  | 'waiting-approval'
  | 'failed'
  | 'left'

/** One member's place in a round. */
export interface GroupSlot {
  readonly id: string
  readonly name: string
  status: SlotStatus
  note?: string | undefined
  by?: string | undefined
}

/** One entry of `round.replies`: a member's message, or an event of the round. */
export interface GroupReply {
  readonly kind?: string | undefined
  readonly botId?: string | undefined
  readonly name?: string | undefined
  readonly color?: string | undefined
  readonly text?: string | undefined
  readonly code?: string | undefined
  readonly status?: number | string | undefined
  readonly duration?: number | undefined
  readonly time: number
}

/** A message a group post put in a room's inbox for its next relay. */
export interface RoomPost {
  text: string
  botId?: string | undefined
  name?: string | undefined
  kickoff?: boolean | undefined
  quiet?: boolean | undefined
  done?: boolean | undefined
  stopped?: boolean | undefined
  resumed?: boolean | undefined
  again?: boolean | undefined
  failed?: FailureDetail | undefined
  askedBy?: string | undefined
  member?: boolean | undefined
  progress?: boolean | undefined
  late?: boolean | undefined
  references?: readonly RoomReference[] | undefined
  logged?: number | undefined
  images?: readonly AttachmentRef[] | undefined
  files?: readonly AttachmentRef[] | undefined
  reportBack?: boolean | undefined
  sub?: string | undefined
  length?: number | undefined
}

/** What `postToRoom` adds to a post besides its text and files. */
export interface RoomPostOptions {
  readonly late?: boolean | undefined
  readonly quiet?: boolean | undefined
  readonly progress?: boolean | undefined
  readonly stopped?: boolean | undefined
  readonly done?: boolean | undefined
  readonly resumed?: boolean | undefined
  readonly again?: boolean | undefined
  readonly failed?: FailureDetail | undefined
  readonly askedBy?: string | undefined
  readonly member?: boolean | undefined
  readonly reportBack?: boolean | undefined
  readonly sub?: string | undefined
  readonly length?: number | undefined
}

/** What a member turn in a group resolves to. */
export type RoomTurnResult =
  | string
  | null
  | { readonly failure: FailureDetail }
  | { readonly missed: true }
  | { readonly working: true }
  | { readonly approval: true }

/** One running member turn, keyed by exchange id. */
export interface RoomWaiter {
  readonly sessionId: string
  readonly botId: string
  readonly roomId: string
  resolve(value: RoomTurnResult): void
  fail(failure: FailureDetail): void
  touch(): void
  work(): void
  say(text: string): void
  approval(): void
}

/** A member turn of a round that is still running, which a stopped round cancels. */
export interface StartedTurn {
  readonly botId: string
  readonly sessionId: string
  readonly exchangeId: string
}

/** The hidden group Session a member speaks from. */
export interface MemberSession {
  readonly id: string
  readonly brief: string | undefined
}

/** A round being run in a group. */
export interface GroupRound {
  readonly roomId: string
  readonly members: readonly string[]
  readonly startSeq: number
  readonly kickoff?: boolean | undefined
  readonly references?: readonly RoomReference[] | undefined
  readonly shown?: string[]
  slots: GroupSlot[]
  speaking: string | null
  turns: number
  replies: GroupReply[]
  passed: string[]
  failed: string[]
  started: StartedTurn[]
}

interface AroundOwnChatError {
  readonly error: string
}

interface AroundOwnChatFound {
  readonly lines: readonly string[]
  readonly exact: boolean
}

type ChatPart = ReturnType<HostRuntime['partsOf']>[number]

/**
 * `HostRuntime` plus the group-chat methods the host modules install for the tools and
 * the channel. `runtime.ts` keeps the shared slice; this is the group module's slice of
 * the plugin, as `ChannelRuntime` does for the channel.
 */
export interface GroupRuntime extends Omit<HostRuntime, 'own' | 'postToRoom'> {
  /** `own` accepts a missing table: a group that has no Sessions yet has none. */
  own<T>(record: Readonly<Record<string, T>> | null | undefined, id: string): T | undefined
  roomOf(roomId: string | undefined): GroupRoom | undefined
  postToRoom(
    room: GroupRoom,
    sender: StoredBot,
    text: string,
    options?: RoomPostOptions,
    files?: readonly AttachmentRef[],
  ): Promise<void>
  roomWaiters: Map<string | undefined, RoomWaiter>
  roomProgress: Map<string | undefined, GroupRound>
  roomInbox: Map<string, RoomPost[]>

  uiLanguage?: () => string | undefined
  waitsForApproval?: (sessionId: string) => boolean
  stopRoomTurn?: (sessionId: string, exchangeId: string) => Promise<void>
  touchRoomTurn?: (sessionId: string) => void
  failRoomTurn?: (sessionId: string, failure: FailureDetail) => boolean
  yieldRoomTurn?: (sessionId: string) => void
  workRoomTurn?: (sessionId: string, tool: string) => void

  roomStepText?: (sessionId: string, info: TurnInfo | undefined, raw: string, first: boolean) => Promise<void>
  takeRoomSteps?: (sessionId: string) => string
  withRoomSteps?: (lines: string, reply: string) => string
  lateRoomReply: (
    sessionId: string,
    info: TurnInfo,
    reply: string,
    options?: { readonly shown?: boolean },
  ) => Promise<void>
  lateRoomFailure: (sessionId: string, info: TurnInfo, failure: FailureDetail) => Promise<void>
  dropGroupLines: (roomId: string) => void
  greetRoom: (roomId: string) => Promise<void>
  stopMemberWork: (roomId: string, botId: string) => Promise<boolean>

  retireGroupSession: (room: StoredRoom, botId: string) => void
  createSession(title: string, options?: { readonly dir?: string | undefined }): Promise<string>
  workDirOf(place: { readonly botId?: string | undefined; readonly roomId?: string | undefined }): string | undefined
  desiredModel(bot: StoredBot): Promise<string | undefined>
  selectSessionModel(
    sessionId: string,
    route:
      | { readonly provider: string; readonly model: string; readonly reasoningEffort?: string | undefined }
      | undefined,
  ): Promise<unknown>
  applyPermission(bot: StoredBot, sessionId: string, room?: StoredRoom): Promise<void>
  ownChatBrief(member: { readonly id: string; readonly name: string }): Promise<string>
  noteText(part: ChatPart): string | undefined
  partIndex(parts: readonly ChatPart[]): string
  aroundOwnChat(botId: string, anchor: string): Promise<AroundOwnChatError | AroundOwnChatFound>
  latestOwnChat(
    botId: string,
    options?: { readonly askingId?: string | undefined; readonly limit?: number },
  ): Promise<readonly string[]>
  searchOwnChat(
    botId: string,
    query: string,
    options?: { readonly askingId?: string | undefined; readonly limit?: number },
  ): Promise<{ readonly lines: readonly string[]; readonly every: boolean }>

  imagesForGroup(attachments: readonly AttachmentRef[], sessionId: string): Promise<readonly string[]>
  closeWork?: (id: string, name: string, text: string) => string | undefined
  pickRoom(ref: unknown, self: string | undefined): { readonly room: GroupRoom } | { readonly error: string }
}

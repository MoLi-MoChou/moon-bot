/** Types extracted. */
import type { AttachmentRef } from '../host-types.js'
import type { StoredBot, TurnInfo } from '../runtime.ts'
import type { GroupRoom, GroupRound, MemberSession, ReadyRoom, RoomLine, RoomPostOptions } from './types.ts'

/** A line about to be appended; `seq` and the kept length are the log's to set. */
export interface RoomLineInput {
  readonly who?: string | undefined
  readonly botId?: string | undefined
  readonly text?: string | undefined
  readonly kind?: string | undefined
  readonly files?: readonly AttachmentRef[] | undefined
}

/** The room-log helpers other group modules call. */
export interface RoomLogApi {
  readonly appendRoom: (room: ReadyRoom, line: RoomLineInput) => void
  readonly dropGroupLines: (roomId: string) => void
  readonly groupSessionFor: (room: ReadyRoom, member: StoredBot) => Promise<MemberSession | undefined>
  readonly loadGroupLines: (room: ReadyRoom) => Promise<unknown>
  readonly memberText: (room: GroupRoom) => (line: RoomLine) => string
  readonly postInRound: (room: ReadyRoom, round: GroupRound, member: StoredBot, text: string, duration?: number) => void
  readonly postToRoom: (
    room: GroupRoom,
    sender: StoredBot,
    text: string,
    options?: RoomPostOptions,
    files?: readonly AttachmentRef[],
  ) => Promise<void>
  readonly roomPrompt: (
    room: ReadyRoom,
    member: StoredBot,
    round: GroupRound,
  ) => { readonly text: string; readonly files: AttachmentRef[] }
  readonly unseenLines: (room: ReadyRoom, memberId: string) => RoomLine[]
}

export interface HeldLines {
  last: number
  lines: string[]
  timer?: ReturnType<typeof setTimeout> | undefined
  info?: TurnInfo | undefined
}

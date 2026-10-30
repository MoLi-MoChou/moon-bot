import type { CSSProperties, ReactNode } from 'react'
import type { FoldLimit, WholeText } from './fold.tsx'
import type { QuestionActions } from './questions.tsx'
import type { SecretActions, SecretBot, SecretRoster } from './secret-card.tsx'
import type { WidgetActions, WidgetCell } from './widget-cell.tsx'
import type { ChatItem } from './cells-chat.tsx'

export type StoreHook<T> = <R>(select: (state: T) => R) => R
/** A Bot as a cell draws it: the mark it shows, and the ids its actions take. */
export interface ChatBot extends SecretBot {
  color?: unknown
  avatar?: unknown
}
/** A group chat as a cell draws it. */
export interface ChatRoom {
  id?: string | undefined
  name?: string | undefined
  admin?: string | undefined
  members: readonly string[]
}
/** A pending card as the roster keeps it, by the call that asked. */
export interface ChatQuestion {
  id: string
  callId?: string | undefined
}
/** A part of a Bot's chat, and the turn the cells of that part belong to. */
export interface TurnInfo {
  turn: number
  status?: string | undefined
  start?:
    | {
        time?: number | undefined
      }
    | undefined
  end?:
    | {
        time?: number | undefined
      }
    | undefined
}
export interface NodeLocation {
  kind?: string | undefined
  turn?: TurnInfo | undefined
}
/** What a cell reads of the team roster. */
export interface ChatRoster extends SecretRoster {
  byId: Record<string, ChatBot | undefined>
  bots: readonly ChatBot[]
  rooms: readonly ChatRoom[]
  roomsById: Readonly<Record<string, ChatRoom | undefined>>
  exchangeTurns: Readonly<Record<string, readonly number[] | undefined>>
  questions?: Readonly<Record<string, ChatQuestion | undefined>> | undefined
  views?: Parameters<typeof WidgetCell>[0]['roster']['views']
}
/** One entry of the activity row's live table. */
export interface LiveNote {
  text?: true | undefined
  thinking?: true | undefined
  relay?: true | undefined
  label?: string | null | undefined
  state?: string | undefined
}
/** One reply in a group chat's round, as the host lists it. */
export interface GroupReply {
  kind?: string | undefined
  botId: string
  text: string
  name?: string | undefined
  color?: unknown
  code?: string | undefined
  status?: string | undefined
  time?: number | undefined
  duration?: number | undefined
}
/** A member's messages in a row, as one block under its name. */
export interface ReplyBlock {
  reply: GroupReply
  index: number
  texts: string[]
  time?: number | undefined
  duration?: number | undefined
}
/** A group's round as the progress poll lists it. */
export interface RoomProgress {
  callId?: string | undefined
  replies?: readonly GroupReply[] | undefined
  speaking?: string | null | undefined
}
/** A page of a chat's earlier entries, as the host lists them. */
export interface EarlierPage {
  readonly items: readonly ChatItem[]
  readonly cursor?: string | undefined
  readonly startedAt?: number | undefined
}
/** What a cell reads of the UI store: the reactions it shows and the visits it marks. */
export interface Visit {
  seen?: number | undefined
  entered: number
}
export interface CellsUiState {
  reactions?: Readonly<Record<string, readonly (readonly string[])[] | undefined>> | undefined
  visits?: Readonly<Record<string, Visit | undefined>> | undefined
}
/** The actions the transcript calls: navigation, requests, and the notes it keeps. */
export interface CellActions extends SecretActions, WidgetActions, QuestionActions {
  openSession(id: string | undefined): void
  openExchange(a: string | null | undefined, b: string | null | undefined): void
  openMemory(id: string): void
  toggleReaction(msgKey: string, index: number, emoji: string): void
  quote(sessionId: string, text: string): void
  earlier(sessionId: string, cursor?: string | undefined): Promise<EarlierPage>
  fileText(file: string | undefined): Promise<
    | {
        readonly text: string
        readonly whole: boolean
      }
    | undefined
    | null
  >
  noteTurnPeer(sessionId: string, turn: number | undefined, peer: string | undefined): void
  noteTurnTime(sessionId: string, turn: number | undefined, edge: 'first' | 'end', time: number | undefined): void
  noteLive(sessionId: string, id: string, entry: LiveNote | null): void
  noteCards?(sessionId: string, callIds: readonly string[], delta: number): void
  roomProgress(sessionId: string): Promise<readonly RoomProgress[] | null | undefined>
  showDetails(sessionId: string): void
}
export interface BubblesProps {
  texts: readonly string[]
  roster: ChatRoster
  selfId: string | undefined
  actions: CellActions
  streaming?: boolean | undefined
  sessionId?: string | undefined
  msgKey?: string | undefined
  useUi?: StoreHook<CellsUiState> | undefined
  lead?: ReactNode
  mentions?: unknown
  /** Mention candidates for a group; unlike the full roster this is room-scoped. */
  mentionBots?: readonly ChatBot[] | undefined
  everyoneBots?: readonly ChatBot[] | undefined
  fold?: FoldLimit | undefined
  whole?: WholeText | undefined
}
/** The message tools' popover: its styles carry a transform origin as a custom property. */
export interface PopoverPlace extends CSSProperties {
  '--bt-origin'?: string | undefined
}
export interface BubbleProps {
  text: string
  index: number
  roster: ChatRoster
  selfId: string | undefined
  actions: CellActions
  sessionId?: string | undefined
  msgKey?: string | undefined
  mentions?: unknown
  mentionBots?: readonly ChatBot[] | undefined
  everyoneBots?: readonly ChatBot[] | undefined
  fold: FoldLimit
  picked: readonly string[]
  live?: boolean | undefined
  lead?: ReactNode
  whole?: WholeText | undefined
}
export interface MessageToolsProps {
  text: string
  name: string
  sessionId?: string | undefined
  react?: ((emoji: string) => void) | undefined
  actions: CellActions
}
/** A Bot as an event line names it: the mark, its name, and the id its chat opens by. */
export interface GroupSender {
  id: string
  name?: string | undefined
  color?: unknown
  avatar?: unknown
}
export interface GroupMessageProps {
  bot: GroupSender
  text?: string | undefined
  texts?: readonly string[] | undefined
  room?: ChatRoom | undefined
  roster: ChatRoster
  actions: CellActions
  msgKey?: string | undefined
  useUi?: StoreHook<CellsUiState> | undefined
  whole?: WholeText | undefined
  time?: number | undefined
  duration?: number | undefined
  mentionBots?: readonly ChatBot[] | undefined
  everyoneBots?: readonly ChatBot[] | undefined
}
// -------------------------------------------------------------------------
// Chat cells

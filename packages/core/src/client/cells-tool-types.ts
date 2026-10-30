/** Shared types for tool cells. */
import type {
  CellActions,
  CellsUiState,
  ChatBot,
  ChatRoster,
  GroupReply,
  NodeLocation,
  StoreHook,
} from './cells-bubbles.tsx'
import { contentText } from './text.ts'
import type { ChatCall } from './cells-turns.tsx'

export interface WorkDoing {
  tool?: string | undefined
  said?: string | undefined
  note?: string | undefined
  target?: string | undefined
  switching?: boolean | undefined
}
export interface WorkState {
  bots?: Readonly<Record<string, WorkDoing | undefined>> | undefined
}
export type WorkHook = StoreHook<WorkState>
/** What a running tool says in the activity row. */
export interface ToolActivity {
  label?: string | null | undefined
  relay?: true | undefined
  state: string
}
/** One call of a turn's call tree: its name, arguments and result. */
export interface ToolNode {
  key?: string | number | undefined
  data: {
    root: ChatCall
  }
  location?: NodeLocation | undefined
}
export interface ToolCellProps {
  node: ToolNode
  sessionId: string
  useRoster: StoreHook<ChatRoster>
  useUi: StoreHook<CellsUiState>
  useWork?: WorkHook | undefined
  useHeldCards?: StoreHook<Record<string, Record<string, number> | undefined>> | undefined
  actions: CellActions
}
export interface GroupRepliesProps {
  sessionId: string
  callId?: string | undefined
  done: boolean
  content?: Parameters<typeof contentText>[0]
  roster: ChatRoster
  actions: CellActions
  useUi?: StoreHook<CellsUiState> | undefined
  useWork?: WorkHook | undefined
}
export interface LiveReplies {
  replies: readonly GroupReply[]
  speaking: string | null
}
export interface CallEnv {
  sessionId: string
  roster: ChatRoster
  actions: CellActions
  useUi?: StoreHook<CellsUiState> | undefined
  useWork?: WorkHook | undefined
  findBot: (nameOrId?: string | undefined) => ChatBot | undefined
  heldCards?: Record<string, number> | undefined
  turnKey?: string | undefined
}
export type ArgReader = (key: string) => string | undefined

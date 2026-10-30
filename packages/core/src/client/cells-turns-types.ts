import type { CellActions, CellsUiState, ChatRoster, NodeLocation, StoreHook } from './cells-bubbles.tsx'
import type { SessionsState } from './header-pills.tsx'

interface TriggerBlock {
  type?: string
  text?: string
  attachment?: string
}
/** The source a trigger node carries: which kind of run it opens, and from whom. */
export interface TriggerSource {
  kind?: string
  handoff?: boolean
  deferred?: boolean
  resumed?: boolean
  retried?: boolean
  stopped?: boolean
  done?: boolean
  logged?: unknown
  failed?: unknown
  role?: string
  length?: number
  roomId?: string
  senderSessionId?: string
  senderName?: string
}
export interface TriggerData {
  turn?: number
  time?: number
  seq?: number
  content?: readonly TriggerBlock[]
  source?: TriggerSource | null
}
export interface TriggerNode {
  key?: string | number | undefined
  data: TriggerData
  location?: NodeLocation | undefined
}
/** One turn in the clock's per-Session table. */
export interface TurnClockEntry {
  first?: number | undefined
  end?: number | undefined
  peer?: string | undefined
}
export type TurnTable = Readonly<Record<string, TurnClockEntry | undefined>>
export type TurnClockState = Readonly<Record<string, TurnTable | undefined>>
/** The fold state of a running turn's process, as the host keeps it. */
export interface TurnProcess {
  foldable?: boolean | undefined
  open?: boolean | undefined
  setOpen(open: boolean): void
}
export interface TriggerCellProps {
  node: TriggerNode
  sessionId: string
  useRoster: StoreHook<ChatRoster>
  useSessions: StoreHook<SessionsState>
  useTurnClock: StoreHook<TurnClockState>
  useUi: StoreHook<CellsUiState>
  actions: CellActions
}
export interface TurnProcessCellProps {
  node?:
    | {
        location?: NodeLocation | undefined
        data?:
          | {
              turn?: number | undefined
            }
          | undefined
      }
    | undefined
  sessionId: string
  turnProcess?: TurnProcess | undefined
  useRoster: StoreHook<ChatRoster>
  useUi: StoreHook<CellsUiState>
  useTurnClock: StoreHook<TurnClockState>
  actions: CellActions
}
export interface TurnTailCellProps {
  turn: {
    turn: number
    end: {
      time: number
    }
  }
  sessionId: string
  useTurnClock: StoreHook<TurnClockState>
  useUi: StoreHook<CellsUiState>
  actions: CellActions
}

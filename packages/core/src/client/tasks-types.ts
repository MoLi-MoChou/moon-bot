/** Types for tasks-page. */
import type { TaskHold } from 'moon-bot-contracts'
import type { TaskQueueItem } from './tasks-queue.tsx'

export interface TaskRunning {
  sessionId: string
  botId: string
  botName: string
  since: number
  roomId?: string
  roomName?: string
  tool?: string
  target?: string
  said?: string
  switching?: boolean
  fromName?: string
  /** Messages waiting behind the running turn; the host leaves the field out at zero. */
  queued?: number
  /** Those messages, in order. Absent when the host cannot name them. */
  queue?: readonly TaskQueueItem[]
  hold?: TaskHold
}
export interface TaskDone {
  sessionId: string
  botId: string
  botName: string
  startedAt: number
  endedAt: number
  reason: string
  roomId?: string
  roomName?: string
  fromName?: string
}
export interface TaskWaiting {
  botId: string
  botName: string
  for: readonly string[]
  /** Set when a restart parked this session and Continue can run it. */
  sessionId?: string
  hold?: TaskHold
}
export interface TasksAnswer {
  running: readonly TaskRunning[]
  completed: readonly TaskDone[]
  waiting: readonly TaskWaiting[]
}
export type TaskStateFilter = 'all' | 'running' | 'waiting' | 'completed'
export interface TaskFilters {
  readonly state: TaskStateFilter
  readonly botId: string
}
export interface TaskStopAnswer {
  readonly stopped?: boolean
}
export interface TaskQueueAnswer {
  readonly removed?: boolean
}
export interface TaskContinueAnswer {
  readonly continued?: boolean
}
export interface TaskActions {
  tasks: () => Promise<TasksAnswer>
  stopTask: (sessionId: string) => Promise<TaskStopAnswer | undefined>
  removeQueued: (sessionId: string, id: string) => Promise<TaskQueueAnswer | undefined>
  continueTurn?: ((sessionId: string) => Promise<TaskContinueAnswer | undefined>) | undefined
  openSession: (sessionId: string) => void
}
export interface TasksState {
  readonly answer: TasksAnswer | null
  readonly now: number
  readonly busy: string | null
  /** Turns the user just stopped, by Session and start time: they read stopped until gone. */
  readonly stopped: ReadonlySet<string>
  readonly notice: string | null
  readonly error: string | null
  readonly refresh: () => void
  readonly stop: (task: TaskRunning) => void
  readonly withdraw?: ((sessionId: string, id: string) => void) | undefined
  readonly continueTurn: (sessionId: string) => void
}
export interface TasksBoardProps {
  readonly state: TasksState
  readonly onOpen: (sessionId: string) => void
  /** Tests pass a starting filter; the live page and popover leave it unset. */
  readonly initialFilters?: TaskFilters
}

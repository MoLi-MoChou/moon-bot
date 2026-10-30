import type { MarkBot } from './mark.tsx'

export interface Task {
  readonly id: string
  readonly sessionId: string
  readonly botId?: string | undefined
  readonly roomId?: string | undefined
  readonly title: string
  readonly prompt?: string | undefined
  readonly kind?: string | undefined
  readonly status?: string | undefined
  readonly scheduledAt?: string | undefined
  readonly time?: string | undefined
  readonly everySeconds?: number | undefined
  readonly weekdays?: readonly number[] | undefined
  readonly expression?: string | undefined
  readonly timeZone?: string | undefined
}
/** What the tasks view says: whether the host runs them at all, and the tasks themselves. */
export interface ScheduleView {
  readonly available: boolean
  readonly tasks: readonly Task[]
}
export interface ScheduleRoom {
  readonly id: string
  readonly name: string
  readonly members: readonly string[]
}
export interface ScheduleRoster {
  readonly bots: readonly {
    readonly id: string
    readonly name: string
  }[]
  readonly rooms: readonly ScheduleRoom[]
  readonly byId: Record<string, MarkBot | undefined>
  readonly roomsById: Record<string, ScheduleRoom | undefined>
}
export interface ScheduleActions {
  schedules?: (() => Promise<ScheduleView>) | undefined
  scheduleDelete: (sessionId: string, id: string) => Promise<unknown>
  scheduleCreate: (input: {
    target: string
    title: string
    prompt: string
    when: Record<string, unknown>
  }) => Promise<unknown>
  openShellSettingsPanel?: (() => void) | undefined
  openSettings: (page: string, id?: string | null) => void
}
export type ScheduleListener = (view: ScheduleView) => void

// The standalone scheduler (plan §阶段 4): the five trigger kinds over the tasks
// table — next_run_at computed with croner, fired by a poll instead of a memory timer,
// so a restart picks up exactly where it left off. The ScheduleService face is the one
// the schedules module already speaks; firing delivers the task's prompt to its session
// with the schedule source the route knows.
import { Cron } from 'croner'
import type { Store } from '../store/db.ts'

/** One task's timing as the schedules module stores it. */
export interface ScheduleSpec {
  readonly at?: string | undefined
  readonly every_seconds?: number | undefined
  readonly daily?: { readonly time: string | undefined, readonly time_zone: string | undefined } | undefined
  readonly weekly?: { readonly time: string | undefined, readonly time_zone: string | undefined, readonly weekdays: readonly number[] | undefined } | undefined
  readonly cron?: { readonly expression: string | undefined, readonly time_zone: string | undefined } | undefined
}

export interface ScheduleTask {
  readonly title: string
  readonly prompt: string
}

export type FirePrompt = (sessionId: string, task: ScheduleTask) => void

const POLL_MS = 20_000
const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/
// croner's day-of-week: 0 Sunday … 6 Saturday; the wire's weekdays are 1 Monday … 7 Sunday.
const DOW = ['1', '2', '3', '4', '5', '6', '0']

/** The next time a spec fires at or after `from`, or undefined when it never does again. */
export function nextRunOf(spec: ScheduleSpec, from: number): number | undefined {
  if (spec.at !== undefined) {
    const at = Date.parse(spec.at)
    return Number.isFinite(at) ? at : undefined
  }
  if (spec.every_seconds !== undefined && spec.every_seconds > 0) return from + spec.every_seconds * 1000
  const zone = (tz: string | undefined): string | undefined => (typeof tz === 'string' && tz !== '' ? tz : undefined)
  if (spec.daily?.time !== undefined) {
    const time = TIME_OF_DAY.exec(spec.daily.time)
    if (time === null) return undefined
    return cronNext(`${time[2]} ${time[1]} * * *`, zone(spec.daily.time_zone), from)
  }
  if (spec.weekly?.time !== undefined) {
    const time = TIME_OF_DAY.exec(spec.weekly.time)
    const days = (spec.weekly.weekdays ?? []).map(day => DOW[day - 1]).filter(Boolean)
    if (time === null || days.length === 0) return undefined
    return cronNext(`${time[2]} ${time[1]} * * ${days.join(',')}`, zone(spec.weekly.time_zone), from)
  }
  if (spec.cron?.expression !== undefined) return cronNext(spec.cron.expression, zone(spec.cron.time_zone), from)
  return undefined
}

const cronNext = (expression: string, zone: string | undefined, from: number): number | undefined => {
  try {
    const job = new Cron(expression, { paused: true, ...(zone !== undefined ? { timezone: zone } : {}) })
    const next = job.nextRun(new Date(from))
    job.stop()
    return next?.getTime()
  } catch {
    return undefined
  }
}

const specOf = (payload: Readonly<Record<string, unknown>>): ScheduleSpec => ({
  ...(typeof payload.at === 'string' ? { at: payload.at } : {}),
  ...(typeof payload.every_seconds === 'number' ? { every_seconds: payload.every_seconds } : {}),
  ...(payload.daily !== null && typeof payload.daily === 'object' ? { daily: payload.daily as ScheduleSpec['daily'] } : {}),
  ...(payload.weekly !== null && typeof payload.weekly === 'object' ? { weekly: payload.weekly as ScheduleSpec['weekly'] } : {}),
  ...(payload.cron !== null && typeof payload.cron === 'object' ? { cron: payload.cron as ScheduleSpec['cron'] } : {}),
})

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | undefined

  private readonly store: Store
  private readonly fire: FirePrompt

  constructor(store: Store, fire: FirePrompt) {
    this.store = store
    this.fire = fire
  }

  /** Starts the poll; the disposer stops it. Due-but-unclaimed work from a restart is picked up by the first tick. */
  start(): () => void {
    this.timer = setInterval(() => { void this.tick().catch(() => {}) }, POLL_MS)
    this.timer.unref?.()
    void this.tick().catch(() => {})
    return () => { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined }
  }

  /** Fires everything due, once each. */
  async tick(): Promise<void> {
    for (const task of this.store.tasks.due(Date.now())) {
      if (this.store.tasks.markRunning(task.id) === undefined) continue
      const payload = task.payload as Readonly<Record<string, unknown>>
      try {
        if (task.ownerSession !== null) {
          this.fire(task.ownerSession, { title: String(payload.title ?? ''), prompt: String(payload.prompt ?? '') })
        }
      } finally {
        const spec = specOf(payload)
        const again = nextRunOf(spec, Date.now())
        if (again !== undefined && again > Date.now()) this.store.tasks.finish(task.id, { state: 'pending', nextRunAt: again })
        else this.store.tasks.finish(task.id, { state: 'done', result: { at: Date.now() } })
      }
    }
  }

  // The ScheduleService face ------------------------------------------------

  async catalog(): Promise<readonly Record<string, unknown>[]> {
    return this.store.tasks.list().filter(task => task.kind === 'schedule' && task.ownerSession !== null).map(task => ({
      id: task.id,
      sessionId: task.ownerSession,
      ...(task.state === 'paused' ? { paused: true } : {}),
      ...(task.lastResult !== null && task.state === 'done' ? { lastRun: task.lastResult } : {}),
      ...(task.payload as Readonly<Record<string, unknown>>),
    }))
  }

  async create(sessionId: string, request: ScheduleTask & ScheduleSpec): Promise<void> {
    const next = nextRunOf(request, Date.now())
    if (next === undefined) throw Object.assign(new Error('Pick when it runs'), { code: 'bot/invalid' })
    this.store.tasks.create({
      kind: 'schedule',
      ownerSession: sessionId,
      payload: { ...request, title: request.title, prompt: request.prompt },
      nextRunAt: next,
    })
  }

  async delete(query: { sessionId: string, id: string }): Promise<void> {
    const task = this.store.tasks.task(query.id)
    if (task === undefined || task.ownerSession !== query.sessionId) throw Object.assign(new Error('No such task'), { code: 'bot/not-found' })
    this.store.tasks.remove(query.id)
  }

  async list(query: { sessionId: string }): Promise<readonly Record<string, unknown>[]> {
    return this.store.tasks.list(query.sessionId).filter(task => task.kind === 'schedule')
  }

  /** The user's pause and resume, by task id. */
  pause(id: string, paused: boolean): void {
    this.store.tasks.setState(id, paused ? 'paused' : 'pending')
  }
}

import { installScheduleTools } from './schedules-tools.ts'
import type { Disposer } from './host-types.js'
import type { HostRuntime } from './runtime.js'

interface ScheduleEntry {
  readonly id: string
  readonly sessionId: string
  readonly title?: string
  readonly prompt?: string
  readonly [key: string]: unknown
}

interface ScheduleRecord {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly kind: string
  readonly scheduledAt?: string
  readonly everySeconds?: number
  readonly time?: string
  readonly timeZone?: string
  readonly weekdays?: readonly number[]
  readonly expression?: string
}

interface ScheduleSelector {
  readonly at?: string | undefined
  readonly every_seconds?: number | undefined
  readonly daily?: { readonly time: string | undefined; readonly time_zone: string | undefined } | undefined
  readonly weekly?: { readonly time: string | undefined; readonly time_zone: string | undefined; readonly weekdays: readonly number[] | undefined } | undefined
  readonly cron?: { readonly expression: string | undefined; readonly time_zone: string | undefined } | undefined
}

interface ScheduleRequest extends ScheduleSelector {
  readonly title: string
  readonly prompt: string
}

interface ScheduleService {
  catalog(): Promise<readonly ScheduleEntry[]>
  create(sessionId: string, request: ScheduleRequest | ScheduleSelector): Promise<unknown>
  delete(query: { readonly sessionId: string; readonly id: string }): Promise<unknown>
  list(query: { readonly sessionId: string }): Promise<readonly ScheduleRecord[]>
}

interface ScheduleHost {
  readonly schedule?: ScheduleService | undefined
  effect(execute: () => void | Disposer, label?: string): void
}

interface ScheduleOwner {
  readonly botId?: string
  readonly roomId?: string
}

type ScheduleBody = Readonly<Record<string, unknown>>

interface SelectorInput {
  readonly kind?: string
  readonly expression?: unknown
  readonly at?: unknown
  readonly time?: unknown
  readonly timeZone?: unknown
  readonly minutes?: unknown
  readonly weekdays?: unknown
}

const bodyText = (body: ScheduleBody, key: string): string | undefined => {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

// Scheduled tasks. the host's schedule service stores each task with the Session it belongs
// to and, when it is due, sends its prompt to that Session as a new message. This
// module lists the team's tasks for Settings, creates and removes them there, and moves
// a Bot's tasks along when its chat goes on in a fresh part, so the Bot keeps seeing
// them. A group chat's task lives on the group's own Session, so the reminder reaches
// the group like a message from the user (see reminderText). the host.0 mounts the service only with its Automation tasks bundle on, so
// the service is optional and every endpoint reports whether it is there.

const MAX_TITLE = 120
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const invalid = (message: string): Error => Object.assign(new Error(message), { code: 'bot/invalid' })

// What a group sees of a due reminder: the host frames it for one Session's model
// ("[SCHEDULE REMINDER]" with JSON fields); the group gets each prompt as one line.
export function reminderText(text: string): string {
  const prompts: unknown[] = []
  const one = /^reminder_prompt_json: (.*)$/m.exec(text)
  const batch = /^reminders_json: (.*)$/m.exec(text)
  try {
    if (one) prompts.push(JSON.parse(one[1] ?? 'null'))
    if (batch) for (const entry of JSON.parse(batch[1] ?? 'null') as readonly { readonly reminder_prompt?: unknown }[]) prompts.push(entry.reminder_prompt)
  } catch {
    // A framing this module cannot read goes to the group as it came.
    return text
  }
  const lines = prompts.filter((prompt): prompt is string => typeof prompt === 'string' && prompt.trim() !== '')
  return lines.length === 0 ? text : lines.map(prompt => `[Scheduled task] ${prompt}`).join('\n')
}

// The create request that gives a stored record its timing again, for a move.
function requestOf(record: ScheduleRecord): ScheduleRequest | null {
  const base = { title: record.title, prompt: record.prompt }
  if (record.kind === 'after' || record.kind === 'at') return { ...base, at: record.scheduledAt }
  if (record.kind === 'every') return { ...base, every_seconds: record.everySeconds }
  if (record.kind === 'daily') return { ...base, daily: { time: record.time, time_zone: record.timeZone } }
  if (record.kind === 'weekly') return { ...base, weekly: { time: record.time, time_zone: record.timeZone, weekdays: record.weekdays } }
  if (record.kind === 'cron') return { ...base, cron: { expression: record.expression, time_zone: record.timeZone } }
  return null
}

// The settings form's timing as a create request selector.
function selectorOf(when: SelectorInput | undefined): ScheduleSelector {
  const zone = typeof when?.timeZone === 'string' && when.timeZone !== '' ? when.timeZone : 'UTC'
  switch (when?.kind) {
    case 'at': {
      const at = new Date(String(when.at ?? ''))
      if (Number.isNaN(at.getTime())) throw invalid('Pick a date and time')
      if (at.getTime() <= Date.now()) throw invalid('Pick a time in the future')
      return { at: at.toISOString() }
    }
    case 'daily':
      if (!TIME.test(String(when.time))) throw invalid('Pick a time of day')
      return { daily: { time: `${when.time}:00`, time_zone: zone } }
    case 'weekly': {
      if (!TIME.test(String(when.time))) throw invalid('Pick a time of day')
      const weekdays = [...new Set((Array.isArray(when.weekdays) ? when.weekdays : []).map(Number))].filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort()
      if (weekdays.length === 0) throw invalid('Pick at least one day')
      return { weekly: { time: `${when.time}:00`, time_zone: zone, weekdays } }
    }
    case 'cron': {
      const expression = String((when as unknown as { expression?: unknown }).expression ?? '').trim()
      if (expression.split(/\s+/).length !== 5) throw invalid('A cron expression has five fields, such as "0 9 * * 1-5"')
      return { cron: { expression, time_zone: zone } }
    }
    case 'every': {
      const minutes = Number(when.minutes)
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) throw invalid('Repeat every 1 minute to 7 days')
      return { every_seconds: minutes * 60 }
    }
    default:
      throw invalid('Pick when it runs')
  }
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt
  let service: ScheduleService | null = null

  const attach = (sub: ScheduleHost): void => {
    const own = sub.schedule
    service = own ?? null
    sub.effect(() => () => { if (service === own) service = null }, 'moon-bot: schedule service')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['schedule'], sub => attach(sub))
  else {
    const own = ctx.get<ScheduleService>('schedule')
    if (own !== undefined) attach({ schedule: own, effect: (execute, label) => ctx.effect(execute, label) })
  }

  // The Bot (and group chat) a task's Session speaks for, the group chat for a group's
  // own Session, or nothing for a Session outside the team.
  const ownerOf = (sessionId: string): ScheduleOwner | undefined => {
    const chat = rt.chatOwners.get(sessionId)
    if (chat !== undefined) return { botId: chat }
    if (rt.roomOf(sessionId) !== undefined) return { roomId: sessionId }
    return rt.groupOwners.get(sessionId) ?? rt.pastOwners.get(sessionId)
  }
  const known = (owner: ScheduleOwner | undefined): boolean => owner !== undefined && (owner.botId === undefined ? rt.roomOf(owner.roomId) !== undefined : rt.botOf(owner.botId) !== undefined)

  async function schedulesView(): Promise<{ readonly available: boolean; readonly tasks: readonly Record<string, unknown>[] }> {
    if (service === null) return { available: false, tasks: [] }
    const tasks: Record<string, unknown>[] = []
    for (const entry of await service.catalog()) {
      const owner = ownerOf(entry.sessionId)
      if (!known(owner)) continue
      tasks.push({ ...entry, ...owner })
    }
    return { available: true, tasks }
  }

  const endpoints: Record<string, (body: ScheduleBody) => Promise<unknown>> = {
    schedules: () => schedulesView(),
    async 'schedule-create'(body) {
      if (service === null) throw invalid('Scheduled tasks are turned off')
      const target = bodyText(body, 'target')
      const bot = rt.botOf(target)
      const room = rt.roomOf(target)
      if (bot === undefined && room === undefined) throw invalid('No such Bot or group chat')
      const title = String(body.title ?? '').trim()
      const prompt = String(body.prompt ?? '').trim()
      if (title === '') throw invalid('Give the task a name')
      if (title.length > MAX_TITLE) throw invalid(`Keep the name under ${MAX_TITLE} characters`)
      if (prompt === '') throw invalid('Say what the Bot should do')
      const targetId = bot !== undefined ? rt.chatOf(bot.id) : room?.id
      if (targetId === undefined) throw invalid('No such Bot or group chat')
      await service.create(targetId, { title, prompt, ...selectorOf(body.when as SelectorInput | undefined) })
      return schedulesView()
    },
    async 'schedule-delete'(body) {
      if (service === null) throw invalid('Scheduled tasks are turned off')
      const sessionId = bodyText(body, 'sessionId') ?? ''
      if (ownerOf(sessionId) === undefined) throw invalid('No such task')
      await service.delete({ sessionId, id: String(body.id ?? '') })
      return schedulesView()
    },
  }

  // A fresh part takes over the earlier part's active tasks: each is created again on
  // the fresh Session before the old one goes, so a failure leaves it where it was.
  async function moveSchedules(fromId: string, toId: string): Promise<void> {
    if (service === null) return
    let records: readonly ScheduleRecord[]
    try {
      records = await service.list({ sessionId: fromId })
    } catch (error) {
      rt.warn('moon-bot: tasks of %s not moved: %s', fromId, error instanceof Error ? error.message : error)
      return
    }
    for (const record of records) {
      const request = requestOf(record)
      if (request === null || (request.at !== undefined && Date.parse(request.at) <= Date.now())) continue
      try {
        await service.create(toId, request)
        await service.delete({ sessionId: fromId, id: record.id })
      } catch (error) {
        rt.warn('moon-bot: task %s stayed with the earlier part: %s', record.title, error instanceof Error ? error.message : error)
      }
    }
  }

  installScheduleTools(rt)

  Object.assign(rt, {
    // The Bot tools read the same service the settings endpoints do, so a task made in
    // chat and one made in Settings are the same task, fired the same way.
    scheduleFor: (): ScheduleService | null => service,
    scheduleOwnerOf: ownerOf,
    // `when` is the settings form's shape, so a tool and the form accept the same timings.
    createScheduleFrom: async (sessionId: string, title: string, prompt: string, when: SelectorInput | undefined): Promise<void> => {
      if (service === null) throw invalid('Scheduled tasks are turned off')
      await service.create(sessionId, { title, prompt, ...selectorOf(when) })
    },
    listSchedulesOf: async (sessionId: string): Promise<readonly ScheduleRecord[]> => (service === null ? [] : service.list({ sessionId })),
    // Only a task of this Session may go: another conversation's id is refused rather
    // than deleted, so a Bot cannot cancel someone else's reminder by guessing an id.
    deleteScheduleOf: async (sessionId: string, id: string): Promise<void> => {
      if (service === null) throw invalid('Scheduled tasks are turned off')
      const own = await service.list({ sessionId })
      if (!own.some(record => record.id === id)) throw invalid(`No reminder ${id} comes back to this conversation`)
      await service.delete({ sessionId, id })
    },
    scheduleEndpoint: (endpoint: string, body: ScheduleBody | undefined): Promise<unknown> => {
      const handler = endpoints[endpoint]
      if (handler === undefined) throw invalid(`No such schedules endpoint: ${endpoint}`)
      return handler(body ?? {})
    },
    moveSchedules,
  })
}

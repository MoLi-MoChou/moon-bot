// The scheduling tools a Bot can call: set a reminder, list its own, cancel one.
//
// The target is always the Session the tool is called from — a Bot's own chat, or the
// group Session when it speaks in a group — so a Bot can never queue work into someone
// else's conversation. A task made here is the same record the Settings page makes, and
// the same scheduler fires it.
import { z } from 'zod'
import type { ToolContext } from '../engine/registry.ts'
import type { HostRuntime } from './runtime.ts'

interface ScheduleRecordLike {
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

/** How a task's timing reads back to the Bot. */
function timingOf(record: ScheduleRecordLike): string {
  if (record.kind === 'at' && record.scheduledAt !== undefined) return `once at ${new Date(record.scheduledAt).toISOString()}`
  if (record.kind === 'after' && record.scheduledAt !== undefined) return `once at ${new Date(record.scheduledAt).toISOString()}`
  if (record.kind === 'every' && record.everySeconds !== undefined) return `every ${String(Math.round(record.everySeconds / 60))} min`
  if (record.kind === 'daily' && record.time !== undefined) return `every day at ${record.time} ${record.timeZone ?? 'UTC'}`
  if (record.kind === 'weekly' && record.time !== undefined) return `every ${(record.weekdays ?? []).join(',')} at ${record.time} ${record.timeZone ?? 'UTC'}`
  if (record.kind === 'cron' && record.expression !== undefined) return `cron ${record.expression} ${record.timeZone ?? 'UTC'}`
  return record.kind
}

export function installScheduleTools(rt: HostRuntime): void {
  const can = (): boolean => (rt as unknown as { scheduleFor?: () => unknown }).scheduleFor?.() != null
  const off = (): string => 'Scheduled tasks are turned off in this build, so a reminder cannot be set here. The user can set one in Settings, or use the phone\'s own reminder app.'

  rt.registerTool({
    name: 'create_schedule',
    description: 'Set a reminder that comes back to this conversation on its own, at a time in the future or on a repeating schedule. Use it when the user asks you to remember something later, or to remind them. The reminder reaches this chat, or this group chat if you are speaking in one; each time it fires you get the prompt as a new message and answer it then.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short name for the reminder, up to 120 characters' },
      prompt: { type: 'string', required: true, description: 'What you are told when it fires. Write it to your future self, for example: remind the user to test the billing screen before 9:00' },
      when: { type: 'string', required: true, description: 'When it fires, as one of: "at", "daily", "weekly", "every", "cron"' },
      at: { type: 'string', description: 'For when=at: an ISO date-time with a zone, such as 2026-10-30T09:00:00+08:00. Must be in the future' },
      time: { type: 'string', description: 'For daily or weekly: the local time as HH:MM, 24-hour' },
      time_zone: { type: 'string', description: 'For daily, weekly or cron: an IANA zone such as Asia/Shanghai. Leave it out and the host uses its own local zone, which is the zone the current time in your instructions is given in' },
      weekdays: { type: 'string', description: 'For weekly: ISO weekdays 1 (Monday) to 7 (Sunday), comma separated, such as 1,3,5' },
      minutes: { type: 'string', description: 'For every: repeat interval in minutes, 1 to 10080' },
      expression: { type: 'string', description: 'For when=cron: a five-field cron expression, such as "0 9 * * 1-5"' },
    },
    schema: z.object({
      title: z.string(), prompt: z.string(), when: z.string(),
      at: z.string().optional(), time: z.string().optional(), time_zone: z.string().optional(),
      weekdays: z.string().optional(), minutes: z.string().optional(), expression: z.string().optional(),
    }).passthrough(),
    async execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
      await rt.load()
      if (!can()) return off()
      const sessionId = context.sessionId
      const owner = (rt as unknown as { scheduleOwnerOf?: (id: string) => { botId?: string; roomId?: string } | undefined }).scheduleOwnerOf?.(sessionId)
      if (owner === undefined) return 'This conversation is not one a reminder can come back to. Set it from a Bot\'s chat or a group chat.'
      const title = String(args.title ?? '').trim()
      const prompt = String(args.prompt ?? '').trim()
      if (title === '') return 'Give the reminder a short name.'
      if (prompt === '') return 'Say what has to happen when it fires.'
      const when = String(args.when ?? '').trim()
      const weekdays = args.weekdays === undefined ? undefined : String(args.weekdays).split(',').map(part => Number(part.trim())).filter(day => Number.isInteger(day))
      const selector = {
        kind: when,
        at: args.at,
        time: args.time,
        timeZone: args.time_zone,
        minutes: args.minutes,
        expression: args.expression,
        weekdays,
      }
      try {
        await (rt as unknown as { createScheduleFrom: (sessionId: string, title: string, prompt: string, when: unknown) => Promise<void> }).createScheduleFrom(sessionId, title, prompt, selector)
      } catch (error) {
        return `The reminder was not set: ${error instanceof Error ? error.message : String(error)}.`
      }
      const where = owner.roomId === undefined ? 'this chat' : 'this group chat'
      return `Set "${title}": it fires in ${where} and you will be told then. Tell the user when it will happen; do not claim you can act before it does.`
    },
  })

  rt.registerTool({
    name: 'list_schedules',
    description: 'List the reminders that come back to this conversation, with their timing and id. A Bot\'s own chat lists its reminders; a group chat lists the group\'s.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(_args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
      await rt.load()
      if (!can()) return off()
      const list = (rt as unknown as { listSchedulesOf: (id: string) => Promise<readonly ScheduleRecordLike[]> }).listSchedulesOf
      const records = await list(context.sessionId)
      if (records.length === 0) return 'No reminders come back to this conversation.'
      return records.map(record => `- ${record.id}: ${record.title} (${timingOf(record)}) — ${record.prompt}`).join('\n')
    },
  })

  rt.registerTool({
    name: 'delete_schedule',
    description: 'Cancel one reminder that comes back to this conversation. Get the id from list_schedules.',
    parameters: {
      id: { type: 'string', required: true, description: 'The id list_schedules printed' },
    },
    schema: z.object({ id: z.string() }).passthrough(),
    async execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
      await rt.load()
      if (!can()) return off()
      const id = String(args.id ?? '').trim()
      if (id === '') return 'Give the id of the reminder to cancel, as list_schedules shows it.'
      try {
        await (rt as unknown as { deleteScheduleOf: (sessionId: string, id: string) => Promise<void> }).deleteScheduleOf(context.sessionId, id)
        return `Cancelled ${id}.`
      } catch (error) {
        return `That reminder was not cancelled: ${error instanceof Error ? error.message : String(error)}.`
      }
    },
  })
}

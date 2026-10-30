import { dateLocale, t } from './i18n.ts'
import type { Task } from './schedules-types.ts'

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export const clock = (time: unknown): string => String(time ?? '').slice(0, 5)
export const when = (ms: number, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(dateLocale(), options).format(ms)
export function dayAndTime(ms: number): string {
  const sameYear = new Date(ms).getFullYear() === new Date().getFullYear()
  return when(ms, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
export function weekdayNames(days: readonly number[]): string {
  const names = days.map(day => when(Date.UTC(2024, 0, day), { weekday: 'short', timeZone: 'UTC' }))
  return names.join(dateLocale().startsWith('zh') ? '、' : ', ')
}
export function everyText(seconds: number): string {
  if (seconds % 86400 === 0)
    return seconds === 86400 ? t('Every day') : t('Every {count} days', { count: seconds / 86400 })
  if (seconds % 3600 === 0)
    return seconds === 3600 ? t('Every hour') : t('Every {count} hours', { count: seconds / 3600 })
  return t('Every {count} minutes', { count: Math.round(seconds / 60) })
}
// How often a task runs, in the user's words.
export function timingText(task: Task): string {
  const zone = task.timeZone && task.timeZone !== localZone() ? ` (${task.timeZone})` : ''
  switch (task.kind) {
    case 'after':
    case 'at':
      return t('Once, {time}', { time: dayAndTime(Date.parse(task.scheduledAt as string)) })
    case 'every':
      return everyText(task.everySeconds as number)
    case 'daily':
      return `${t('Every day at {time}', { time: clock(task.time) })}${zone}`
    case 'weekly': {
      const days = (task.weekdays ?? []).join()
      const text =
        days === '1,2,3,4,5'
          ? t('Every weekday at {time}', { time: clock(task.time) })
          : days === '6,7'
            ? t('Every weekend at {time}', { time: clock(task.time) })
            : days === '1,2,3,4,5,6,7'
              ? t('Every day at {time}', { time: clock(task.time) })
              : t('Every {days} at {time}', { days: weekdayNames(task.weekdays ?? []), time: clock(task.time) })
      return `${text}${zone}`
    }
    case 'cron':
      return `${t('On the schedule {expression}', { expression: task.expression as string })}${zone}`
    default:
      return ''
  }
}
export const nextText = (task: Task): string =>
  task.status === 'active'
    ? t('Next: {time}', { time: dayAndTime(Date.parse(task.scheduledAt as string)) })
    : t('Finished')

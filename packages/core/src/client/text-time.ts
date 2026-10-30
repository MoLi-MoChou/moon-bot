// -------------------------------------------------------------------------
// Clock and stamp text: the times a chat row, a separator and a list row show. Split out
// of text.ts to keep that file inside the line limit; text.ts re-exports them, so a
// caller keeps importing from one place.
import { dateLocale, t } from './i18n.ts'

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' })
}
const midnight = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
const daysBefore = (date: Date, now: number): number => Math.round((midnight(new Date(now)) - midnight(date)) / 86400000)
export function dayLabel(ms: number): string {
  const date = new Date(ms)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay ? t('Today {time}', { time: clock(ms) }) : `${date.toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' })} ${clock(ms)}`
}

// The time separator's stamp: "Today 1:12 AM", "Yesterday 9:03 PM", "Thu, Sep 3 4:20 PM".
export function clockLabel(time: number, now: number = Date.now()): string {
  const date = new Date(time)
  const days = daysBefore(date, now)
  const stamp = clock(time)
  if (days === 0) return t('Today {time}', { time: stamp })
  if (days === 1) return t('Yesterday {time}', { time: stamp })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return `${date.toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} ${stamp}`
}

// A message's own stamp: today only the clock, an earlier day named as a separator does.
export function messageClock(time: number, now: number = Date.now()): string {
  return daysBefore(new Date(time), now) === 0 ? clock(time) : clockLabel(time, now)
}

// A short relative stamp for list rows: "just now", "5 min", "3 h", "2 d", then a date.
export function relativeShort(ms: number): string {
  const diff = Math.max(0, Date.now() - ms)
  if (diff < 60_000) return t('just now')
  if (diff < 3_600_000) return t('{n} min', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('{n} h', { n: Math.floor(diff / 3_600_000) })
  if (diff < 30 * 86_400_000) return t('{n} d', { n: Math.floor(diff / 86_400_000) })
  return new Date(ms).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
}

// A running clock: "8s", "1m 8s", "1h 2m 8s", in every language.
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  return `${hours > 0 ? `${hours}h ` : ''}${total >= 60 ? `${Math.floor(total / 60) % 60}m ` : ''}${total % 60}s`
}

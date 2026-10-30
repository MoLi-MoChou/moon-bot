import { Fragment, createElement as h, useState } from 'react'
import type { FormEvent } from 'react'
import { Segmented } from './motion.tsx'
import { hostText, t } from './i18n.ts'
import type { ScheduleActions, ScheduleListener, ScheduleRoster, ScheduleView } from './schedules-types.ts'
import { localZone, when } from './schedules-timing.ts'

const inputValue = (event: { currentTarget: { value: string } }): string => event.currentTarget.value

const pad = (number: number): string => String(number).padStart(2, '0')
function inAnHour(): string {
  const date = new Date(Date.now() + 3600000)
  date.setMinutes(0, 0, 0)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`
}
const KINDS: readonly (readonly [string, string])[] = [
  ['at', 'Once'],
  ['daily', 'Every day'],
  ['weekly', 'Every week'],
  ['every', 'Repeat'],
]
const UNITS: readonly (readonly [string, number, string])[] = [
  ['minutes', 1, 'minutes'],
  ['hours', 60, 'hours'],
  ['days', 1440, 'days'],
]
export function TaskForm({
  roster,
  actions,
  start,
  onDone,
  onCancel,
}: {
  roster: ScheduleRoster
  actions: ScheduleActions
  start: string | undefined
  onDone: ScheduleListener
  onCancel: () => void
}) {
  // A task goes to a Bot's chat or to a group chat, where it reads as your message.
  const [target, setTarget] = useState(start ?? roster.bots[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState('daily')
  const [at, setAt] = useState(inAnHour)
  const [time, setTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [count, setCount] = useState<string | number>(1)
  const [unit, setUnit] = useState('hours')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timing = () => {
    if (kind === 'at') return { kind, at: new Date(at).toISOString() }
    if (kind === 'every')
      return { kind, minutes: Math.round(Number(count) * (UNITS.find(([id]) => id === unit)?.[1] ?? 1)) }
    return { kind, time, timeZone: localZone(), ...(kind === 'weekly' ? { weekdays } : {}) }
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    let when: Record<string, unknown>
    try {
      when = timing()
    } catch {
      setError(t('Pick a date and time'))
      setBusy(false)
      return
    }
    void actions.scheduleCreate({ target, title, prompt, when }).then(
      next => onDone(next as ScheduleView),
      (
        failure:
          | {
              readonly message?: string
            }
          | null
          | undefined,
      ) => {
        setError(hostText(failure?.message ?? String(failure)))
        setBusy(false)
      },
    )
  }
  const toggleDay = (day: number): void =>
    setWeekdays(days => (days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort()))
  return (
    <form className='bt-set-card bt-task-form' onSubmit={submit}>
      <label className='bt-set-row bt-bs-row'>
        <span className='bt-set-copy'>
          <span className='bt-bs-label'>{t('Send to')}</span>
        </span>
        <select className='bt-select bt-task-bot' value={target} onChange={event => setTarget(inputValue(event))}>
          <optgroup label={t('Bots')}>
            {roster.bots.map(bot => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </optgroup>
          {roster.rooms.length > 0 ? (
            <optgroup label={t('Group chats')}>
              {roster.rooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <label className='bt-set-row bt-bs-row'>
        <span className='bt-set-copy'>
          <span className='bt-bs-label'>{t('Name')}</span>
        </span>
        <input
          className='bt-bs-input'
          value={title}
          maxLength={120}
          placeholder={t('Morning briefing')}
          autoFocus
          onChange={event => setTitle(inputValue(event))}
        />
      </label>
      <label className='bt-set-row bt-bs-row bt-bs-stack'>
        <span className='bt-set-copy'>
          <span className='bt-bs-label'>{t('What to do')}</span>
        </span>
        <textarea
          className='bt-bs-input bt-bs-area'
          value={prompt}
          rows={3}
          placeholder={t('Sum up what changed since yesterday and what needs me today.')}
          onChange={event => setPrompt(inputValue(event))}
        />
      </label>
      <div className='bt-set-row bt-bs-row bt-bs-stack'>
        <span className='bt-set-copy'>
          <span className='bt-bs-label'>{t('When')}</span>
        </span>
        <Segmented label={t('When')} value={kind}>
          {KINDS.map(([id, label]) => (
            <button key={id} type='button' aria-pressed={kind === id} onClick={() => setKind(id)}>
              {t(label)}
            </button>
          ))}
        </Segmented>
        <div key={kind} className='bt-task-when bt-veil'>
          {kind === 'at' ? (
            <input
              className='bt-input'
              type='datetime-local'
              value={at}
              aria-label={t('Date and time')}
              onChange={event => setAt(inputValue(event))}
            />
          ) : null}
          {kind === 'weekly' ? (
            <div className='bt-task-days' role='group' aria-label={t('Days')}>
              {[1, 2, 3, 4, 5, 6, 7].map(day => (
                <button
                  key={day}
                  type='button'
                  className='bt-task-day'
                  aria-pressed={weekdays.includes(day)}
                  onClick={() => toggleDay(day)}>
                  {when(Date.UTC(2024, 0, day), { weekday: 'narrow', timeZone: 'UTC' })}
                </button>
              ))}
            </div>
          ) : null}
          {kind === 'daily' || kind === 'weekly' ? (
            <input
              className='bt-input bt-task-time'
              type='time'
              value={time}
              aria-label={t('Time')}
              onChange={event => setTime(inputValue(event))}
            />
          ) : null}
          {kind === 'every' ? (
            <>
              <span className='bt-task-every'>{t('Every')}</span>
              <input
                className='bt-input bt-task-count'
                type='number'
                min={1}
                value={count}
                aria-label={t('How many')}
                onChange={event => setCount(inputValue(event))}
              />
              <select
                className='bt-select bt-task-unit'
                value={unit}
                aria-label={t('Unit')}
                onChange={event => setUnit(inputValue(event))}>
                {UNITS.map(([id, , label]) => (
                  <option key={id} value={id}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className='bt-set-row'>
          <span className='bt-danger bt-set-hint'>{error}</span>
        </div>
      ) : null}
      <div className='bt-set-row bt-task-foot'>
        <button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button
          type='submit'
          className='bt-send bt-soft-sm'
          disabled={busy || !target || title.trim() === '' || prompt.trim() === ''}>
          {busy ? t('Creating…') : t('Create task')}
        </button>
      </div>
    </form>
  )
}
// Settings has no schedule service to show: Automation tasks are off in the host.

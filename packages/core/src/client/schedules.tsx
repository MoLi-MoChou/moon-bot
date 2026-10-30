// Scheduled tasks: Settings → Scheduled tasks, a Bot's card in its settings, and the
// line in its details panel. the host runs the tasks (see src/host/schedules.tsx); a task
// sends its prompt to the Bot's chat when it is due.
import { createElement as h, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BotAvatar, RoomAvatar } from './mark.tsx'
import { ClockIcon, PlusIcon } from './icons.tsx'
import { EmptyState } from 'moon-bot-ui'
import { t } from './i18n.ts'
import type { ScheduleActions, ScheduleListener, ScheduleRoster, ScheduleView, Task } from './schedules-types.ts'
import { TaskForm } from './schedules-form.tsx'
import { TaskRow } from './schedules-row.tsx'
import { timingText } from './schedules-timing.ts'
import { SCHEDULE_CSS } from './schedules-css.ts'

export type { Task, ScheduleView, ScheduleActions, ScheduleRoster } from './schedules-types.ts'
export { timingText } from './schedules-timing.ts'
export { SCHEDULE_CSS }

const POLL_MS = 30000
// One view for every surface that shows tasks; each asks again when it mounts.
let shared: ScheduleView | null = null
const listeners = new Set<ScheduleListener>()
function publish(view: ScheduleView): void {
  shared = view
  for (const listener of listeners) listener(view)
}
export function useSchedules(actions: ScheduleActions): ScheduleView | null {
  const [view, setView] = useState<ScheduleView | null>(shared)
  useEffect(() => {
    listeners.add(setView)
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (): void => {
      void (actions.schedules?.() ?? Promise.resolve(null))
        .then(next => {
          if (!stopped && next !== null) publish(next)
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(load, POLL_MS)
        })
    }
    load()
    return () => {
      stopped = true
      clearTimeout(timer)
      listeners.delete(setView)
    }
  }, [])
  return view
}

function AutomationOff({ actions }: { actions: ScheduleActions }) {
  return (
    <div className='bt-set-card bt-task-off'>
      <EmptyState
        icon={<ClockIcon />}
        title={t('Turn on scheduled tasks')}
        hint={t('Scheduled tasks are turned off for this Bot.')}
        {...(actions.openShellSettingsPanel
          ? { action: { label: t('Open settings'), onClick: actions.openShellSettingsPanel } }
          : {})}
      />
    </div>
  )
}
export function SchedulesPage({
  roster,
  actions,
  start,
}: {
  roster: ScheduleRoster
  actions: ScheduleActions
  start?: string | undefined
}) {
  const view = useSchedules(actions)
  const [adding, setAdding] = useState(Boolean(start))
  if (view === null) return <div className='bt-set-hint'>{t('Loading…')}</div>
  if (!view.available) return <AutomationOff actions={actions} />
  const shown: ScheduleListener = next => {
    publish(next)
    setAdding(false)
  }
  const byChat: [string, ReactNode, string, readonly Task[]][] = [
    ...roster.bots.map((bot): [string, ReactNode, string, readonly Task[]] => [
      bot.id,
      <BotAvatar bot={bot} size={18} badge={false} live={false} />,
      bot.name,
      view.tasks.filter(task => task.botId === bot.id),
    ]),
    ...roster.rooms.map((room): [string, ReactNode, string, readonly Task[]] => [
      room.id,
      <RoomAvatar room={room} roster={roster} size={18} />,
      room.name,
      view.tasks.filter(task => task.botId === undefined && task.roomId === room.id),
    ]),
  ].filter(entry => entry[3].length > 0)
  return [
    adding ? (
      <TaskForm
        key='form'
        roster={roster}
        actions={actions}
        start={start}
        onDone={shown}
        onCancel={() => setAdding(false)}
      />
    ) : (
      <div key='add' className='bt-actions'>
        <button type='button' className='bt-soft bt-soft-sm bt-with-icon' onClick={() => setAdding(true)}>
          <PlusIcon />
          {t('New task')}
        </button>
      </div>
    ),
    byChat.length === 0 && !adding ? (
      <div key='none' className='bt-set-card'>
        <EmptyState
          icon={<ClockIcon />}
          title={t('No scheduled tasks yet.')}
          hint={t('A scheduled task sends a prompt to a Bot or group on its own.')}
          action={{ icon: <PlusIcon />, label: t('New task'), onClick: () => setAdding(true) }}
        />
      </div>
    ) : (
      byChat.map(([id, avatar, name, tasks]) => (
        <section key={id} className='bt-set-section'>
          <h3 className='bt-task-head'>
            {avatar}
            {name}
          </h3>
          <div className='bt-set-card'>
            {tasks.map(task => (
              <TaskRow key={task.id} task={task} actions={actions} roster={roster} onView={publish} />
            ))}
          </div>
        </section>
      ))
    ),
  ]
}
// A Bot's tasks in its settings form, with the way to add one.
export function BotSchedules({
  bot,
  roster,
  actions,
}: {
  bot: {
    readonly id: string
    readonly name: string
  }
  roster: ScheduleRoster
  actions: ScheduleActions
}) {
  const view = useSchedules(actions)
  if (view === null) return null
  const tasks = view.available ? view.tasks.filter(task => task.botId === bot.id) : []
  return (
    <section className='bt-set-section'>
      <h3>{t('Scheduled tasks')}</h3>
      <div className='bt-set-card'>
        {!view.available ? (
          <div className='bt-set-row bt-bs-row'>
            <span className='bt-set-copy'>
              <span className='bt-set-hint'>{t('Scheduled tasks are turned off for this Bot.')}</span>
            </span>
            {actions.openShellSettingsPanel ? (
              <button type='button' className='bt-soft bt-soft-sm' onClick={actions.openShellSettingsPanel}>
                {t('Open settings')}
              </button>
            ) : null}
          </div>
        ) : (
          [
            ...tasks.map(task => (
              <TaskRow key={task.id} task={task} actions={actions} roster={roster} onView={publish} />
            )),
            <button
              key='new'
              type='button'
              className='bt-set-row bt-bs-row bt-gs-add'
              onClick={() => actions.openSettings('schedules', bot.id)}>
              <PlusIcon />
              {t('New task')}
            </button>,
          ]
        )}
      </div>
    </section>
  )
}
// The details panel's line: the Bot's next tasks, or how to add one.
export function ScheduleSummary({
  bot,
  actions,
}: {
  bot: {
    readonly id: string
    readonly name: string
  }
  actions: ScheduleActions
}) {
  const view = useSchedules(actions)
  const tasks = view?.available ? view.tasks.filter(task => task.botId === bot.id && task.status === 'active') : []
  return (
    <div>
      <div className='bt-section-title'>{t('Scheduled tasks')}</div>
      {tasks.length === 0 ? (
        <button type='button' className='bt-more' onClick={() => actions.openSettings('schedules', bot.id)}>
          {view?.available === false
            ? t('Scheduled tasks are turned off for this Bot.')
            : t('No scheduled tasks yet. Add one')}
        </button>
      ) : (
        <div className='bt-task-list'>
          {tasks.slice(0, 3).map(task => (
            <button
              key={task.id}
              type='button'
              className='bt-task-line'
              onClick={() => actions.openSettings('schedules')}>
              <ClockIcon />
              <span className='bt-task-line-title'>{task.title}</span>
              <span className='bt-task-line-when'>{timingText(task)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

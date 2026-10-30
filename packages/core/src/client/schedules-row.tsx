import { createElement as h, useEffect, useState } from 'react'
import { BotAvatar } from './mark.tsx'
import { TrashIcon } from './icons.tsx'
import { t } from './i18n.ts'
import type { ScheduleActions, ScheduleListener, ScheduleRoster, ScheduleView, Task } from './schedules-types.ts'
import { nextText, timingText } from './schedules-timing.ts'

export function TaskRow({
  task,
  actions,
  onView,
  showBot,
  roster,
}: {
  task: Task
  actions: ScheduleActions
  onView: ScheduleListener
  showBot?: boolean | undefined
  roster: ScheduleRoster
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [confirming])
  const remove = (): void => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    void actions.scheduleDelete(task.sessionId, task.id).then(
      next => onView(next as ScheduleView),
      () => setBusy(false),
    )
  }
  const room = task.roomId === undefined ? undefined : roster.roomsById[task.roomId]
  return (
    <div
      className='bt-set-row bt-task'
      data-done={task.status === 'active' ? undefined : ''}
      data-busy={busy || undefined}>
      {showBot ? (
        <BotAvatar
          bot={task.botId === undefined ? undefined : roster.byId[task.botId]}
          size={28}
          badge={false}
          live={false}
        />
      ) : null}
      <span className='bt-set-copy'>
        <span className='bt-task-title'>{task.title}</span>
        <span className='bt-set-hint'>
          {[timingText(task), room ? t('in {name}', { name: room.name }) : ''].filter(Boolean).join(' · ')}
        </span>
        {task.prompt && task.prompt !== task.title ? <span className='bt-task-prompt'>{task.prompt}</span> : null}
      </span>
      <span className='bt-task-next'>{nextText(task)}</span>
      <button
        type='button'
        className='bt-mini bt-task-remove'
        data-confirm={confirming || undefined}
        disabled={busy}
        aria-label={confirming ? t('Click again to delete') : t('Delete task')}
        title={confirming ? undefined : t('Delete task')}
        onClick={remove}>
        {confirming ? t('Delete') : <TrashIcon />}
      </button>
    </div>
  )
}

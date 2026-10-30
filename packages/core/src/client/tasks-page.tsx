import { Fragment, createElement as h, useEffect, useRef, useState } from 'react'
import { EmptyState } from 'moon-bot-ui'
import { t } from './i18n.ts'
import { TasksIcon } from './icons.tsx'
import { SPRING_SHAPE } from './motion.tsx'
import { TaskQueue } from './tasks-queue.tsx'
import type { TaskRunning, TasksAnswer, TaskStateFilter, TaskFilters, TaskActions, TasksState, TasksBoardProps } from './tasks-types.ts'
import { filterTasks, elapsed, doingText, reasonText, holdText, turnKey } from './tasks-helpers.ts'
export type {
  TaskRunning,
  TaskDone,
  TaskWaiting,
  TasksAnswer,
  TaskStateFilter,
  TaskFilters,
  TaskActions,
  TasksState,
  TasksBoardProps,
  TaskStopAnswer,
  TaskQueueAnswer,
  TaskContinueAnswer,
} from './tasks-types.ts'
export { filterTasks, elapsed, doingText, reasonText, holdText } from './tasks-helpers.ts'

export function useTasks(taskActions: TaskActions): TasksState {
  const [answer, setAnswer] = useState<TasksAnswer | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [stopped, setStopped] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const mounted = useRef(true)
  const refresh = (): void => {
    const current = ++request.current
    void taskActions
      .tasks()
      .then(next => {
        if (!mounted.current || current !== request.current) return
        setAnswer(next)
        // A stopped row leaves with its turn; a turn that starts after it (a queued
        // message) is a different one and is not marked.
        setStopped(marked => new Set([...marked].filter(key => (next.running ?? []).some(task => turnKey(task) === key))))
      })
      .catch(failure => {
        if (mounted.current && current === request.current) setError(failure?.message ?? String(failure))
      })
  }
  useEffect(() => {
    refresh()
    const poll = setInterval(() => {
      setNow(Date.now())
      refresh()
    }, 2000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      mounted.current = false
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])
  const stop = (task: TaskRunning): void => {
    setBusy(task.sessionId)
    setNotice(null)
    setError(null)
    void taskActions
      .stopTask(task.sessionId)
      .then(result => {
        // The turn may have ended between the panel's poll and the click; say so
        // instead of pretending something was stopped.
        if (result?.stopped === false) {
          setNotice(t('{name} had already finished, so nothing was stopped.', { name: task.botName }))
          refresh()
          return
        }
        setStopped(marked => new Set([...marked, turnKey(task)]))
        refresh()
      })
      .catch(failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(null))
  }
  const withdraw = (sessionId: string, id: string): void => {
    setBusy(`queue:${id}`)
    setNotice(null)
    setError(null)
    void taskActions
      .removeQueued(sessionId, id)
      .then(result => {
        if (result?.removed === false) setNotice(t('That message had already started, so it stayed.'))
        refresh()
      })
      .catch(failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(null))
  }
  const continueTurn = (sessionId: string): void => {
    const run = taskActions.continueTurn
    if (run === undefined) return
    setBusy(`continue:${sessionId}`)
    setNotice(null)
    setError(null)
    void run(sessionId)
      .then(result => {
        if (result?.continued === false) setNotice(t('That turn is not waiting to continue.'))
        refresh()
      })
      .catch(failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(null))
  }
  return { answer, now, busy, stopped, notice, error, refresh, stop, withdraw, continueTurn }
}
/** Who is working, who waits, what finished lately — the sections both surfaces draw. */
export function TasksBoard({ state, onOpen, initialFilters }: TasksBoardProps) {
  const { answer, now, busy, stopped, notice, error, stop, withdraw, continueTurn } = state
  const [filters, setFilters] = useState<TaskFilters>(initialFilters ?? { state: 'all', botId: 'all' })
  const running = answer?.running ?? []
  const completed = answer?.completed ?? []
  const waiting = answer?.waiting ?? []
  const bots = [...new Map([...running, ...waiting, ...completed].map(task => [task.botId, task.botName])).entries()]
  const filtered = filterTasks({ running, waiting, completed }, filters)
  const shownRunning = filtered.running
  const shownWaiting = filtered.waiting
  const shownCompleted = filtered.completed
  const show = (kind: Exclude<TaskStateFilter, 'all'>): boolean => filters.state === 'all' || filters.state === kind
  const hasShelf = running.length + waiting.length + completed.length > 0
  const filteredActive = filters.state !== 'all' || filters.botId !== 'all'
  const shownCount = shownRunning.length + shownWaiting.length + shownCompleted.length
  const clearFilters = (): void => {
    setFilters({ state: 'all', botId: 'all' })
  }
  // Filters stay out of an empty shelf (Library pattern). Keep them when a filter is
  // already active so the user can clear it after every matching row leaves.
  const showFilters = hasShelf || filteredActive
  return (
    <>
      {notice !== null ? (
        <div className='bt-tasks-notice' role='status'>
          {notice}
        </div>
      ) : null}
      {error !== null ? (
        <div className='bt-connector-error' role='alert'>
          {error}
        </div>
      ) : null}
      {showFilters ? (
        <div className='bt-task-filters'>
          <label>
            <span>{t('Filter by state')}</span>
            <select aria-label={t('Filter by state')} value={filters.state} onChange={event => setFilters(current => ({ ...current, state: event.target.value as TaskStateFilter }))}>
              <option value='all'>{t('All states')}</option>
              <option value='running'>{t('Running')}</option>
              <option value='waiting'>{t('Waiting')}</option>
              <option value='completed'>{t('Recently finished')}</option>
            </select>
          </label>
          <label>
            <span>{t('Filter by Bot')}</span>
            <select aria-label={t('Filter by Bot')} value={filters.botId} onChange={event => setFilters(current => ({ ...current, botId: event.target.value }))}>
              <option value='all'>{t('All Bots')}</option>
              {bots.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {answer === null ? (
        <div className='bt-set-row'>
          <span className='bt-set-hint'>{t('Loading…')}</span>
        </div>
      ) : !hasShelf ? (
        <EmptyState icon={<TasksIcon />} title={t('Nobody is working right now.')} hint={t('Running turns, waiting handoffs and recently finished work show up here.')} />
      ) : filteredActive && shownCount === 0 ? (
        <EmptyState icon={<TasksIcon />} title={t('No tasks match these filters.')} action={{ label: t('Clear filters'), onClick: clearFilters }} />
      ) : (
        <>
          {show('running') ? (
            <section className='bt-set-section'>
              <h3>{t('Running')}</h3>
              <div className='bt-set-card'>
                {shownRunning.length === 0 ? (
                  <div className='bt-set-row'>
                    <span className='bt-set-hint'>{t('Nobody is working right now.')}</span>
                  </div>
                ) : (
                  shownRunning.map(task => {
                    const isStopped = stopped.has(turnKey(task))
                    // The count pill already says how many wait; a second "Queued" hold is noise.
                    const hold = task.hold === 'queued' ? undefined : task.hold
                    return (
                      <div key={task.sessionId} className='bt-task-block'>
                        <div className='bt-task-row' data-stopped={isStopped || undefined}>
                          <button type='button' className='bt-task-who' onClick={() => onOpen(task.sessionId)}>
                            <span className='bt-task-name'>{task.botName}</span>
                            <span className='bt-task-sub'>
                              {doingText(task)}
                              {task.roomName !== undefined ? ` · ${task.roomName}` : ''}
                            </span>
                          </button>
                          {task.fromName !== undefined ? <span className='bt-task-from'>{t('for {name}', { name: task.fromName })}</span> : null}
                          {task.queued !== undefined && task.queued > 0 ? (
                            <span className='bt-task-queued' title={t('Messages waiting for the next turn')}>
                              {t('{count} queued', { count: task.queued })}
                            </span>
                          ) : null}
                          {holdText(hold) !== undefined ? <span className='bt-task-hold'>{holdText(hold)}</span> : null}
                          <span className='bt-task-clock'>{elapsed(now - task.since)}</span>
                          {isStopped ? (
                            <span className='bt-task-state'>{t('Stopped by you')}</span>
                          ) : (
                            <button type='button' className='bt-soft bt-soft-sm bt-task-stop' disabled={busy === task.sessionId} title={t('Stop {name}', { name: task.botName })} aria-label={t('Stop {name}', { name: task.botName })} onClick={() => stop(task)}>
                              {busy === task.sessionId ? t('Stopping…') : t('Stop')}
                            </button>
                          )}
                        </div>
                        <TaskQueue sessionId={task.sessionId} items={task.queue} busy={busy} onWithdraw={withdraw} />
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          ) : null}
          {show('waiting') && shownWaiting.length > 0 ? (
            <section className='bt-set-section'>
              <h3>{t('Waiting for another Bot')}</h3>
              <div className='bt-set-card'>
                {shownWaiting.map(entry => (
                  <div key={`${entry.hold ?? 'wait'}:${entry.sessionId ?? entry.botId}`} className='bt-task-row'>
                    <button type='button' className='bt-task-who' onClick={() => onOpen(entry.sessionId ?? entry.botId)}>
                      <span className='bt-task-name'>{entry.botName}</span>
                      <span className='bt-task-sub'>{entry.hold === 'interrupted' ? (entry.for[0] ?? t('Cut off by a restart')) : t('Waiting for {names}', { names: entry.for.join(', ') })}</span>
                    </button>
                    {holdText(entry.hold) !== undefined ? <span className='bt-task-hold'>{holdText(entry.hold)}</span> : null}
                    {entry.hold === 'interrupted' && entry.sessionId !== undefined ? (
                      <button type='button' className='bt-soft bt-soft-sm' disabled={busy === `continue:${entry.sessionId}`} onClick={() => continueTurn(entry.sessionId ?? '')}>
                        {t('Continue')}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {show('completed') ? (
            <section className='bt-set-section'>
              <h3>{t('Recently finished')}</h3>
              <div className='bt-set-card'>
                {shownCompleted.length === 0 ? (
                  <div className='bt-set-row'>
                    <span className='bt-set-hint'>{t('Nothing has finished yet.')}</span>
                  </div>
                ) : (
                  shownCompleted.map((task, index) => (
                    <button key={`${task.sessionId}:${task.endedAt}:${index}`} type='button' className='bt-task-row bt-task-done' onClick={() => onOpen(task.sessionId)}>
                      <span className='bt-task-who'>
                        <span className='bt-task-name'>{task.botName}</span>
                        <span className='bt-task-sub'>
                          {reasonText(task.reason)}
                          {task.fromName !== undefined ? ` · ${t('for {name}', { name: task.fromName })}` : ''}
                        </span>
                      </span>
                      <span className='bt-task-clock'>{elapsed(task.endedAt - task.startedAt)}</span>
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
/** Settings → Tasks: the same board as a page. */
export function TasksPage({ taskActions }: { taskActions: TaskActions }) {
  const state = useTasks(taskActions)
  return <TasksBoard state={state} onOpen={taskActions.openSession} />
}
export const TASKS_CSS = `
.bt-task-block{display:flex;flex-direction:column;width:100%}
.bt-task-row{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:48px;border:0;background:none;width:100%;text-align:left;font:inherit;color:inherit}
.bt-task-queue{display:flex;flex-direction:column;gap:4px;margin:0;padding:0 12px 8px;list-style:none}
.bt-task-queue-line{display:flex;align-items:center;gap:8px;min-width:0}
.bt-task-queue-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-task-done{cursor:pointer;border-radius:8px}
.bt-task-done:hover{background:var(--bt-hover)}
.bt-task-row[data-stopped]{opacity:.65}
.bt-task-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:8px}
button.bt-task-who:hover .bt-task-name{color:var(--bt-accent)}
.bt-task-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-sub{font-size:11px;line-height:15px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-from{flex:none;font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-task-queued{flex:none;font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-task-hold{flex:none;font-size:11px;line-height:16px;color:var(--bt-ink-2);white-space:nowrap}
.bt-task-filters{display:flex;gap:8px;flex-wrap:wrap}
.bt-task-filters label{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;color:var(--bt-ink-3)}
.bt-task-filters select{max-width:180px;min-width:0;border:1px solid var(--bt-line-2);border-radius:8px;padding:5px 8px;background:var(--bt-main);color:var(--bt-ink);font:inherit}
.bt-task-state{flex:none;font-size:11px;line-height:16px;color:var(--bt-ink-3);white-space:nowrap}
.bt-task-clock{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-task-stop{flex:none;color:var(--bt-warn)}
.bt-task-stop:hover:not(:disabled){background:color-mix(in srgb,var(--bt-warn) 12%,var(--bt-hover))}
.bt-tasks-notice{padding:8px 12px;border-radius:10px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:12px;line-height:16px}
.bt-pending-queued{align-self:flex-end;padding:1px 8px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);font-size:11px;line-height:16px;white-space:nowrap}
/* The sidebar's task popover: the same sections in a dialog over the conversation. */
.bt-tasks-layer{position:fixed;inset:var(--bt-frame-chrome-top,0px) 0 0;z-index:60;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-tasks{position:relative;width:min(460px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 2*max(24px,var(--bt-frame-overlay-top,24px))));background:var(--bt-main);border-radius:16px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px var(--bt-line),0 0 0 .5px var(--bt-line-2);display:flex;flex-direction:column;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-tasks:focus-visible{outline:none}
.bt-tasks-head{display:flex;align-items:center;gap:8px;height:60px;flex:none;padding:0 12px 0 18px;border-bottom:.5px solid var(--bt-line);box-sizing:border-box}
.bt-tasks-head .bt-icon-btn{width:32px;height:32px;flex:none}
.bt-tasks-icon{display:inline-flex;flex:none;color:var(--bt-ink-2)}
.bt-tasks-title{margin:0;font-size:16px;line-height:24px;font-weight:600;white-space:nowrap}
.bt-tasks-status{flex:1;min-width:0;font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-tasks-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px 18px;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin}
@media (max-width:640px){.bt-task-from{display:none}.bt-tasks{width:100vw;height:100%;max-height:100%;border-radius:0;border:0}.bt-tasks-body{padding:12px 12px 20px}}
@media (prefers-reduced-motion:reduce){.bt-tasks{animation:bt-fade .12s ease-out!important}}
`

/** Task list text and filter helpers. */
import { t } from './i18n.ts'
import type { TaskHold } from 'moon-bot-contracts'
import type { TaskRunning, TasksAnswer, TaskFilters, TaskStateFilter } from './tasks-types.ts'

export function filterTasks(answer: TasksAnswer, filters: TaskFilters): TasksAnswer {
  const byBot = (task: { botId: string }): boolean => filters.botId === 'all' || task.botId === filters.botId
  const include = (kind: Exclude<TaskStateFilter, 'all'>): boolean => filters.state === 'all' || filters.state === kind
  return {
    running: include('running') ? answer.running.filter(byBot) : [],
    waiting: include('waiting') ? answer.waiting.filter(byBot) : [],
    completed: include('completed') ? answer.completed.filter(byBot) : [],
  }
}
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}
export function doingText(
  task: TaskRunning,
  translate: (key: string, params?: Record<string, unknown>) => string = t,
): string {
  if (task.switching === true) return translate('Switching to a new session')
  if (task.tool !== undefined)
    return task.target === undefined
      ? translate('Running {tool}', { tool: task.tool })
      : translate('Running {tool} on {target}', { tool: task.tool, target: task.target })
  if (task.said !== undefined) return task.said
  return translate('Working')
}
export function reasonText(reason: string): string {
  if (reason === 'completed') return t('Finished')
  if (reason === 'error') return t('Failed')
  if (reason === 'user') return t('Stopped by you')
  if (reason === 'hook') return t('Stopped by a Main Bot')
  // The engine reports a cancelled turn with the abort reason; the panel's Stop is it.
  if (reason === 'aborted' || reason === 'disposed') return t('Stopped')
  return t(reason)
}
export function holdText(hold: TaskHold | undefined): string | undefined {
  if (hold === undefined) return undefined
  if (hold === 'approval') return t('Waiting for your approval')
  if (hold === 'queued') return t('Queued')
  if (hold === 'handoff') return t('Waiting for another Bot')
  if (hold === 'interrupted') return t('Cut off by a restart')
  return t('Engine busy')
}
export const turnKey = (task: TaskRunning): string => `${task.sessionId}:${task.since}`

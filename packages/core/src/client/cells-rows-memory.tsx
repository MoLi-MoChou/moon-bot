import { createElement as h, useEffect } from 'react'
import { MemoryIcon } from './icons.tsx'
import { t } from './i18n.ts'
import type { CellActions, ChatBot, ChatRoster, LiveNote } from './cells-bubbles.tsx'

export interface MemoryEventProps {
  sessionId: string
  scope?: string | undefined
  result: string
  roster: ChatRoster
  actions: CellActions
  findBot: (nameOrId?: string | undefined) => ChatBot | undefined
  turnKey?: string | undefined
  callId?: string | undefined
}
// A Turn's settled thinking time, fetched per count of settled steps: while a turn
const memoryLines = new Map<string, Map<string, string | undefined>>()
export const forgetMemoryLines = (): void => {
  memoryLines.clear()
}
const firstMemoryLine = (turnKey: string | undefined, target: string, callId: string | undefined): boolean => {
  if (turnKey === undefined || callId === undefined) return true
  let lines = memoryLines.get(turnKey)
  if (!lines) {
    if (memoryLines.size > 500) {
      const oldest = memoryLines.keys().next().value
      if (oldest !== undefined) memoryLines.delete(oldest)
    }
    memoryLines.set(turnKey, (lines = new Map<string, string>()))
  }
  if (!lines.has(target)) lines.set(target, callId)
  return lines.get(target) === callId
}
export function MemoryEvent({ sessionId, scope, result, roster, actions, findBot, turnKey, callId }: MemoryEventProps) {
  if (!/^(Saved to|Updated in|Removed from) /.test(result)) return null
  const self = roster.byId[sessionId]
  const team = /^(team|团队|共享)$/i.test(String(scope ?? '').trim())
  const other = team || !scope ? undefined : findBot(scope)
  const target = other && other.id !== self?.id ? other : self
  if (!target) return null
  if (!firstMemoryLine(turnKey, team ? 'team' : target.id, callId)) return null
  const label = team
    ? t('Team memory updated')
    : target === self
      ? t('Memory updated')
      : t("Updated {name}'s memory", { name: target.name })
  return (
    <div className='bt-event'>
      <button type='button' title={result} onClick={() => actions.openMemory(target.id)}>
        <MemoryIcon />
        {label}
      </button>
    </div>
  )
}
// Transcript rows report what is in flight to the one activity row at the tail.
export function useLiveNote(actions: CellActions, sessionId: string, id: string, entry: LiveNote | null): void {
  const key = entry ? JSON.stringify(entry) : ''
  useEffect(() => {
    if (!key) return undefined
    actions.noteLive(sessionId, id, JSON.parse(key))
    return () => actions.noteLive(sessionId, id, null)
  }, [sessionId, id, key])
}

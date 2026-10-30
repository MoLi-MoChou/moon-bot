// Sidebar row hooks, work phrases, and list-order helpers.
import { STORAGE } from './storage.ts'
import { createElement as h, useEffect, useLayoutEffect, useRef } from 'react'
import { PinMarkIcon } from './icons.tsx'
import { Shimmer, workPhrase } from './cells.ts'
import { reducedMotion, SPRING_ROW_GLIDE } from './motion.tsx'
import { t } from './i18n.ts'
import type { ReactNode, RefObject } from 'react'
import type {
  TSidebarActions,
  TSidebarDoing,
  TSidebarDoingRow,
  TSidebarEntry,
  TSidebarHook,
  TSidebarRoster,
  TSidebarWaits,
  TSidebarWork,
} from './sidebar-types.js'
export function useMarkedUnread(
  id: string,
  active: boolean,
  marked: boolean | undefined,
  actions: Pick<TSidebarActions, 'clearUnread'>,
): void {
  useEffect(() => {
    if (active && marked) actions.clearUnread(id)
  }, [active, marked])
}
export const PinMark = () => (
  <span className='bt-pin' aria-hidden>
    <PinMarkIcon />
  </span>
)
// Whether an approval waits for the user: for a Bot, in any of its Sessions; for a group,
// from any of its members there.
export const useApproval = (
  useWork: TSidebarHook<TSidebarWork> | undefined,
  match: (entry: { readonly botId?: string | undefined; readonly roomId?: string | undefined }) => boolean,
): boolean => (useWork ? useWork(work => (work.approvals ?? []).some(match)) : false)
// Work running in group Sessions, as "botId|tool" keys so a row redraws only when it
// changes: the groups one Bot works in, or the members at work in one group.
// Picked as text, so a row redraws only when what it shows changes.
export const useGroupWork = (
  useWork: TSidebarHook<TSidebarWork> | undefined,
  pick: (rooms: Record<string, readonly TSidebarDoing[]>) => unknown,
): string => (useWork ? useWork(work => JSON.stringify(pick(work.rooms ?? {}))) : '[]')
export const workKeys = <T,>(text: string): T => JSON.parse(text) as T
export const doingOf = ({ tool, said, note, target, switching }: TSidebarDoing): TSidebarDoingRow => ({
  tool,
  said,
  note,
  target,
  switching,
})
/** The Bot a room row leads with, and its working line; an idle room has neither. */
export const roomLead = (
  members: readonly TSidebarDoingRow[],
  roster: TSidebarRoster,
): {
  readonly lead?: TSidebarDoingRow
  readonly first?: { readonly name: string }
  readonly line: ReactNode | null
} => {
  const lead = members[0]
  const first = lead?.id === undefined ? undefined : roster.byId[lead.id]
  return {
    ...(lead === undefined ? {} : { lead }),
    ...(first === undefined ? {} : { first }),
    line: lead === undefined || first === undefined ? null : workLine(first.name, lead, members.length - 1),
  }
}
export const workLine = (lead: string, doing: TSidebarDoingRow, more: number): ReactNode => (
  <Shimmer>{`${lead} · ${workPhrase(doing)}…${more > 0 ? ` +${more}` : ''}`}</Shimmer>
)
// The Bots and groups a Bot waits for (handoffs.ts), by the names they have now.
export const waitingFor = (roster: TSidebarRoster, waits: TSidebarWaits | null): string => {
  const names = [
    ...(waits?.bots ?? []).map(id => roster.byId[id]?.name),
    ...(waits?.rooms ?? []).map(id => roster.roomsById[id]?.name),
  ].filter(Boolean)
  return names.length === 0 ? '' : t('Waiting for {names}', { names: names.join(t(' and ')) })
}
export function useListGlide(listRef: RefObject<HTMLDivElement | null>, layout: boolean, key: string): void {
  const tops = useRef({ layout, map: new Map() })
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const next = new Map()
    const still = reducedMotion() || tops.current.layout !== layout
    for (const row of list.querySelectorAll<HTMLElement>('[data-bot-id],[data-room-id],[data-agent-id]')) {
      const id = row.dataset.botId ?? row.dataset.roomId ?? row.dataset.agentId
      // offsetTop ignores transforms, so a glide in flight does not skew the next one.
      const top = row.offsetTop
      next.set(id, top)
      const before = tops.current.map.get(id)
      if (!still && before !== undefined && Math.abs(before - top) > 0.5) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], SPRING_ROW_GLIDE)
      }
    }
    tops.current = { layout, map: next }
  }, [layout, key])
}
// Moon Bot: the list sorts by recent activity until the user drags a row; then the
// dragged order holds (pinned rows still first, new rows on top). Saved per browser.
export const readOrder = (): string[] | null => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE.sidebarOrder) ?? 'null') as unknown
    return Array.isArray(value) ? (value as string[]) : null
  } catch {
    return null
  }
}
export const saveOrder = (ids: readonly string[]): void => {
  try {
    localStorage.setItem(STORAGE.sidebarOrder, JSON.stringify(ids))
  } catch {}
}
export function manualSort(entries: readonly TSidebarEntry[], manual: readonly string[] | null): TSidebarEntry[] {
  if (!manual) return [...entries]
  const index = new Map(manual.map((id, at) => [id, at] as const))
  return [...entries].sort(
    (a, b) =>
      Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned)) ||
      (index.get(a.item.id) ?? -1) - (index.get(b.item.id) ?? -1),
  )
}

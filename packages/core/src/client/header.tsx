import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { currentPart, latestMemoryChange } from './text.ts'
import { MemoryIcon, SidePanelIcon } from './icons.tsx'
import { botState, BotAvatar, RoomAvatar } from './mark.tsx'
import type { BotAvatarProps } from './mark.tsx'
import { ActivityIndicator } from './activity-row.tsx'
import { clockLabel, openingTurn, unseenSince } from './cells.ts'
import { NewMessagePills } from './header-pills.tsx'
import type { SessionsState, StoreHook, TurnClockState, UiState } from './header-pills.tsx'
export { OFF_BOTTOM_PX, followBottom, isOffBottom, scrollToBottom } from './header-pills.tsx'
import { t } from './i18n.ts'
// -------------------------------------------------------------------------
// Conversation header
/** A group as the header reads it: the faces its avatar seats, and the labels it shows. */
interface HeaderRoom {
  readonly id?: string | undefined
  readonly name?: string | undefined
  readonly members: readonly string[]
}
type HeaderBot = NonNullable<BotAvatarProps['bot']> & {
  readonly name?: string | undefined
}
interface HeaderRoster {
  readonly byId: Readonly<Record<string, HeaderBot | undefined>>
  readonly roomsById: Readonly<Record<string, HeaderRoom | undefined>>
  readonly exchangeTurns?: Readonly<Record<string, readonly number[] | undefined>> | undefined
  readonly memory?: boolean | undefined
  readonly questions?: Readonly<Record<string, unknown>> | undefined
}
/** When this window first saw a Bot's latest memory change. */
interface MemoryNewsEntry {
  readonly at?: number | undefined
  readonly seen?: number | undefined
}
type MemoryNewsState = Readonly<Record<string, MemoryNewsEntry | undefined>>
interface SessionSnapshot {
  readonly pendingSubmissions?:
    | readonly {
        readonly placement?: string | undefined
        readonly time: number
      }[]
    | undefined
}
/** The props the activity row takes: the header forwards the same hooks it was given. */
type ActivityProps = Parameters<typeof ActivityIndicator>[0]
export interface HeaderActions {
  beginVisit(sessionId: string): void
  endVisit(sessionId: string): void
  openMemory(id: string): void
  toggleDetails(sessionId: string): void
  clearLive(sessionId: string): void
  hasRightSidebar?(): boolean
  toggleRightSidebar?(): void
}
export interface HeaderPillProps {
  sessionId: string
  useRoster: StoreHook<HeaderRoster>
  useSessions: StoreHook<SessionsState>
  useSessionStatus: StoreHook<
    ReadonlyMap<
      string,
      {
        readonly running?: boolean | undefined
      }
    >
  >
  useSession: StoreHook<SessionSnapshot | null | undefined>
  useActivity: StoreHook<Readonly<Record<string, string | undefined>>>
  useMemoryNews?: StoreHook<MemoryNewsState> | undefined
  useTurnClock: StoreHook<TurnClockState>
  useUi: StoreHook<UiState>
  useLive?: ActivityProps['useLive']
  useWork?: ActivityProps['useWork']
  useStore?:
    | StoreHook<{
        readonly view?: string | undefined
      }>
    | undefined
  useConversationViews?:
    | StoreHook<
        readonly {
          readonly id: string
        }[]
      >
    | undefined
  selectView?: ((id: string) => void) | undefined
  actions: HeaderActions
}
// The pill's tail: a → that springs in on hover, flipping to ← while details are open.
const GoArrow = () => (
  <svg
    width={14}
    height={14}
    viewBox='-12 -12 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2.2}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d='M-7 0H7M2 -5L7 0L2 5' />
  </svg>
)
// How long the pill says "Memory updated" after the change reaches this window.
const MEMORY_NOTICE_MS = 3200
const noNews: StoreHook<MemoryNewsState> = select => select({})
// True while the latest memory change of the Bots in this conversation is news.
function useMemoryNotice(ids: readonly string[], useMemoryNews: StoreHook<MemoryNewsState>): boolean {
  const seen = useMemoryNews(map => Math.max(0, ...ids.map(id => map?.[id]?.seen ?? 0)))
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const left = seen + MEMORY_NOTICE_MS - Date.now()
    setShown(seen > 0 && left > 0)
    if (seen === 0 || left <= 0) return undefined
    const timer = setTimeout(() => setShown(false), left)
    return () => clearTimeout(timer)
  }, [seen])
  return shown
}
// The notice the pill stretches to show. Its width is measured, so the pill's spring
// runs between two real widths.
function MemoryNotice({ shown }: { readonly shown: boolean }) {
  const inner = useRef<HTMLSpanElement | null>(null)
  const [width, setWidth] = useState(0)
  const label = t('Memory updated')
  useLayoutEffect(() => {
    if (shown) setWidth(inner.current?.scrollWidth ?? 0)
  }, [label, shown])
  return (
    <span className='bt-pill-mem' aria-hidden style={{ '--bt-mem-w': `${width}px` }}>
      <span className='bt-pill-mem-in' ref={inner}>
        <span className='bt-pill-mem-ico'>
          <MemoryIcon />
        </span>
        {label}
      </span>
    </span>
  )
}
export function HeaderPill({
  sessionId,
  useRoster,
  useSessions,
  useSessionStatus,
  useSession,
  useActivity,
  useMemoryNews,
  useTurnClock,
  useUi,
  useLive,
  useWork,
  useStore,
  useConversationViews,
  selectView,
  actions,
}: HeaderPillProps) {
  const roster = useRoster(value => value)
  const selectedView = useStore?.(state => state.view)
  const away =
    useConversationViews?.(views => views.some(view => view.id === selectedView && view.id !== 'chat')) === true &&
    typeof selectView === 'function'
  const title = useSessions(list => list.byId[sessionId]?.displayTitle ?? list.byId[sessionId]?.title ?? '')
  const firstTurns = useSessions(list => {
    const outline =
      list.projectionsBySession?.[sessionId]?.values?.turnOutline ?? list.byId[sessionId]?.projectionValues?.turnOutline
    return Array.isArray(outline)
      ? outline
          .slice(0, 8)
          .map((entry: { readonly turn: number }) => entry.turn)
          .join(',')
      : ''
  })
  const hiddenTurns = roster.exchangeTurns?.[sessionId]
  const visit = useUi(state => state.visits?.[sessionId])
  // The opening separator has no turn before it, so the transcript column draws it,
  // unless the opening is unread: then the first trigger draws it under the divider.
  const opening = useTurnClock(state => {
    const first = openingTurn(state[sessionId], firstTurns, hiddenTurns)
    return first && !unseenSince(visit, first.start) ? clockLabel(first.start) : ''
  })
  useEffect(() => {
    if (opening) document.body.style.setProperty('--bt-first-sep', JSON.stringify(opening))
    else document.body.style.removeProperty('--bt-first-sep')
    return () => {
      document.body.style.removeProperty('--bt-first-sep')
    }
  }, [opening])
  const running = useSessionStatus(map => map.get(sessionId)?.running === true)
  const owner = roster.byId[sessionId]?.id ?? sessionId
  const doing = useActivity(map => map[owner])
  const bot = roster.byId[sessionId]
  const room = roster.roomsById[sessionId]
  const detailsOpen = useUi(state => state.details === sessionId)
  const name = bot?.name ?? room?.name ?? ''
  const useNews = useMemoryNews ?? noNews
  const memoryIds = bot ? [bot.id ?? sessionId] : room ? [room.id ?? sessionId, ...room.members] : []
  const notice = useMemoryNotice(memoryIds, useNews)
  // While the notice shows, the pill opens the memory that changed: a Bot's, or the group's.
  const changed = useNews(map => latestMemoryChange(map, memoryIds))
  // The composer placeholder is not localizable per Session, so CSS reads it from here.
  useEffect(() => {
    document.body.style.setProperty(
      '--bt-placeholder',
      JSON.stringify(name ? t('Message {name}', { name }) : t('Message')),
    )
  }, [name, t('Message')])
  useEffect(() => {
    actions.beginVisit(sessionId)
    return () => actions.endVisit(sessionId)
  }, [sessionId])
  // Group chats have no voice mode, so the composer CSS needs to know the Session kind.
  useEffect(() => {
    if (room) document.body.dataset.btRoom = ''
    else delete document.body.dataset.btRoom
    return () => {
      delete document.body.dataset.btRoom
    }
  }, [Boolean(room)])
  const memoryNotice = !away && notice && changed !== null && roster.memory !== false
  return (
    <div className='bt-head'>
      <button
        type='button'
        className='bt-pill'
        aria-expanded={away ? undefined : detailsOpen}
        data-memory={memoryNotice ? 'updated' : undefined}
        aria-label={
          away
            ? t('Back to chat')
            : memoryNotice && changed !== null
              ? t("Memory updated. Open {name}'s memory", { name: roster.byId[changed]?.name ?? name })
              : t('View conversation details')
        }
        title={away ? name : undefined}
        onClick={() =>
          away && selectView
            ? selectView('chat')
            : memoryNotice && changed !== null
              ? actions.openMemory(changed)
              : actions.toggleDetails(sessionId)
        }>
        {bot ? (
          <BotAvatar
            bot={bot}
            size={24}
            state={botState(running, doing, roster.questions?.[currentPart(bot)] !== undefined)}
            badge={false}
          />
        ) : room ? (
          <RoomAvatar room={room} roster={roster} size={24} />
        ) : null}
        <span className='bt-pill-name'>
          {away ? t('Back to chat') : (bot?.name ?? room?.name ?? (title || t('New chat')))}
        </span>
        <MemoryNotice shown={memoryNotice} />
        <span className='bt-pill-go' aria-hidden>
          <GoArrow />
        </span>
      </button>
      <span className='bt-sr' role='status'>
        {memoryNotice ? t('Memory updated') : ''}
      </span>
      {h(NewMessagePills, { key: sessionId, sessionId, useSessions, useUi, useTurnClock })}
      {h(ActivityIndicator, {
        key: `activity:${sessionId}`,
        sessionId,
        useRoster,
        useSessionStatus,
        useSession,
        actions,
        ...(useLive === undefined ? {} : { useLive }),
        ...(useWork === undefined ? {} : { useWork }),
      })}
      {
        // the host's way into its right sidebar sits in the session header this pill replaces.
        actions.hasRightSidebar?.() ? (
          <button
            type='button'
            className='bt-icon-btn bt-head-side'
            data-bt-right-sidebar=''
            aria-label={t('Show or hide the right sidebar')}
            title={t('Right sidebar')}
            onClick={() => actions.toggleRightSidebar?.()}>
            <SidePanelIcon />
          </button>
        ) : null
      }
    </div>
  )
}

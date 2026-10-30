// Sidebar Bot and room rows.
import { createElement as h } from 'react'
import { isMainOf } from './sources.ts'
import { currentPart, previewOf } from './text.ts'
import { botState, BotAvatar, RoomAvatar } from './mark.tsx'
import { t } from './i18n.ts'
import type { TSidebarBot, TSidebarDoingRow, TSidebarRoom, TSidebarRowProps, TSidebarWaits } from './sidebar-types.js'
import {
  PinMark,
  doingOf,
  roomLead,
  useApproval,
  useGroupWork,
  useMarkedUnread,
  waitingFor,
  workKeys,
  workLine,
} from './sidebar-rows-helpers.tsx'

export function BotRow({
  bot,
  roster,
  actions,
  useSessions,
  useSessionStatus,
  useSessionRetainInfo,
  useActivity,
  useWork,
  wide,
  marked,
}: TSidebarRowProps & {
  readonly bot: TSidebarBot
  readonly marked: boolean | undefined
}) {
  const id = bot.id
  const part = currentPart(bot)
  const preview = useSessions(list => previewOf(list as never, part, roster.exchangeTurns[part]))
  const running = useSessionStatus(map => map.get(part)?.running === true)
  const active = useSessionRetainInfo(part, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const unread =
    useSessionStatus(
      map => map.get(part)?.completionUnread === true || map.get(part)?.pendingInteraction !== undefined,
    ) ||
    (marked === true && !active)
  useMarkedUnread(id, active, marked, actions)
  const main = isMainOf(roster as never, id)
  const tile = roster.mainBotId === id
  const approval = useApproval(useWork, entry => entry.botId === id)
  const alert = roster.questions?.[part] !== undefined || approval
  const doing = useActivity(map => map[id])
  // Work in a group runs in a Session of its own, so the Bot's chat stays idle meanwhile.
  const groups = workKeys<TSidebarDoingRow[]>(
    useGroupWork(useWork, rooms =>
      Object.entries(rooms).flatMap(([roomId, entries]) =>
        entries.filter(entry => entry.botId === id).map(entry => ({ id: roomId, ...doingOf(entry) })),
      ),
    ),
  )
  const away = !running && groups.length > 0
  const state = botState(running || away, doing, alert)
  const lead = groups[0] as TSidebarDoingRow
  const awayLine = away
    ? workLine(
        (lead.id === undefined ? undefined : roster.roomsById[lead.id]?.name) ?? t('a group chat'),
        lead,
        groups.length - 1,
      )
    : null
  const waits = workKeys<TSidebarWaits | null>(
    useWork ? useWork(work => JSON.stringify(work.waiting?.[id] ?? null)) : 'null',
  )
  const waitsFor = state === 'waiting' ? waitingFor(roster, waits) : ''
  if (bot.hidden && !active && !main) return null
  const onContextMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    actions.openMenu({ kind: 'bot', id, x: event.clientX, y: event.clientY })
  }
  const pinned = bot.pinned === true && !tile
  const label = [
    bot.name,
    main ? t('Main Bot') : '',
    pinned ? t('Pinned') : '',
    running || away ? t('Working') : '',
    waitsFor,
    approval ? t('Waiting for your approval') : alert ? t('Waiting for your answer') : '',
    unread ? t('Unread activity') : '',
  ]
    .filter(Boolean)
    .join(', ')
  if (tile && wide) {
    return (
      <div className='bt-tile-wrap'>
        <button
          type='button'
          className={running || away ? 'bt-tile bt-busy' : 'bt-tile'}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          data-bot-id={id}
          title={preview || bot.name}
          onClick={() => actions.openSession(id)}
          onContextMenu={onContextMenu}>
          <BotAvatar bot={bot} size={60} state={state} main />
          <span className='bt-tile-name'>{bot.name}</span>
          {running || away ? (
            <span className='bt-tile-busy' aria-hidden>
              <span className='bt-dots'>
                <i />
                <i />
                <i />
              </span>
              {t('Working')}
            </span>
          ) : bot.role ? (
            <span className='bt-chip bt-tile-role'>{bot.role}</span>
          ) : null}
        </button>
      </div>
    )
  }
  return (
    <button
      type='button'
      className={running || away ? 'bt-row bt-busy' : 'bt-row'}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-bot-id={id}
      title={wide ? undefined : bot.name}
      onClick={() => actions.openSession(id)}
      onContextMenu={onContextMenu}>
      <BotAvatar bot={bot} size={36} state={state} main={main} />
      {pinned && !wide ? <PinMark /> : null}
      {wide ? (
        <span className='bt-row-body'>
          <span className='bt-row-name'>
            <span className='bt-row-title'>{bot.name}</span>
            {pinned ? <PinMark /> : null}
          </span>
          {awayLine ? (
            <span className='bt-row-preview'>{awayLine}</span>
          ) : running ? (
            <span className='bt-row-preview bt-row-busy'>
              <span className='bt-dots' aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {t('Working')}
            </span>
          ) : waitsFor ? (
            <span className='bt-row-preview'>{waitsFor}</span>
          ) : preview ? (
            <span className='bt-row-preview'>{preview}</span>
          ) : null}
        </span>
      ) : null}
      {wide && unread && !active ? <span className='bt-unread' aria-hidden /> : null}
    </button>
  )
}
export function RoomRow({
  room,
  roster,
  actions,
  useSessions,
  useSessionStatus,
  useSessionRetainInfo,
  useWork,
  wide,
  marked,
}: Omit<TSidebarRowProps, 'useUi' | 'useActivity'> & {
  readonly room: TSidebarRoom
  readonly marked: boolean | undefined
}) {
  const id = room.id
  const fallback = useSessions(list => previewOf(list as never, id))
  const preview = room.preview?.replace(/\s+/g, ' ').trim() || fallback
  const active = useSessionRetainInfo(id, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const unread = useSessionStatus(map => map.get(id)?.completionUnread === true) || (marked === true && !active)
  useMarkedUnread(id, active, marked, actions)
  const approval = useApproval(useWork, entry => entry.roomId === id)
  const members = workKeys<TSidebarDoingRow[]>(
    useGroupWork(useWork, rooms => (rooms[id] ?? []).map(entry => ({ id: entry.botId, ...doingOf(entry) }))),
  )
  // A room with nobody working has no members: the row still draws, just without a line.
  const working = roomLead(members, roster)
  const workingLine = working.line
  if (room.hidden && !active) return null
  const pinned = room.pinned === true
  const label = [
    room.name,
    pinned ? t('Pinned') : '',
    members.length > 0 ? t('Working') : '',
    approval ? t('Waiting for your approval') : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type='button'
      className={members.length > 0 ? 'bt-row bt-busy' : 'bt-row'}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-room-id={id}
      onClick={() => actions.openSession(id)}
      onContextMenu={event => {
        event.preventDefault()
        actions.openMenu({ kind: 'room', id, x: event.clientX, y: event.clientY })
      }}>
      <RoomAvatar room={room} roster={roster} size={36} />
      {pinned && !wide ? <PinMark /> : null}
      {wide ? (
        <span className='bt-row-body'>
          <span className='bt-row-name'>
            <span className='bt-row-title'>{room.name}</span>
            {pinned ? <PinMark /> : null}
          </span>
          {workingLine ? (
            <span className='bt-row-preview'>{workingLine}</span>
          ) : preview ? (
            <span className='bt-row-preview'>{preview}</span>
          ) : null}
        </span>
      ) : null}
      {wide && approval && !active ? (
        <span className='bt-unread bt-unread-wait' aria-hidden />
      ) : wide && unread && !active ? (
        <span className='bt-unread' aria-hidden />
      ) : null}
    </button>
  )
}
// One expanded Agent Session row: title, relative stamp, rename field, and a
// context menu for rename/archive.
/** One Session of the Agent, as its row draws it. */

// Team sidebar: the Bot list, reorder, update chip, and plugin prompts.
import { framerMotion } from './vendor/framer-motion.js'
import { Fragment, type Ref, createElement as h, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { currentPart } from './text.ts'
import { PlusIcon, SearchIcon, SidebarIcon, TasksIcon } from './icons.tsx'
import { PeopleIcon } from './icons.tsx'
import { EmptyState } from 'moon-bot-ui'
import { hostText, t } from './i18n.ts'
import type { ReactNode } from 'react'
import type { TSidebarActions, TSidebarEntry, TSidebarProps } from './sidebar-types.js'
import { AgentRow, BotRow, RoomRow, manualSort, readOrder, saveOrder, useListGlide } from './sidebar-rows.tsx'
import { BrandMark, BrandName, useLandOnMainBot } from './sidebar-account.tsx'
import { TasksPopover } from './tasks-popover.tsx'
import { UpdateButton } from './sidebar-update.tsx'
export { UpdateButton } from './sidebar-update.tsx'
export { ConnectPlugins, YouAvatar } from './sidebar-extras.tsx'
export function TeamSidebar(props: TSidebarProps) {
  const { wide, expandSidebar, useRoster, useUi, useSessions, actions } = props
  const listRef = useRef<HTMLDivElement | null>(null)
  const closing = useRef(false)
  useLayoutEffect(() => {
    closing.current = false
  })
  const roster = useRoster(value => value)
  const markedUnread = useUi(value => value.unread)
  props.useRegistry(value => value)
  // The task panel is the sidebar's own popover. None of the views' `ui` state grew an
  // overlay key for it: this state is the button's, so the sidebar owns it.
  const [tasksOpen, setTasksOpen] = useState(false)
  const tasksButton = useRef<HTMLButtonElement | null>(null)
  const closeTasks = (): void => {
    setTasksOpen(false)
    tasksButton.current?.focus()
  }
  const updated = useSessions(list => {
    const stamps: Record<string, number> = {}
    for (const id of list.ids) stamps[id] = list.byId[id]?.updatedAt ?? 0
    return JSON.stringify(stamps)
  })
  const order = useMemo(() => {
    const stamps = JSON.parse(updated) as Record<string, number>
    const entries: TSidebarEntry[] = [
      ...roster.bots
        .filter(bot => bot.id !== roster.mainBotId)
        .map(bot => ({ kind: 'bot' as const, item: bot, at: (stamps[currentPart(bot)] ?? bot.createdAt) as number })),
      ...roster.rooms
        .filter(room => typeof room.archivedAt !== 'number')
        .map(room => ({ kind: 'room' as const, item: room, at: (stamps[room.id] ?? room.createdAt) as number })),
      // The Agent sorts by its most recent Session, falling back to when it was added.
      ...(roster.agents ?? []).map(agent => ({
        kind: 'agent' as const,
        item: agent,
        at: (Math.max(0, ...agent.sessions.map(id => stamps[id] ?? 0)) || agent.createdAt) as number,
      })),
    ]
    return entries.sort((a, b) => Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned)) || b.at - a.at)
  }, [roster, updated])
  const [manual, setManual] = useState<string[] | null>(readOrder)
  const shown = useMemo(() => manualSort(order, manual), [order, manual])
  const dragging = useRef(false)
  const reorder = (ids: string[]): void => {
    dragging.current = true
    setManual(ids)
  }
  const dropped = (): void => {
    saveOrder(shown.map(entry => entry.item.id))
    setTimeout(() => {
      dragging.current = false
    }, 0)
  }
  const main = roster.mainBotId === undefined ? undefined : roster.byId[roster.mainBotId]
  const archived = roster.rooms.filter(room => typeof room.archivedAt === 'number')
  useListGlide(listRef, wide && !dragging.current, shown.map(entry => entry.item.id).join(','))
  useLandOnMainBot(roster, useSessions, actions)
  // The shell keeps wide content during its collapse fade. Normalize through its
  // public expansion action before toggling; coalesce synchronous activations
  // until React commits the result.
  const navigate = (open: (id: string) => unknown, id: string): unknown => {
    const result = open(id)
    if (wide && window.innerWidth < 1024 && !closing.current) {
      closing.current = true
      expandSidebar?.()
      actions.toggleSidebar()
    }
    return result
  }
  const rowActions: TSidebarActions = {
    ...actions,
    // The value the open call returns reaches the row, as it did before.
    openSession: id => navigate(actions.openSession, id),
    openAgent: id => navigate(actions.openAgent, id),
    openAgentSession: id => navigate(actions.openAgentSession, id),
    newAgentSession: id => navigate(actions.newAgentSession, id) as Promise<unknown>,
  }
  const rowProps = {
    roster,
    actions: rowActions,
    useSessions,
    useUi,
    useSessionStatus: props.useSessionStatus,
    useSessionRetainInfo: props.useSessionRetainInfo,
    useActivity: props.useActivity,
    useWork: props.useWork,
    wide,
  }
  // Typing while the sidebar has focus starts a search.
  const typeToSearch = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.defaultPrevented ||
      event.key.length !== 1 ||
      event.key === ' ' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable]')) return
    event.preventDefault()
    actions.openPalette(event.key)
  }
  return (
    <div className={wide ? 'bt-side' : 'bt-side bt-rail'} onKeyDown={typeToSearch}>
      {wide ? (
        <div className='bt-side-top'>
          <span className='bt-brand'>
            <BrandMark size={22} />
            <BrandName />
          </span>
          <UpdateButton useUpdate={props.useUpdate} actions={actions} />
          <button
            type='button'
            className='bt-round'
            aria-label={t('Search')}
            title={t('Search')}
            onClick={() => actions.openPalette()}>
            <SearchIcon />
          </button>
          <button
            ref={tasksButton}
            type='button'
            className='bt-round'
            aria-label={t('Tasks')}
            title={t('Tasks')}
            aria-haspopup='dialog'
            aria-expanded={tasksOpen}
            onClick={() => setTasksOpen(true)}>
            <TasksIcon />
          </button>
          <button
            type='button'
            className='bt-round'
            aria-label={t('New…')}
            title={t('New…')}
            onClick={() => actions.openNewChat('new')}>
            <PlusIcon />
          </button>
          <button
            type='button'
            className='bt-round bt-side-collapse'
            aria-label={t('Collapse sidebar')}
            title={t('Collapse sidebar')}
            onClick={() => actions.toggleSidebar()}>
            <SidebarIcon />
          </button>
        </div>
      ) : (
        <>
          <UpdateButton useUpdate={props.useUpdate} actions={actions} />
          <button
            ref={tasksButton}
            type='button'
            className='bt-round'
            aria-label={t('Tasks')}
            title={t('Tasks')}
            aria-haspopup='dialog'
            aria-expanded={tasksOpen}
            onClick={() => setTasksOpen(true)}>
            <TasksIcon />
          </button>
          <button
            type='button'
            className='bt-round'
            aria-label={t('New…')}
            title={t('New…')}
            onClick={() => actions.openNewChat('new')}>
            <PlusIcon />
          </button>
        </>
      )}
      {wide && roster.readOnly ? (
        <div className='bt-hint bt-read-only' role='status'>
          {hostText(roster.readOnly as string)}
        </div>
      ) : null}
      <div ref={listRef as Ref<HTMLDivElement>} className='bt-list' role='region' aria-label={t('Bot list')}>
        {main ? (
          <BotRow {...rowProps} bot={main} marked={markedUnread[main.id] === true} />
        ) : roster.ready ? null : (
          <div className='bt-hint'>{t('Setting up your Main Bot…')}</div>
        )}
        <ReorderList
          shown={shown}
          wide={wide}
          reorder={reorder}
          dropped={dropped}
          dragging={dragging}
          render={entry =>
            entry.kind === 'bot' ? (
              <BotRow {...rowProps} bot={entry.item} marked={markedUnread[entry.item.id] === true} />
            ) : entry.kind === 'room' ? (
              <RoomRow {...rowProps} room={entry.item} marked={markedUnread[entry.item.id] === true} />
            ) : (
              <AgentRow {...rowProps} agent={entry.item} marked={markedUnread[entry.item.id] === true} />
            )
          }
        />
        {wide && roster.ready && shown.length === 0 ? (
          <div className='bt-side-empty'>
            <EmptyState
              compact
              icon={<PeopleIcon />}
              title={t('Build your Bot team')}
              hint={t(
                'Each Bot has its own chat, instructions and memory. Create one, or ask your Main Bot to set one up.',
              )}
              action={{ icon: <PlusIcon />, label: t('Create Bot'), onClick: () => actions.openNewChat('create') }}
            />
          </div>
        ) : null}
      </div>
      {wide && archived.length > 0 ? (
        <div className='bt-side-archived'>
          <div className='bt-hint'>{t('Archived')}</div>
          {archived.map(room => (
            <RoomRow key={room.id} {...rowProps} room={room} marked={markedUnread[room.id] === true} />
          ))}
        </div>
      ) : null}
      {tasksOpen
        ? createPortal(
            <TasksPopover
              taskActions={actions}
              onOpenSession={id => {
                setTasksOpen(false)
                navigate(actions.openSession, id)
              }}
              onClose={closeTasks}
            />,
            document.body,
          )
        : null}
    </div>
  )
}
export function ReorderList({
  shown,
  wide,
  reorder,
  dropped,
  dragging,
  render,
}: {
  readonly shown: readonly TSidebarEntry[]
  readonly wide: boolean
  readonly reorder: (ids: string[]) => void
  readonly dropped: () => void
  readonly dragging: {
    current: boolean
  }
  readonly render: (entry: TSidebarEntry) => ReactNode
}) {
  const Reorder = framerMotion()?.Reorder
  if (!Reorder)
    return (
      <>
        {shown.map(entry => (
          <>{render(entry)}</>
        ))}
      </>
    )
  return (
    <Reorder.Group
      as='div'
      axis='y'
      values={shown.map(entry => entry.item.id)}
      onReorder={reorder}
      className='bt-reorder'>
      {shown.map(entry => (
        <Reorder.Item
          key={entry.item.id}
          value={entry.item.id}
          as='div'
          className='bt-reorder-item'
          dragListener={wide}
          onDragEnd={dropped}
          whileDrag={{ scale: 1.02, boxShadow: '0 6px 18px rgba(0,0,0,.12)', zIndex: 5 }}
          onClickCapture={(event: React.MouseEvent) => {
            if (dragging.current) {
              event.stopPropagation()
              event.preventDefault()
            }
          }}>
          {render(entry)}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  )
}
// The update button at the sidebar's top right: a cloud while a newer DS Bot —
// or a newer verified the host — is available, then the install's progress and
// result. Its card has one row each for the bot and the host, with their versions,
// the release notes link, and each row's own button.
export {
  AccountLauncher,
  FooterAccount,
  BotReturn,
  BrandMark,
  BrandName,
  holdShellShortcuts,
  openShellSettingsPanel,
  openShellOnboardingPanel,
} from './sidebar-account.tsx'
export { SIDEBAR_CSS, RETURN_CSS } from './sidebar-css.ts'

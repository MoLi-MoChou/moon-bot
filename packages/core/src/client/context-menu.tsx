import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { isMainOf } from './sources.ts'
import { currentPart } from './text.ts'
import {
  GearIcon,
  PinIcon,
  UnreadIcon,
  PencilIcon,
  StarLineIcon,
  CopyIcon,
  HideIcon,
  TrashIcon,
  DuplicateIcon,
} from './icons.tsx'
import { useEscape, useMenuKeys } from './overlay-hooks.ts'
import { t } from './i18n.ts'
// The thing a menu was opened on: a Bot or room by id, or an Agent row (whose
// Session menus carry the Agent id beside the Session id).
export interface ContextMenuTarget {
  kind?: string
  id: string
  x: number
  y: number
  agentId?: string
}
interface MenuBot {
  id: string
  name: string
  pinned?: boolean
}
interface MenuRoom {
  id: string
  name: string
  pinned?: boolean
}
interface MenuAgent {
  id: string
  pinned?: boolean
}
export interface ContextRoster {
  byId: Record<string, MenuBot | undefined>
  roomsById: Record<string, MenuRoom | undefined>
  agentsById: Record<string, MenuAgent | undefined>
  mainBotId?: string | null
  mainBotIds?: readonly string[]
}
export interface ContextMenuActions {
  closeMenu: () => void
  setFlags: (
    id: string,
    flags: {
      pinned?: boolean
      hidden?: boolean
    },
  ) => void
  markUnread: (id: string) => void
  renameBot: (id: string) => void
  openSettings: (page: string, id: string) => void
  duplicateBot: (id: string) => Promise<{
    id: string
  }>
  openSession: (id: string) => void
  setMain: (id: string, main: boolean) => void
  deleteBot: (id: string) => void
  deleteRoom: (id: string) => void
  reportError: (error: unknown, where: string) => void
  removeAgent: (id: string) => void
  beginAgentRename: (id: string) => void
  archiveAgentSession: (agentId: string, sessionId: string) => void
}
// label, glyph, what it does, and whether it is the destructive entry.
type MenuItem = readonly [label: string, Icon: () => ReactElement, run: () => unknown, danger?: boolean]
export function ContextMenu({
  menu,
  roster,
  actions,
  leaving = false,
}: {
  menu: ContextMenuTarget
  roster: ContextRoster
  actions: ContextMenuActions
  leaving?: boolean
}) {
  useEscape(() => actions.closeMenu())
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.bt-menu')) actions.closeMenu()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeys(ref, !leaving)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPlace({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)),
    })
  }, [menu.x, menu.y])
  if (menu.kind === 'agent' || menu.kind === 'agent-session')
    return <AgentMenu menu={menu} roster={roster} actions={actions} leaving={leaving} />
  const bot = roster.byId[menu.id]
  const room = roster.roomsById[menu.id]
  const entry = bot ?? room
  if (entry === undefined) return null
  const isMainBot = isMainOf(roster, menu.id)
  const isTile = roster.mainBotId === menu.id
  const mainCount = (roster.mainBotIds ?? []).length
  const groups = (
    [
      [
        isTile
          ? null
          : [entry.pinned ? t('Unpin') : t('Pin'), PinIcon, () => actions.setFlags(menu.id, { pinned: !entry.pinned })],
        [t('Mark as Unread'), UnreadIcon, () => actions.markUnread(menu.id)],
      ],
      [
        bot ? [t('Rename Bot'), PencilIcon, () => actions.renameBot(bot.id)] : null,
        bot ? [t('Edit Bot'), GearIcon, () => actions.openSettings('bots', bot.id)] : null,
        room ? [t('Group settings'), GearIcon, () => actions.openSettings('groups', room.id)] : null,
        room ? [t('Rename group'), PencilIcon, () => actions.renameBot(room.id)] : null,
        bot
          ? [
              t('Duplicate'),
              DuplicateIcon,
              async () => {
                const copy = await actions.duplicateBot(bot.id)
                actions.openSession(copy.id)
              },
            ]
          : null,
        bot && !isMainBot ? [t('Make Main Bot'), StarLineIcon, () => actions.setMain(bot.id, true)] : null,
        bot && isMainBot && mainCount > 1
          ? [t('Remove Main Bot role'), StarLineIcon, () => actions.setMain(bot.id, false)]
          : null,
      ],
      [
        [
          t('Copy conversation ID'),
          CopyIcon,
          () => navigator.clipboard?.writeText(bot ? String(currentPart(bot)) : menu.id),
        ],
      ],
      [
        isMainBot ? null : [t('Hide from sidebar'), HideIcon, () => actions.setFlags(menu.id, { hidden: true })],
        isMainBot
          ? null
          : [
              room ? t('Delete group') : t('Delete'),
              TrashIcon,
              () => (bot ? actions.deleteBot(bot.id) : actions.deleteRoom(menu.id)),
              true,
            ],
      ],
    ] as (MenuItem | null)[][]
  )
    .map(group => group.filter((item): item is MenuItem => item !== null))
    .filter(group => group.length > 0)
  return (
    <div
      ref={ref}
      className='bt-menu'
      role='menu'
      aria-label={t('{name} actions', { name: entry.name })}
      style={place}
      data-leaving={leaving || undefined}>
      {groups.map((group, index) => (
        <>
          {index > 0 ? <div className='bt-menu-sep' role='separator' /> : null}
          {group.map(([label, Icon, run, danger]) => (
            <button
              key={label}
              type='button'
              role='menuitem'
              className={danger ? 'bt-danger' : undefined}
              onClick={() => {
                actions.closeMenu()
                void Promise.resolve(run()).catch(error => actions.reportError(error, 'menu'))
              }}>
              {h(Icon)}
              {label}
            </button>
          ))}
        </>
      ))}
    </div>
  )
}
// Menus for the Agent row and its Sessions; none of the Bot entries apply.
function AgentMenu({
  menu,
  roster,
  actions,
  leaving,
}: {
  menu: ContextMenuTarget
  roster: ContextRoster
  actions: ContextMenuActions
  leaving: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeys(ref, !leaving)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPlace({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)),
    })
  }, [menu.x, menu.y])
  const agent = roster.agentsById[menu.kind === 'agent' ? menu.id : (menu.agentId ?? '')]
  if (agent === undefined) return null
  const groups: MenuItem[][] =
    menu.kind === 'agent'
      ? [
          [
            [
              agent.pinned ? t('Unpin') : t('Pin'),
              PinIcon,
              () => actions.setFlags(agent.id, { pinned: !agent.pinned }),
            ],
          ],
          [[t('Remove Agent'), TrashIcon, () => actions.removeAgent(agent.id), true]],
        ]
      : [
          [[t('Rename'), PencilIcon, () => actions.beginAgentRename(menu.id)]],
          [[t('Archive'), TrashIcon, () => actions.archiveAgentSession(agent.id, menu.id), true]],
        ]
  return (
    <div
      ref={ref}
      className='bt-menu'
      role='menu'
      aria-label={menu.kind === 'agent' ? 'Agent' : t('Session actions')}
      style={place}
      data-leaving={leaving || undefined}>
      {groups.map((group, index) => (
        <>
          {index > 0 ? <div className='bt-menu-sep' role='separator' /> : null}
          {group.map(([label, Icon, run, danger]) => (
            <button
              key={label}
              type='button'
              role='menuitem'
              className={danger ? 'bt-danger' : undefined}
              onClick={() => {
                actions.closeMenu()
                void Promise.resolve(run()).catch(error => console.warn('[moon-bot]', error))
              }}>
              {h(Icon)}
              {label}
            </button>
          ))}
        </>
      ))}
    </div>
  )
}

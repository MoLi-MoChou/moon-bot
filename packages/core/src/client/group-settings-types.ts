import { t } from './i18n.ts'

// A member as a group's settings show it.
export interface GroupBot {
  id: string
  name: string
}
// A group chat: the fields its settings read and change.
export interface GroupRoom {
  id: string
  name: string
  named?: boolean
  notice?: string
  admin?: string | null
  mode: string
  members: readonly string[]
  permission?: string | null
  workDir?: string
  pinned?: boolean
  hidden?: boolean
  archivedAt?: number
}
export interface GroupRoster {
  bots: GroupBot[]
  byId: Record<string, GroupBot | undefined>
  mainBotIds?: readonly string[]
  permissions?: {
    options: readonly {
      value: string
      name?: string | undefined
    }[]
    defaultPreset?: string | null
  }
}
export interface GroupActions {
  updateRoom: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  deleteRoom: (id: string) => Promise<unknown>
  archiveRoom?: ((id: string, archived: boolean) => Promise<unknown>) | undefined
  createRoom: (
    members: readonly string[],
    options: Record<string, unknown>,
  ) => Promise<
    | {
        id: string
        name: string
        members: readonly string[]
      }
    | undefined
  >
  setFlags: (id: string, flags: Record<string, boolean>) => Promise<unknown>
  closeSettings: () => void
  openSession: (id: string) => void
}
export type RunWork = (work: Promise<unknown>) => Promise<unknown>
export const ROOM_MODES: readonly (readonly [string, string, string])[] = [
  ['admin', 'Admin leads', 'Plain messages go to the admin, who calls others with @Name.'],
  ['everyone', 'Everyone', 'Every member answers in turn, admin first.'],
]
// Without an admin the host answers as everyone, whatever the stored mode says.
export const shownMode = (room: GroupRoom, roster: GroupRoster): string =>
  room.admin && roster.byId[room.admin] ? room.mode : 'everyone'
export function roomSubtitle(room: GroupRoom, roster: GroupRoster): string {
  const admin = room.admin ? roster.byId[room.admin] : undefined
  return [
    t('{count} members', { count: room.members.length }),
    admin ? t('Admin {name}', { name: admin.name }) : t('No admin'),
  ].join(' · ')
}

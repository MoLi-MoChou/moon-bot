// Group chats: their settings, their members, and the rules for who may change them.
// The user and every Main Bot may change any group; a group's admin may change its own
// group but not delete it. Only a member can be admin.
import { ROOM_MAX_MEMBERS, ROOM_MODES, ROOM_NAME_MAX, ROOM_NOTICE_MAX } from './constants.ts'
import { unquote } from './text.ts'
import type { HostContext } from './host-types.js'
import type { HostRuntime, StoredRoom, StoredState } from './runtime.js'

export interface RoomPatch {
  readonly members?: readonly string[]
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
  readonly admin?: string | null
  readonly mode?: string
  readonly notice?: string
  readonly workDir?: string | null
  readonly permission?: string | null
  readonly name?: string
}

/** A change the settings form asked for, already validated where it can be. */
interface RoomChange {
  readonly members: string[]
  readonly admin: string | null
  readonly name: string | undefined
  readonly notice: string | undefined
  readonly permission: string | null | undefined
}

interface CreateRoomOptions {
  readonly members?: readonly string[]
  readonly name?: string
  readonly notice?: string
  readonly mode?: string
  readonly admin?: string | null
  readonly createdBy?: string
}

interface RosterRoomsOptions {
  readonly ctx: HostContext
  readonly rt: HostRuntime
  readonly state: StoredState
  createSession(title: string, options?: { readonly dir?: string }): Promise<string>
  holdName<T>(kind: 'bot' | 'room', name: string, work: () => Promise<T>): Promise<T>
  isHeld(kind: 'bot' | 'room', name: string): boolean
  saveForDelete(): Promise<unknown | undefined>
}

export interface RosterRooms {
  roomBusy(id: string): boolean
  autoRoomName(members: readonly string[]): string
  cleanRoomName(text: unknown, selfId?: string): string
  retitleRoom(room: StoredRoom): Promise<void>
  followMemberNames(rooms?: readonly StoredRoom[]): Promise<void>
  createRoom(options?: CreateRoomOptions): Promise<StoredRoom>
  updateRoom(id: string, patch: RoomPatch, actorId?: string): Promise<{ readonly room: StoredRoom; readonly changes: readonly string[] }>
  deleteRoom(id: string): Promise<void>
  archiveRoom(id: string, archived: boolean): Promise<StoredRoom>
}

export function createRosterRooms({ ctx, rt, state, createSession, holdName, isHeld, saveForDelete }: RosterRoomsOptions): RosterRooms {
  const roomBusy = (id: string): boolean => [...rt.roomProgress.values()].some(round => round.roomId === id)
  const autoRoomName = (members: readonly string[]): string => ['You', ...members.map(id => rt.botOf(id)?.name).filter((name): name is string => name !== undefined)].join(', ')
  const cleanNotice = (text: unknown): string => String(text ?? '').trim().slice(0, ROOM_NOTICE_MAX)

  const cleanRoomName = (text: unknown, selfId?: string): string => {
    const next = unquote(text).replace(/\s+/g, ' ').slice(0, ROOM_NAME_MAX)
    if (next !== '' && (rt.findRooms(next).some(room => room.id !== selfId) || isHeld('room', next))) throw new Error(`Another group chat is already called "${next}"`)
    return next
  }

  async function retitleRoom(room: StoredRoom): Promise<void> {
    try {
      const agent = await rt.resolveAgent(room.id)
      await ctx.sessionTitle.rename(agent.session, room.name)
    } catch (error) {
      rt.warn('moon-bot: group title for %s not updated: %s', room.name, error)
    }
  }

  // Groups without a chosen name are named after their members, so they follow renames.
  async function followMemberNames(rooms: readonly StoredRoom[] = Object.values(state.rooms)): Promise<void> {
    for (const room of rooms) {
      if (room.named) continue
      const next = autoRoomName(room.members ?? [])
      if (next === room.name) continue
      room.name = next
      await retitleRoom(room)
    }
  }

  function checkMembers(members: readonly string[]): void {
    if (members.length < 2) throw new Error('A group chat needs at least two Bots')
    if (members.length > ROOM_MAX_MEMBERS) throw new Error(`A group chat holds at most ${ROOM_MAX_MEMBERS} Bots`)
  }

  // A Main Bot leads the groups it makes; a group the user makes is led by a Main Bot
  // member when it has one.
  const defaultAdmin = (members: readonly string[], createdBy: string | undefined): string | null =>
    (createdBy !== undefined && members.includes(createdBy) ? createdBy : members.find(rt.isMain) ?? null)

  async function createRoom({ members: memberIds = [], name: roomName, notice, mode, admin, createdBy }: CreateRoomOptions = {}): Promise<StoredRoom> {
    const members = [...new Set(memberIds)].filter(id => rt.botOf(id) !== undefined)
    checkMembers(members)
    const custom = cleanRoomName(roomName ?? '')
    const adminId = admin !== undefined ? admin : defaultAdmin(members, createdBy)
    if (adminId !== null && !members.includes(adminId)) throw new Error('The admin must be a member of the group')
    if (mode !== undefined && !ROOM_MODES.includes(mode)) throw new Error(`Reply mode must be one of ${ROOM_MODES.join(', ')}`)
    return holdName('room', custom, () => buildRoom({ members, custom, ...(notice === undefined ? {} : { notice }), ...(mode === undefined ? {} : { mode }), adminId, ...(createdBy === undefined ? {} : { createdBy }) }))
  }

  async function buildRoom({ members, custom, notice, mode, adminId, createdBy }: {
    readonly members: readonly string[]
    readonly custom: string
    readonly notice?: string
    readonly mode?: string
    readonly adminId: string | null
    readonly createdBy?: string
  }): Promise<StoredRoom> {
    const title = custom || autoRoomName(members)
    // The group's own Session only relays, so it stays in the team workspace; the
    // group's folder is for its members' Sessions.
    const id = await createSession(title)
    try {
      // A member deleted while the Session was made stays out, and the group is checked
      // again as it is written.
      const live = members.filter(member => rt.botOf(member) !== undefined)
      checkMembers(live)
      const lead = adminId === null || live.includes(adminId) ? adminId : defaultAdmin(live, createdBy)
      const name = custom || autoRoomName(live)
      const room: StoredRoom = {
        id,
        name,
        ...(custom ? { named: true } : {}),
        members: live,
        admin: lead,
        mode: mode ?? 'admin',
        notice: cleanNotice(notice),
        createdAt: Date.now(),
        createdBy: createdBy ?? null,
      }
      state.rooms[id] = room
      await rt.save()
      if (name !== title) await retitleRoom(room)
      return room
    } catch (error) {
      // The group's Session was already made: archive it instead of leaving an orphan.
      delete state.rooms[id]
      void rt.save().catch(() => {})
      await ctx.workspaceRegistry.archiveSession(id)
        .catch(archiveError => rt.warn('moon-bot: archiving the Session for %s failed: %s', title, archiveError))
      throw error
    }
  }

  // What a change would write to the group as it is now, or why it cannot be made. It
  // reads only the team, so updateRoom runs it to fail fast and again after its last
  // await: another change or a deleted Bot may have come in meanwhile, and `add` and
  // `remove` apply to the members the group has then.
  function planRoomChange(room: StoredRoom, patch: RoomPatch, actorId: string | undefined): RoomChange {
    const byMain = actorId === undefined || rt.isMain(actorId)
    const byAdmin = !byMain && rt.isAdminOf(room, actorId)
    if (!byMain && !byAdmin) throw new Error(`Only the user, a Main Bot, or the admin of "${room.name}" can change it`)
    let members = Array.isArray(patch.members) ? [...new Set(patch.members)] : [...(room.members ?? [])]
    for (const member of patch.add ?? []) if (!members.includes(member)) members.push(member)
    members = members.filter(member => !(patch.remove ?? []).includes(member) && rt.botOf(member) !== undefined)
    // A group left with one Bot by a deletion can still change its other settings.
    const current = (room.members ?? []).filter(member => rt.botOf(member) !== undefined)
    if (members.length !== current.length || members.some(member => !current.includes(member))) checkMembers(members)
    let admin = room.admin ?? null
    if (patch.admin !== undefined) {
      admin = patch.admin || null
      if (admin === null && byAdmin) throw new Error('Hand the admin role to another member instead of leaving the group without one')
      if (admin !== null && !members.includes(admin)) throw new Error(`${rt.botOf(admin)?.name ?? 'That Bot'} must be a member to be the admin`)
    }
    if (admin !== null && !members.includes(admin)) {
      if (byAdmin && admin === actorId) throw new Error('Hand the admin role to another member before leaving the group')
      admin = null
    }
    if (patch.mode !== undefined && !ROOM_MODES.includes(patch.mode)) throw new Error(`Reply mode must be one of ${ROOM_MODES.join(', ')}`)
    const notice = patch.notice === undefined ? undefined : cleanNotice(patch.notice)
    if (patch.workDir !== undefined && byAdmin) throw new Error(`Only the user or a Main Bot can set the folder of "${room.name}"`)
    // A Bot's own permissions are the user's to set, so a group's are too.
    if (patch.permission !== undefined && actorId !== undefined) throw new Error(`Only the user can set the permissions of "${room.name}"`)
    const permission = patch.permission === undefined ? undefined : rt.cleanRoomPermission?.(patch.permission) ?? null
    // The second run is the last check before the change is written, so no other change
    // can take the name in between.
    const name = patch.name === undefined ? undefined : cleanRoomName(patch.name, room.id)
    return { members, admin, name, notice, permission }
  }

  // `actorId` is the Bot asking, or undefined for the user. Returns what changed, in words.
  async function updateRoom(id: string, patch: RoomPatch, actorId?: string): Promise<{ readonly room: StoredRoom; readonly changes: readonly string[] }> {
    const asked = rt.roomOf(id)
    if (asked === undefined) throw new Error('Unknown group chat')
    planRoomChange(asked, patch, actorId)
    const moving = patch.workDir !== undefined
    const workDir = moving ? await rt.cleanWorkDir(patch.workDir ?? '') : undefined
    // No await from here until every change is written.
    const room = rt.roomOf(id)
    if (room === undefined) throw new Error('Unknown group chat')
    const { members, admin, name, notice, permission } = planRoomChange(room, patch, actorId)

    const changes: string[] = []
    const names = (ids: readonly string[]): string => ids.map(member => rt.botOf(member)?.name).filter((entry): entry is string => entry !== undefined).join(', ')
    const added = members.filter(member => !(room.members ?? []).includes(member))
    const removed = (room.members ?? []).filter(member => !members.includes(member))
    if (added.length > 0) changes.push(`added ${names(added)}`)
    // A deleted Bot still listed goes without a word.
    if (names(removed) !== '') changes.push(`removed ${names(removed)}`)
    // A member who leaves and comes back starts from a fresh look at the log.
    for (const member of removed) {
      if (room.seen !== undefined) delete room.seen[member]
      rt.dropGroupSession(room, member)
    }
    room.members = members
    if (admin !== (room.admin ?? null)) changes.push(admin ? `made ${rt.botOf(admin)?.name} the admin` : 'removed the admin')
    room.admin = admin
    if (patch.mode !== undefined && patch.mode !== room.mode) {
      room.mode = patch.mode
      changes.push(patch.mode === 'admin' ? 'plain messages now go to the admin first' : 'every member now replies in turn')
    }
    if (notice !== undefined && notice !== (room.notice ?? '')) {
      room.notice = notice
      changes.push(notice ? 'updated the notice' : 'cleared the notice')
    }
    // Members' group conversations move on to the folder at their next turn there.
    if (moving && workDir !== room.workDir) {
      if (workDir === undefined) delete room.workDir
      else room.workDir = workDir
      changes.push(workDir ? `every member now works in ${workDir} here` : 'every member works in its own folder again')
    }
    const before = room.name
    if (name !== undefined) {
      if (name !== '') {
        room.named = true
        room.name = name
      } else {
        delete room.named
      }
    }
    if (!room.named) room.name = autoRoomName(room.members ?? [])
    // The preset is written before its first await; the members' Sessions follow it.
    if (permission !== undefined && await rt.setRoomPermission?.(room, permission)) {
      changes.push(permission ? `every member now works with the ${permission} permissions here` : 'every member uses its own permissions again')
    }
    if (room.name !== before) {
      changes.push(`renamed it "${room.name}"`)
      await retitleRoom(room)
    }
    await rt.save()
    return { room, changes }
  }

  // A mark, not a delete: members, log, sessions and memory stay where they are.
  async function archiveRoom(id: string, archived: boolean): Promise<StoredRoom> {
    const room = rt.roomOf(id)
    if (room === undefined) throw new Error('Unknown group chat')
    if (archived) {
      if (typeof room.archivedAt !== 'number') room.archivedAt = Date.now()
    } else if (room.archivedAt !== undefined) delete room.archivedAt
    await rt.save()
    return room
  }

  async function deleteRoom(id: string): Promise<void> {
    const room = rt.roomOf(id)
    if (room === undefined) throw new Error('Unknown group chat')
    // Before the group's Sessions leave the state, which the archive reads.
    const archived = rt.archiveGroupMemory?.(room) ?? Promise.resolve()
    for (const botId of Object.keys(room.sessions ?? {})) rt.dropGroupSession(room, botId)
    delete state.rooms[id]
    rt.roomInbox.delete(id)
    rt.dropGroupLines?.(id)
    await archived
    const failed = await saveForDelete()
    // Armed scheduled tasks refuse a plain archive and would keep delivering into
    // the deleted group; the session-stop that stopActivity runs removes them.
    await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true })
      .catch(error => rt.warn('moon-bot: group chat %s not archived: %s', room.name, error))
    if (failed !== undefined) throw failed
  }

  return { roomBusy, autoRoomName, cleanRoomName, retitleRoom, followMemberNames, createRoom, updateRoom, deleteRoom, archiveRoom }
}

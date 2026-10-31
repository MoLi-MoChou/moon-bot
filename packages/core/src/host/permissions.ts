import type { HostRuntime, StoredBot, StoredRoom } from './runtime.js'

// Permissions. A Bot's permission preset is its own: kept on the Bot and set on every
// Session it speaks from, so a fresh part or a new group Session keeps it. A group may
// set one preset for all its members there, in place of each member's own, as it may
// set one working folder.
// the host offers Auto review for the current Session only, so neither a Bot nor a group keeps it.
const SESSION_ONLY = 'auto'

/** the host's permission presets for a Session. */
interface PermissionPresetsService {
  catalog(): {
    readonly options: readonly { readonly value: string }[]
    readonly defaultPreset: string
  }
  set(session: unknown, name: string): void
  resolve(name: string): unknown
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt

  const presets = (): PermissionPresetsService | undefined => ctx.get<PermissionPresetsService>('permissionPresets')

  // The presets the host offers, or undefined when the profile has none.
  function permissionCatalog():
    | { readonly options: readonly { readonly value: string }[]; readonly defaultPreset: string }
    | undefined {
    const service = presets()
    if (service === undefined) return undefined
    const { options, defaultPreset } = service.catalog()
    return { options: options.filter(option => option.value !== SESSION_ONLY), defaultPreset }
  }

  const roomOfSession = (sessionId: string): StoredRoom | undefined => rt.roomOf(rt.groupOwners.get(sessionId)?.roomId)

  const restored = new Set<string>()

  async function setPreset(service: PermissionPresetsService, sessionId: string, name: string): Promise<void> {
    const agent = await rt.resolveAgent(sessionId)
    service.set(agent.session, name)
  }

  // Sets the preset on one of the Bot's Sessions: its group's there, else its own; a Bot
  // without one keeps the host's default. `room` is for a group Session not indexed yet.
  async function applyPermission(
    bot: StoredBot,
    sessionId: string,
    room: StoredRoom | undefined = roomOfSession(sessionId),
  ): Promise<void> {
    const name = room?.permission ?? bot.permission
    const service = presets()
    if (service === undefined || !name) return
    restored.add(sessionId)
    try {
      await setPreset(service, sessionId, name)
    } catch (error) {
      restored.delete(sessionId)
      throw error
    }
  }

  async function restorePermission(sessionId: string, resolved?: { readonly session?: unknown }): Promise<void> {
    if (restored.has(sessionId)) return
    const bot = rt.botOf(rt.selfOf(sessionId))
    if (bot === undefined) return
    const room = roomOfSession(sessionId)
    const name = room?.permission ?? bot.permission
    const service = presets()
    if (service === undefined || !name) return
    const agent = resolved === undefined ? await rt.resolveAgent(sessionId) : resolved
    service.set(agent.session, name)
    restored.add(sessionId)
  }

  function checkPreset(name: unknown, whose: string): string {
    const service = presets()
    if (service === undefined) throw new Error('Permission presets are not available here')
    const wanted = String(name ?? '').trim()
    if (wanted === SESSION_ONLY)
      throw new Error(`Auto review applies to one Session only and cannot be ${whose} permission`)
    service.resolve(wanted)
    return wanted
  }

  async function setPermission(bot: StoredBot, name: unknown): Promise<void> {
    const wanted = checkPreset(name, "a Bot's")
    await applyPermission({ ...bot, permission: wanted }, rt.chatOf(bot.id))
    bot.permission = wanted
    for (const sessionId of rt.groupSessionsOf(bot.id)) {
      if (roomOfSession(sessionId)?.permission) continue
      await applyPermission(bot, sessionId).catch(error =>
        rt.warn('moon-bot: permission for %s in a group not applied: %s', bot.name, error),
      )
    }
  }

  // A group's preset, or null when each member uses its own.
  const cleanRoomPermission = (name: string | null | undefined): string | null =>
    name === null || name === '' ? null : checkPreset(name, "a group's")

  // Members' Sessions in the group change now; a member that has none there yet gets the
  // group's preset when its first turn there makes one. Returns whether it changed.
  async function setRoomPermission(room: StoredRoom, name: string | null | undefined): Promise<boolean> {
    const wanted = cleanRoomPermission(name) ?? undefined
    if (wanted === room.permission) return false
    if (wanted === undefined) delete room.permission
    else room.permission = wanted
    const service = presets()
    if (service === undefined) return true
    for (const [botId, sessionId] of Object.entries(room.sessions ?? {})) {
      const bot = rt.botOf(botId)
      if (bot === undefined) continue
      // A member without a preset of its own goes back to the default its Session started on.
      const next = wanted ?? bot.permission ?? service.catalog().defaultPreset
      await setPreset(service, sessionId, next).catch(error =>
        rt.warn('moon-bot: permission for %s in %s not applied: %s', bot.name, room.name, error),
      )
    }
    return true
  }

  Object.assign(rt, {
    permissionCatalog,
    applyPermission,
    restorePermission,
    setPermission,
    cleanRoomPermission,
    setRoomPermission,
  })
}

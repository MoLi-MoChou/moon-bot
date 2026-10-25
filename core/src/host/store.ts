// Store: the saved team (state.json), its migrations, and the lock that keeps a second
// dsh host on the same data from writing it. The Session index lives in store-sessions.ts
// and the lock and file read in store-lock.ts; this file owns the data and its saves.
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { LEGACY_THEMES, MAX_EXCHANGES, ROOM_MODES, TEXT_KEPT } from './constants.ts'
import { replaceFile } from './files.ts'
import { currentColor, headOf, normalize, unquote } from './text.ts'
import { createSessionIndex } from './store-sessions.ts'
import type { SessionIndex } from './store-sessions.ts'
import { createStoreLock } from './store-lock.ts'
import type { StoreLock } from './store-lock.ts'
import type { HostRuntime, StoredBot, StoredRoom, StoredState } from './runtime.js'

// A table read that sees only the keys the table holds itself. Ids that come from
// outside (a request body, a tool argument, a name a model gives) go through this, so
// "__proto__" and other inherited names read as "not there" instead of returning
// Object.prototype.
export const own = <T>(table: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined =>
  (table != null && Object.hasOwn(table, key) ? table[key] : undefined)

export function install(rt: HostRuntime): void {
  const { ctx, home, statePath } = rt
  const { warn } = rt

  const state: StoredState = {
    version: 1, mainBotIds: [], bots: {}, rooms: {}, agents: {},
    capabilities: { items: {} }, exchanges: [], exchangeTurns: {}, works: {}, questions: {}, views: {},
    prefs: {}, switching: {}, revision: 0,
  }
  let loaded: Promise<void> | undefined
  let writing: Promise<unknown> = Promise.resolve()

  const EMPTY = JSON.stringify(state)
  const lock: StoreLock = createStoreLock({ home, statePath, warn: (template, ...args) => warn(template, ...args) })
  let stopped = false
  let sessionIndex: SessionIndex | undefined

  // Fill `state` from the saved file and bring an older team up to date. Returns the
  // groups whose Session titles still need the new name.
  const adopt = (parsed: unknown): { migrated: boolean; stale: StoredRoom[] } => {
    const source = (parsed ?? {}) as Partial<StoredState>
    const hadCapabilities = parsed !== null && parsed !== undefined && Object.hasOwn(parsed as object, 'capabilities')
    for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key]
    Object.assign(state, JSON.parse(EMPTY) as StoredState, source)
    state.prefs ??= {}
    // Teams saved before the DSH Agent existed carry no `agents`; corrupt values reset.
    if (state.agents === null || typeof state.agents !== 'object' || Array.isArray(state.agents)) state.agents = {}
    let migrated = !hadCapabilities
    if (state.capabilities === null || typeof state.capabilities !== 'object' || Array.isArray(state.capabilities)) {
      state.capabilities = { items: {} }
      migrated = true
    } else if (state.capabilities.items === null || typeof state.capabilities.items !== 'object' || Array.isArray(state.capabilities.items)) {
      state.capabilities.items = {}
      migrated = true
    }
    for (const bot of Object.values(state.bots)) {
      if (!Array.isArray(bot.capabilities)) {
        bot.capabilities = []
        migrated = true
      }
      if (bot.color !== currentColor(bot.color)) {
        bot.color = currentColor(bot.color)
        migrated = true
      }
      // LEGACY: Bots saved with a lab ran on that lab's default model; the model they
      // last ran on becomes their own, so dropping the lab changes nothing for them.
      if ('lab' in bot) {
        if (!bot.model && bot.appliedModel) bot.model = bot.appliedModel
        delete bot.lab
        migrated = true
      }
    }
    // A team from before several Main Bots were allowed names a single one.
    if (!Array.isArray(state.mainBotIds)) state.mainBotIds = []
    if ('mainBotId' in state) {
      if (state.mainBotId && !state.mainBotIds.includes(state.mainBotId)) state.mainBotIds.unshift(state.mainBotId)
      delete state.mainBotId
      migrated = true
    }
    state.mainBotIds = state.mainBotIds.filter(id => state.bots[id] !== undefined)
    // Teams from before the whale was stored at setup: their first Bot, while still a
    // Main Bot, gets it once wherever it has no look of its own. After that the whale is
    // an ordinary look the user can change, and it never passes to another Bot.
    if (state.whaleStored !== true) {
      const first = Object.values(state.bots).reduce<StoredBot | undefined>(
        (best, bot) => (best === undefined || (bot.createdAt ?? 0) < (best.createdAt ?? 0) ? bot : best),
        undefined,
      )
      if (first !== undefined && state.mainBotIds.includes(first.id)) {
        if (!first.avatar?.shape && !first.avatar?.image) first.avatar = { ...first.avatar, shape: 'moonbot' }
        if (!first.color) first.color = 'lilac'
      }
      state.whaleStored = true
      if (first !== undefined) migrated = true
    }
    // Moon Bot: a Main Bot still wearing DS Bot's blue whale, as set up, gets Moon Bot's
    // sprite once. A whale in any other color was the user's pick and stays.
    if (state.moonLook !== true) {
      for (const id of state.mainBotIds) {
        const bot = state.bots[id]
        if (bot?.avatar?.shape === 'whale' && !bot.avatar.image && (bot.color ?? 'deepseek') === 'deepseek') {
          bot.avatar = { ...bot.avatar, shape: 'moonbot' }
          bot.color = 'lilac'
          state.moonLook = true
          migrated = true
        }
      }
    }
    const theme = state.prefs.theme
    if (typeof theme === 'string' && Object.hasOwn(LEGACY_THEMES, theme)) {
      state.prefs.theme = LEGACY_THEMES[theme]
      migrated = true
    }
    if (state.works === null || typeof state.works !== 'object' || Array.isArray(state.works)) state.works = {}
    if (state.views === null || typeof state.views !== 'object' || Array.isArray(state.views)) state.views = {}
    // LEGACY: Bots no longer count the rounds they start in a group.
    for (const room of Object.values(state.rooms)) {
      if (!('botRounds' in room)) continue
      delete room.botRounds
      migrated = true
    }
    // Groups from before group settings existed reply in turn, led by a Main Bot member.
    for (const room of Object.values(state.rooms)) {
      if (room.admin !== undefined && room.mode !== undefined && ROOM_MODES.includes(room.mode)) continue
      if (room.admin === undefined) room.admin = room.members?.find(id => state.mainBotIds.includes(id)) ?? null
      if (room.mode === undefined || !ROOM_MODES.includes(room.mode)) room.mode = 'everyone'
      room.notice ??= ''
      migrated = true
    }
    // A Bot deleted while a group was made or changed could stay listed in it, even as its
    // admin; it leaves the group now.
    for (const room of Object.values(state.rooms)) {
      const members = (room.members ?? []).filter(id => state.bots[id] !== undefined)
      const admin = members.includes(room.admin ?? '') ? room.admin : null
      if (members.length === (room.members ?? []).length && admin === room.admin) continue
      room.members = members
      room.admin = admin
      migrated = true
    }
    // Teams from before #206 kept every long message whole in this file, written whole on
    // every save. A message between Bots is whole in its recipient's Session; a group
    // line's whole text moves to a file of its own, which only the writing host makes.
    const writer = lock.holder() === undefined && lock.stuck() === undefined
    for (const entry of state.exchanges) {
      if (typeof entry.text !== 'string' || entry.text.length <= TEXT_KEPT || entry.length !== undefined) continue
      entry.length = entry.text.length
      entry.text = headOf(entry.text, TEXT_KEPT)
      migrated = true
    }
    for (const room of writer ? Object.values(state.rooms) : []) {
      if (!Array.isArray(room.log)) continue
      const log = room.log.map(line => (typeof line.text === 'string' && line.length === undefined && typeof line.seq === 'number' ? rt.keepGroupLine?.(room.id, line, line.text) ?? line : line))
      if (log.some((line, index) => line !== room.log?.[index])) {
        room.log = log
        migrated = true
      }
    }
    // Unnamed groups from before names followed their members may still list old names.
    const stale = Object.values(state.rooms).filter(room => !room.named && room.name !== rt.autoRoomName?.(room.members ?? []))
    for (const room of stale) room.name = rt.autoRoomName?.(room.members ?? []) ?? room.name
    sessionIndex?.indexSessions()
    return { migrated: migrated || stale.length > 0, stale }
  }

  const load = (): Promise<void> => loaded ??= (async () => {
    lock.claim()
    const held = lock.holder()
    if (held !== undefined) warn('ds-bot: %s', lock.readOnly())
    const { migrated, stale } = adopt(await lock.readFileState())
    if (held !== undefined) return
    if (migrated && lock.stuck() === undefined) {
      // A failed write must not poison `loaded`: the migrated state stays in
      // memory and the next save() writes it.
      try {
        await save()
      } catch (error) {
        warn('ds-bot: saving the migrated Bot team failed: %s', error)
      }
    }
    // Not awaited: renaming a session must not hold up the first roster read.
    for (const room of stale) void rt.retitleRoom?.(room)
  })()

  // A reading host follows the file and takes over once the other host has gone.
  const refresh = async (): Promise<void> => {
    await load()
    const hadHolder = lock.holder() !== undefined
    if (hadHolder) {
      lock.claim()
      if (lock.holder() === undefined) {
        warn('ds-bot: the other instance has closed; this one now saves the Bot team')
        lock.markWarned()
        adopt(await lock.readFileState())
        return
      }
    } else if (!lock.broken() && !lock.owns()) {
      // A cached "writer" is stale once the lock file no longer names this host:
      // another instance may have taken it over, or the file may just be gone. Re-claim
      // and re-check instead of trusting the flag.
      lock.claim()
      if (lock.broken()) return
      if (lock.holder() === undefined) {
        // The lock was free: still the writer, but the file may carry changes
        // written while no host held it.
        lock.markWarned()
        adopt(await lock.readFileState())
        return
      }
      warn('ds-bot: %s', lock.readOnly())
    }
    if ((lock.stuck() !== undefined || lock.holder() !== undefined) && lock.seen() !== undefined) adopt(await lock.readFileState())
  }

  const warnReadOnly = (): boolean => {
    if (!lock.warned()) {
      lock.markWarned()
      warn('ds-bot: not saving the Bot team: %s', lock.readOnly())
    }
    return false
  }
  const writable = (): boolean => {
    if (lock.stuck() !== undefined) return warnReadOnly()
    if (lock.broken()) return true
    if (lock.holder() === undefined && lock.owns()) return true
    // Lost the lock: retake it when nobody else holds it (its file was deleted), else
    // another host took it over and this one stops writing.
    if (lock.holder() === undefined) {
      lock.claim()
      if (lock.holder() === undefined) return true
    }
    return warnReadOnly()
  }

  const save = (): Promise<unknown> => {
    if (stopped) return writing
    sessionIndex?.indexSessions()
    // A reading host keeps the file's revision, so its window does not skip the next change.
    if (!writable()) return writing
    state.revision += 1
    state.exchanges = state.exchanges.slice(-MAX_EXCHANGES)
    const snapshot = JSON.stringify(state)
    const run = writing.then(async (): Promise<void> => {
      const temp = `${statePath}.${process.pid}.tmp`
      try {
        await mkdir(home, { recursive: true })
        const ensureLock = (): void => {
          if (lock.broken()) return
          if (!lock.owns()) {
            const error = Object.assign(new Error('ds-bot lost the state lock to another instance'), { code: 'ELOCKLOST' })
            throw error
          }
        }
        ensureLock()
        await writeFile(temp, snapshot, 'utf8')
        ensureLock()
        await replaceFile(temp, statePath, ensureLock)
        rt.capabilitiesStateSaved?.()
        rt.stateSaved?.()
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw error
      }
    })
    writing = run.catch(() => {})
    return run.catch(error => {
      warn('ds-bot: state write failed: %s', error)
      throw error
    })
  }

  ctx.effect(() => () => {
    stopped = true
    return writing.finally(() => lock.release())
  }, 'ds-bot: state lock')

  const botOf = (id: string | undefined): StoredBot | undefined => (id === undefined ? undefined : own(state.bots, id))
  const roomOf = (id: string | undefined): StoredRoom | undefined => (id === undefined ? undefined : own(state.rooms, id))
  const isMain = (id: string | undefined): boolean => id !== undefined && state.mainBotIds.includes(id)

  // Group Sessions. A member speaks in each group from a hidden Session of its own,
  // `room.sessions[botId]`, that renders the same system prompt and tools as its own
  // chat: the provider's prefix cache is shared, and a group turn never re-reads the
  // member's private context. Created on the member's first turn in the group.
  sessionIndex = createSessionIndex({
    state,
    botOf,
    onIndexed: () => rt.indexAgents?.(),
    cancelApprovals: (sessionId) => rt.cancelApprovals?.(sessionId),
    archiveSession: (sessionId) => ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }),
  })
  const { chatOwners, groupOwners, pastOwners, chatOf, selfOf, isBotSession, groupSessionsOf, dropGroupSession, retireGroupSession } = sessionIndex

  const findBot = (ref: string | undefined): StoredBot | undefined => {
    if (ref === undefined) return undefined
    const byId = own(state.bots, ref)
    if (byId) return byId
    const wanted = normalize(ref).replace(/^@/, '')
    return Object.values(state.bots).find(bot => normalize(bot.name) === wanted)
  }
  // Every group chat whose id or name matches; callers refuse an ambiguous name.
  const findRooms = (ref: string | undefined): StoredRoom[] => {
    if (ref === undefined || ref === null) return []
    const byId = own(state.rooms, ref)
    if (byId) return [byId]
    const wanted = normalize(unquote(ref))
    return Object.values(state.rooms).filter(room => normalize(room.name) === wanted)
  }
  const isAdminOf = (room: StoredRoom, id: string | undefined): boolean => id !== undefined && room.admin === id

  Object.assign(rt, {
    state, load, save, refresh, readOnly: lock.readOnly, own,
    botOf, roomOf, isMain, chatOf, selfOf, isBotSession,
    chatOwners, groupOwners, pastOwners,
    groupSessionsOf, dropGroupSession, retireGroupSession, findBot, findRooms, isAdminOf,
  })
}

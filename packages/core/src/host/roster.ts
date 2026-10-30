// Roster: creating, changing, and deleting Bots and group chats, the Main Bot role, and
// the first Main Bot of a new team. The Session setup lives in roster-setup.ts and the
// group chat rules in roster-rooms.ts.
import { cleanAvatar, dropKickoff as dropHeldKickoff, kickoffText, sendKickoff } from './roster-kickoff.ts'
import { currentColor, isColor, normalize } from './text.ts'
import { nameProblem } from 'moon-bot-contracts'
import { createRosterSetup } from './roster-setup.ts'
import { createRosterRoles } from './roster-roles.ts'
import { createRosterRooms } from './roster-rooms.ts'
import type { RosterRooms } from './roster-rooms.ts'
import type { HostRuntime, StoredBot, StoredBotEngine, StoredRoom } from './runtime.js'
import type { CreateBotOptions, UpdateBotPatch } from './roster-types.ts'

const cleanEngine = (value: unknown): StoredBotEngine | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Bot engine')
  const input = value as { kind?: unknown; command?: unknown; args?: unknown; key?: unknown; agentId?: unknown }
  if (input.kind === 'builtin') return { kind: 'builtin' }
  if (input.kind === 'acp-remote') {
    // The agentId names a relay invite; the runner resolves it to a live connection.
    if (typeof input.agentId !== 'string' || input.agentId.trim() === '') throw new Error('A remote ACP engine needs an agentId')
    return { kind: 'acp-remote', agentId: input.agentId.trim().slice(0, 120) }
  }
  if (input.kind !== 'acp' || typeof input.command !== 'string' || input.command.trim() === '') throw new Error('An ACP engine needs a command')
  const args = input.args === undefined ? [] : Array.isArray(input.args) && input.args.every(arg => typeof arg === 'string') ? input.args.map(arg => arg.slice(0, 400)) : undefined
  if (args === undefined) throw new Error('ACP engine arguments must be a list of strings')
  const key = typeof input.key === 'string' && input.key.trim() !== '' ? input.key.trim().slice(0, 120) : input.command.trim()
  return { kind: 'acp', command: input.command.trim().slice(0, 400), args, key }
}

export function install(rt: HostRuntime): void {
  const { ctx, defaults, state } = rt

  let bootstrapping: Promise<unknown> | null = null
  const setup = createRosterSetup({ ctx, rt, state })
  const { keepTeamFolder, ensureWorkspace, createSession } = setup

  // A new Bot or group is written only after its Session is made, several awaits after
  // its name was checked. The name is held from the check until the create ends, so a
  // create or rename that runs meanwhile cannot take it too.
  const held = { bot: new Set<string>(), room: new Set<string>() }
  const isHeld = (kind: 'bot' | 'room', name: string): boolean => held[kind].has(normalize(name))
  async function holdName<T>(kind: 'bot' | 'room', name: string, work: () => Promise<T>): Promise<T> {
    const key = normalize(name)
    if (key === '') return work()
    held[kind].add(key)
    try {
      return await work()
    } finally {
      held[kind].delete(key)
    }
  }

  // A deletion whose save fails stays in memory, and the next save writes it, so its
  // Sessions are stopped anyway: left armed, their scheduled tasks would keep running
  // with nothing in the team to show or delete them. Only a host that lost the team
  // to another instance keeps them, since the other host's copy still has them.
  async function saveForDelete(): Promise<unknown | undefined> {
    try {
      await rt.save()
      return undefined
    } catch (error) {
      if ((error as { readonly code?: string } | undefined)?.code === 'ELOCKLOST' || rt.readOnly() !== undefined) throw error
      return error
    }
  }

  const rooms: RosterRooms = createRosterRooms({ ctx, rt, state, createSession, holdName, isHeld, saveForDelete })
  const roles = createRosterRoles({ rt, state })
  const { setMain, setFlags } = roles
  const { autoRoomName, followMemberNames, retitleRoom, createRoom, updateRoom, deleteRoom, archiveRoom, roomBusy } = rooms

  const botNameTaken = (name: string): boolean => rt.findBot(name) !== undefined || isHeld('bot', name)

  const freshName = (base: string): string => {
    const stem = base.slice(0, 34)
    if (!botNameTaken(stem)) return stem
    let index = 2
    while (botNameTaken(`${stem} ${index}`)) index += 1
    return `${stem} ${index}`
  }

  // `pickModel` leaves the model to the user: the chat opens on a model card, and the
  // greeting waits until a model is chosen. So does a Bot made when no model is served.
  async function createBot(options: CreateBotOptions): Promise<StoredBot> {
    const cleanName = String(options.name ?? '')
      .trim()
      .slice(0, 40)
    const problem = nameProblem(cleanName)
    if (problem !== undefined) throw new Error(problem)
    if (botNameTaken(cleanName)) throw new Error(`A Bot named ${cleanName} already exists`)
    return holdName('bot', cleanName, () => buildBot(cleanName, options))
  }

  async function buildBot(cleanName: string, { role = '', instructions = '', color, brief = '', createdBy, main = false, avatar, model, effort, workDir, copyOf, pickModel = false, engine, runtimeId }: CreateBotOptions): Promise<StoredBot> {
    const cleanAvatarValue = cleanAvatar(avatar)
    const engineSpec = cleanEngine(engine)
    const cleanRuntimeId = typeof runtimeId === 'string' && runtimeId.trim() !== '' ? runtimeId.trim().slice(0, 120) : undefined
    // The model is fixed at creation, so a later change of the host default leaves it alone.
    const modelRef = model ? await rt.resolveModel(model) : pickModel ? undefined : await rt.defaultModel()
    // A thinking level needs a model to resolve against; with none it would be dropped
    // silently, so the create fails before a Session is made.
    if (effort !== undefined && effort !== '' && modelRef === undefined) throw new Error('Pick a model before choosing a thinking level')
    const effortId = modelRef === undefined ? undefined : await rt.resolveEffort(modelRef, effort)
    const dir = workDir === undefined || workDir === null ? undefined : await rt.cleanWorkDir(workDir)
    const id = await createSession(cleanName, dir === undefined ? {} : { dir })
    try {
      state.bots[id] = {
        id,
        name: cleanName,
        role: String(role).trim().slice(0, 24),
        // A color is only stored when the user picks one; otherwise the id picks it.
        ...(isColor(currentColor(color ?? undefined)) ? { color: currentColor(color ?? undefined) } : {}),
        ...(cleanAvatarValue ? { avatar: cleanAvatarValue } : {}),
        ...(modelRef ? { model: modelRef } : {}),
        ...(effortId ? { effort: effortId } : {}),
        ...(engineSpec ? { engine: engineSpec } : {}),
        ...(cleanRuntimeId ? { runtimeId: cleanRuntimeId } : {}),
        ...(dir ? { workDir: dir } : {}),
        instructions: String(instructions).trim(),
        createdAt: Date.now(),
        createdBy: createdBy ?? null,
        capabilities: [],
      }
      if (main) state.mainBotIds.push(id)
      const creator = rt.botOf(createdBy)
      const original = rt.botOf(copyOf)
      const language = rt.uiLanguage?.()
      const text = kickoffText({ main, originalName: original?.name, creatorName: creator?.name, brief, language })
      const bot = state.bots[id]
      if (modelRef === undefined) {
        bot.kickoff = { text, from: createdBy ?? null, ...(main ? { main: true } : {}) }
        await rt.save()
        return bot
      }
      await rt.save()
      // The greeting runs on the Bot's own model, once its provider is registered.
      void rt
        .waitForModel(bot)
        .then(() => rt.applyModel(bot).catch(error => rt.warn('moon-bot: model for %s not applied: %s', cleanName, error)))
        .then(() => sendKickoff(rt, bot, { text, ...(createdBy === undefined ? {} : { from: createdBy }) }))
      return bot
    } catch (error) {
      // The Bot's Session was already made: archive it instead of leaving an orphan.
      delete state.bots[id]
      state.mainBotIds = state.mainBotIds.filter(other => other !== id)
      rt.chatOwners.delete(id)
      // A save that another change queued meanwhile still carries this Bot; a later
      // one writes the team without it.
      void rt.save().catch(() => {})
      await ctx.workspaceRegistry.archiveSession(id).catch(archiveError => rt.warn('moon-bot: archiving the Session for %s failed: %s', cleanName, archiveError))
      throw error
    }
  }

  async function duplicateBot(id: string): Promise<StoredBot> {
    const bot = rt.botOf(id)
    if (bot === undefined) throw new Error('Unknown Bot')
    const served = (await rt.catalog()).some(entry => entry.ref === bot.model)
    // A folder that went away since leaves the copy in the team workspace.
    const workDir = bot.workDir !== undefined && (await rt.isFolder(bot.workDir)) ? bot.workDir : undefined
    // No await from here to createBot's check, so two copies at once get different names.
    return createBot({
      name: freshName(`${bot.name} copy`),
      role: bot.role,
      instructions: bot.instructions,
      ...(bot.color === undefined ? {} : { color: bot.color }),
      avatar: bot.avatar,
      ...(served && bot.model !== undefined ? { model: bot.model } : {}),
      ...(served && bot.effort !== undefined ? { effort: bot.effort } : {}),
      ...(bot.engine === undefined ? {} : { engine: bot.engine }),
      ...(bot.runtimeId === undefined ? {} : { runtimeId: bot.runtimeId }),
      ...(workDir === undefined ? {} : { workDir }),
      copyOf: bot.id,
    })
  }

  async function updateBot(id: string, patch: UpdateBotPatch): Promise<StoredBot> {
    const bot = rt.botOf(id)
    if (bot === undefined) throw new Error('Unknown Bot')
    // Checked first, so a folder, model or level that does not pass leaves the rest
    // unchanged too.
    const moving = patch.workDir !== undefined
    const workDir = moving ? await rt.cleanWorkDir(patch.workDir ?? '') : undefined
    const modelRef: string | null | undefined = patch.model === undefined ? undefined : patch.model === null || patch.model === '' ? null : await rt.resolveModel(patch.model)
    // A new level resolves against the model the Bot will run on: the new one, the
    // model it keeps, or — the model cleared — the one it last ran on.
    const effortRef = modelRef === undefined ? (bot.model ?? bot.appliedModel) : (modelRef ?? bot.appliedModel)
    let effortId: string | null | undefined
    const engineSpec = patch.engine === undefined ? undefined : cleanEngine(patch.engine)
    const runtimeId = patch.runtimeId === undefined ? undefined : typeof patch.runtimeId === 'string' && patch.runtimeId.trim() !== '' ? patch.runtimeId.trim().slice(0, 120) : undefined
    if (patch.effort !== undefined) {
      if (patch.effort === null || patch.effort === '') effortId = null
      else {
        if (effortRef === undefined) throw new Error('Pick a model before choosing a thinking level')
        effortId = await rt.resolveEffort(effortRef, patch.effort)
      }
    }
    if (patch.name !== undefined) {
      const next = String(patch.name).trim().slice(0, 40)
      const clash = rt.findBot(next)
      const pending = isHeld('bot', next) && normalize(next) !== normalize(bot.name)
      if (next === '' || (clash !== undefined && clash.id !== id) || pending) throw new Error(`Name ${next} is not available`)
      // A name saved before the rule stays usable until it changes.
      const problem = next === bot.name ? undefined : nameProblem(next)
      if (problem !== undefined) throw new Error(problem)
      bot.name = next
      const agent = await rt.resolveAgent(rt.chatOf(id))
      await ctx.sessionTitle.rename(agent.session, next)
      await followMemberNames(Object.values(state.rooms).filter(room => (room.members ?? []).includes(id)))
    }
    if (patch.role !== undefined) bot.role = String(patch.role).trim().slice(0, 24)
    if (patch.instructions !== undefined) bot.instructions = String(patch.instructions).trim()
    let modelChanged = false
    const engineChanged = patch.engine !== undefined
    const runtimeChanged = patch.runtimeId !== undefined
    if (patch.color !== undefined) {
      if (patch.color === null) delete bot.color
      else if (isColor(currentColor(patch.color))) bot.color = currentColor(patch.color)
    }
    if (patch.avatar !== undefined) {
      const avatar = cleanAvatar(patch.avatar)
      if (avatar) bot.avatar = avatar
      else delete bot.avatar
    }
    if (patch.model !== undefined) {
      if (modelRef === null) delete bot.model
      else if (modelRef !== undefined) bot.model = modelRef
      modelChanged = true
    }
    if (patch.effort !== undefined) {
      if (effortId === null || effortId === undefined) delete bot.effort
      else bot.effort = effortId
      modelChanged = true
    }
    if (engineChanged) {
      if (engineSpec === undefined) delete bot.engine
      else bot.engine = engineSpec
    }
    if (runtimeChanged) {
      if (runtimeId === undefined) delete bot.runtimeId
      else bot.runtimeId = runtimeId
    }
    if (patch.permission !== undefined) await rt.setPermission?.(bot, patch.permission)
    const moved = moving && workDir !== bot.workDir
    if (moving) {
      if (workDir === undefined) delete bot.workDir
      else bot.workDir = workDir
    }
    await rt.save()
    if (modelChanged) await rt.applyModel(bot, { force: true })
    if (moved) void rt.followFolder?.(bot.id)
    if (bot.model && bot.kickoff !== undefined) {
      const kickoff = bot.kickoff
      delete bot.kickoff
      await rt.save()
      sendKickoff(rt, bot, { text: kickoff.text, ...(kickoff.from === null || kickoff.from === undefined ? {} : { from: kickoff.from }) })
    }
    return bot
  }

  async function deleteBot(id: string): Promise<void> {
    const bot = rt.botOf(id)
    if (bot === undefined) throw new Error('Unknown Bot')
    if (rt.isMain(id)) throw new Error('A Main Bot cannot be deleted; remove its Main Bot role first')
    // Before the Bot and its group Sessions leave the state, which the archive reads.
    const archived = rt.archiveBotMemory?.(id) ?? Promise.resolve()
    const current = rt.chatOf(id)
    // Questions and exchange turns are kept per Session, so every part of the chat is cleared.
    const parts = new Set<string>([id, current, ...(bot.segments ?? []).map(segment => segment.sessionId)])
    await rt.releaseBot?.(id, [...parts, ...rt.groupSessionsOf(id)])
    delete state.bots[id]
    for (const part of parts) {
      delete state.questions[part]
      if (state.views !== undefined) delete state.views[part]
      delete state.exchangeTurns[part]
      delete state.switching[part]
    }
    const touched: StoredRoom[] = []
    for (const room of Object.values(state.rooms)) {
      if (!(room.members ?? []).includes(id)) continue
      room.members = (room.members ?? []).filter(member => member !== id)
      if (room.admin === id) room.admin = null
      rt.dropGroupSession(room, id)
      touched.push(room)
    }
    await followMemberNames(touched)
    await rt.forgetBotSecrets?.(id)
    await archived
    const failed = await saveForDelete()
    // Same as deleteRoom: stopActivity removes the Session's armed scheduled tasks.
    // Past parts are archived too: a part move can leave tasks on the old Session,
    // which otherwise stays armed and invisible. Already-archived ids are a no-op.
    for (const part of parts) {
      await ctx.workspaceRegistry.archiveSession(part, { stopActivity: true }).catch(error => rt.warn('moon-bot: Bot %s not archived: %s', bot.name, error))
    }
    if (failed !== undefined) throw failed
  }

  async function bootstrap(): Promise<void> {
    await rt.load()
    void rt.syncModels?.()
    if (state.mainBotIds.some(id => rt.botOf(id))) return
    // Only the team's first Main Bot is stored as Moon Bot's lilac moon sprite; other Bots get a
    // look from their id, and a Bot made Main Bot later keeps its own.
    bootstrapping ??= createBot({ name: defaults.mainName, role: defaults.mainRole, main: true, color: 'lilac', avatar: { shape: 'moonbot' }, pickModel: true }).finally(() => {
      bootstrapping = null
    })
    await bootstrapping
  }

  Object.assign(rt, {
    ensureWorkspace,
    keepTeamFolder,
    createSession,
    createBot,
    duplicateBot,
    updateBot,
    setFlags,
    roomBusy,
    autoRoomName,
    retitleRoom,
    createRoom,
    updateRoom,
    deleteRoom,
    archiveRoom,
    setMain,
    deleteBot,
    bootstrap,
    dropKickoff: (botId: string) => dropHeldKickoff(rt, botId),
  })
}

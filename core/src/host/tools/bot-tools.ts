// The tools that make a Bot and change one: create_bot, update_bot, the engine list they
// read, and the working_directory listener that keeps a Bot's folder in step. Split from
// teamTools.ts to stay inside the line limit; the two install together.
import { z } from 'zod'
import type { ToolContext } from '../../engine/registry.ts'
import type { ToolExecution } from '../host-types.js'
import type { HostRuntime, StoredBot } from '../runtime.ts'
import { readAvatar } from '../avatar.ts'
import { COLORS, EXTRA_COLORS } from '../constants.ts'
import { within } from '../folders.ts'
import { unquote } from '../text.ts'
import { AVATAR_PARAM, WORK_DIR_PARAM, WORKING_DIRECTORY_TOOL, errorMessage, isRecord } from './shared.ts'
import type { EngineCatalog } from '../../engine/acp/discovery.ts'
import { engineChoices, engineList, engineOf } from './engine-choice.ts'
import type { ToolShared } from './shared.ts'

interface CreateBotArgs {
  readonly name?: string
  readonly role?: string
  readonly instructions?: string
  readonly brief?: unknown
  readonly model?: string
  readonly effort?: string
  readonly engine?: unknown
  readonly work_dir?: unknown
  readonly avatar?: unknown
}

interface UpdateBotArgs {
  readonly bot?: string
  readonly name?: string
  readonly role?: string
  readonly instructions?: string
  readonly color?: string
  readonly avatar?: unknown
  readonly model?: string
  readonly effort?: string
  readonly engine?: unknown
  readonly work_dir?: unknown
}

/** The `tools/execute` middleware's event: the tool call, with the arguments it passes. */
interface ToolExecuteEvent extends ToolExecution {
  readonly arguments?: unknown
}

type ToolNext = () => Promise<{ readonly isError?: boolean } | undefined>

export function installBotTools(rt: HostRuntime, shared: ToolShared): void {
  const t = rt as typeof shared.rt
  const { ctx } = rt
  const catalog = (): EngineCatalog | undefined => ctx.get<EngineCatalog>('engineCatalog')

  shared.register({
    name: 'create_bot',
    description: 'Main Bot only. Create a new Bot on the user\'s team. It appears in the sidebar and greets the user.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short display name, e.g. "Researcher" or "Editor"' },
      role: { type: 'string', required: true, description: 'Two-to-four character role label shown under the name' },
      instructions: { type: 'string', required: true, description: 'What this Bot is responsible for and how it should work' },
      brief: { type: 'string', description: 'Why the user wants it, passed to the new Bot as its first context' },
      model: { type: 'string', description: 'Model the Bot runs on, as provider/model or a model id. Only when the user names one; otherwise the model you run on.' },
      effort: { type: 'string', description: 'Thinking level for the model, as list_models shows it. Only when the user names one.' },
      engine: { type: 'string', description: 'Engine the Bot runs on, from list_engines. Only when the user names one; when they did not, ask which engine before creating.' },
      work_dir: WORK_DIR_PARAM,
      avatar: AVATAR_PARAM,
    },
    schema: z.object({
      name: z.string(), role: z.string(), instructions: z.string(),
      brief: z.string().optional(), model: z.string().optional(), effort: z.string().optional(),
      engine: z.string().optional(),
      work_dir: z.string().optional(), avatar: z.string().optional(),
    }).passthrough(),
    async execute(args: CreateBotArgs, context: ToolContext): Promise<string> {
      await t.load()
      if (!t.isMain(t.selfOf(context.sessionId))) return 'Only the Main Bot can create Bots. Ask the Main Bot instead.'
      let bot: StoredBot
      try {
        // The engine is the user's to choose, not the model's to guess: without a name the
        // tool says which engines there are and stops, so the model asks instead of
        // quietly starting the Bot on the built-in one.
        const engines = engineChoices(catalog())
        const asked = String(args.name ?? 'the new Bot').trim() || 'the new Bot'
        const named = typeof args.engine === 'string' ? args.engine.trim() : ''
        if (named === '') return `Which engine should ${asked} run on? The engines right now are: ${engineList(engines)}. Ask the user, then call create_bot again with engine set.`
        const choice = engineOf(named, engines, catalog())
        if (!choice.ok) return choice.message
        const folder = t.sessionFolder(context.session ?? { id: context.sessionId })
        const avatar = args.avatar ? await readAvatar(String(args.avatar), { ...(folder !== undefined ? { baseDir: folder } : {}), isData: t.inData }) : undefined
        const workDir = args.work_dir ? await t.cleanWorkDir(args.work_dir) : undefined
        const name = String(args.name ?? '').trim()
        await t.approveFolder(context, { path: workDir, who: { en: `the new Bot ${name}`, zh: `新 Bot ${name} ` }, toolName: 'create_bot' })
        // Without a named model the new Bot takes its creator's: the host default may be
        // a provider that has no key, and then the new Bot fails on its first reply.
        const creator = shared.callerBot(context)
        const served = creator?.model ? (await t.catalog()).some(entry => entry.ref === creator.model) : undefined
        const model = args.model || (served ? creator?.model : undefined)
        bot = await t.createBot({ ...args, avatar: avatar === undefined ? undefined : { image: avatar }, model, workDir, effort: args.effort, createdBy: creator?.id, engine: choice.engine, runtimeId: choice.runtimeId })
        return `Created ${bot.name} on ${named},${workDir ? ` working in ${workDir},` : ''} and it is greeting the user now.`
      } catch (error) {
        return `Could not create the Bot: ${errorMessage(error)}`
      }
    },
  })

  shared.register({
    name: 'list_engines',
    description: 'List the engines a Bot can run on, as the refs create_bot and update_bot take in engine. An engine that is not installed here says so instead of being offered.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(): Promise<string> {
      const choices = engineChoices(catalog())
      const usable = choices.filter(choice => choice.selectable)
      const lines = usable.map((choice) => {
        const name = choice.id === 'builtin' ? 'builtin' : choice.id
        const detail = choice.kind === 'builtin' ? 'Moon Bot built-in engine' : `${choice.label} (${choice.kind})`
        return `${name}: ${detail}`
      })
      const blocked = choices.filter(choice => !choice.selectable)
      const tail = blocked.length === 0 ? '' : ` Not usable here: ${blocked.map(choice => `${choice.id}${choice.reason === undefined ? '' : ` (${choice.reason})`}`).join(', ')}.`
      return `${lines.join('; ')}.${tail} Ask the user which one before creating a Bot; a Bot keeps the engine it was created with until update_bot changes it.`
    },
  })

  shared.register({
    name: 'update_bot',
    description: 'Change a Bot\'s name, role, color, profile picture, model, thinking level, working folder, or instructions. Every Bot may change itself; only a Main Bot may change another Bot.',
    parameters: {
      bot: { type: 'string', description: 'Current name of the Bot to change; leave out to change yourself' },
      name: { type: 'string', description: 'New name' },
      role: { type: 'string', description: 'New role label' },
      instructions: { type: 'string', description: 'Replacement instructions' },
      color: { type: 'string', description: `One of ${[...COLORS, ...EXTRA_COLORS].join(', ')}` },
      avatar: { ...AVATAR_PARAM, description: `${AVATAR_PARAM.description} An empty string removes the photo and shows the Bot's character again.` },
      model: { type: 'string', description: 'Move the Bot to another model, as provider/model or a model id' },
      effort: { type: 'string', description: 'Thinking level for the Bot\'s model, as list_models shows; an empty string returns to the model\'s default' },
      engine: { type: 'string', description: 'Move the Bot to another engine, from list_engines. Leave it out to keep the one it has.' },
      work_dir: { ...WORK_DIR_PARAM, description: `${WORK_DIR_PARAM.description}; an empty string returns it to the team workspace` },
    },
    schema: z.object({
      bot: z.string().optional(), name: z.string().optional(), role: z.string().optional(),
      instructions: z.string().optional(), color: z.string().optional(), avatar: z.string().optional(),
      model: z.string().optional(), effort: z.string().optional(), engine: z.string().optional(), work_dir: z.string().optional(),
    }).passthrough(),
    async execute(args: UpdateBotArgs, context: ToolContext): Promise<string> {
      await t.load()
      const self = t.selfOf(context.sessionId)
      const caller = t.botOf(self)
      if (caller === undefined) return 'Only Bots on the team can use update_bot.'
      const bot = args.bot ? t.findBot(args.bot) : caller
      if (bot === undefined) return `No Bot named ${args.bot}.`
      if (bot.id !== caller.id && !t.isMain(self)) return 'Only a Main Bot can change another Bot. Leave out bot to change yourself, or ask a Main Bot with message_bot.'
      try {
        const { name: newName, role, instructions, color, model, effort } = args
        let image: string | null | undefined
        if (args.avatar !== undefined) {
          const input = typeof args.avatar === 'string' ? args.avatar.trim() : args.avatar
          const folder = t.sessionFolder(context.session ?? { id: context.sessionId })
          image = input === null || input === '' ? null : await readAvatar(String(input), { ...(folder !== undefined ? { baseDir: folder } : {}), isData: t.inData })
        }
        // An engine is only changed when it is named: leaving it out keeps the Bot where it is.
        const namedEngine = typeof args.engine === 'string' ? args.engine.trim() : ''
        const enginePicked = namedEngine === '' ? undefined : engineOf(namedEngine, engineChoices(catalog()), catalog())
        if (enginePicked !== undefined && !enginePicked.ok) return enginePicked.message
        const moving = typeof args.work_dir === 'string'
        const workDir = moving ? await t.cleanWorkDir(args.work_dir) : undefined
        if (moving && workDir !== bot.workDir) await t.approveFolder(context, { path: workDir, sessions: t.sessionsOfBot(bot.id), who: { en: bot.name, zh: ` ${bot.name} ` }, toolName: 'update_bot' })
        // The photo rides on the Bot's other avatar fields, as the settings page's upload
        // does: setting one keeps a custom character, and clearing removes only the image.
        // They are read here, after the waits above, so a change made meanwhile stays.
        const avatar = image === undefined ? undefined : { ...t.botOf(bot.id)?.avatar, image }
        const next = await t.updateBot(bot.id, { name: newName, role, instructions, color, ...(avatar !== undefined ? { avatar } : {}), ...(model ? { model } : {}), ...(effort === undefined ? {} : { effort }), ...(enginePicked === undefined ? {} : { engine: enginePicked.engine, runtimeId: enginePicked.runtimeId }), ...(moving ? { workDir: workDir ?? '' } : {}) })
        if (!moving) return `Updated ${next.name}.`
        const folder = workDir ?? 'the team workspace'
        return bot.id === caller.id ? `Updated ${next.name}. From your next step on, you work in ${folder}.` : `Updated ${next.name}. It now works in ${folder}.`
      } catch (error) {
        return `Could not update the Bot: ${errorMessage(error)}`
      }
    },
  })

  // the host's working_directory changes a Session's folder in place, and the next part starts in
  // the Bot's working folder again. A Bot that changes to a folder outside its working folder
  // sets its working folder instead, with update_bot's checks, and goes on in a fresh part
  // there; a folder inside it only moves this Session there.
  ctx.on<ToolExecuteEvent, ToolNext>('tools/execute', async (exec, next) => {
    // Resolved as the host gets it, untrimmed, so that both mean the same folder.
    const cd = exec.name === WORKING_DIRECTORY_TOOL && isRecord(exec.arguments) && typeof exec.arguments.cd === 'string' ? exec.arguments.cd : ''
    const session = exec.agent?.session
    if (cd === '' || session === undefined) return next()
    await t.load()
    const sessionId = exec.agent?.id ?? ''
    const bot = shared.callerBot({ sessionId, callId: '' })
    if (bot === undefined) return next()
    const room = t.roomOf(t.groupOwners.get(sessionId)?.roomId)
    const home = t.workDirOf({ botId: bot.id, roomId: room?.id }) ?? t.teamFolder?.()
    const target = await t.folderAt(t.sessionFolder(session), cd)
    if (target === undefined || !(await t.isFolder(target)) || home === undefined || within(target, await t.real(home))) return next()
    if (room?.workDir) throw new Error(`Every member of "${room.name}" works in ${room.workDir} here, so you stay inside it. The user or a Main Bot can change the group's folder.`)
    const readOnly = t.readOnly()
    if (readOnly !== undefined) throw new Error(`Your working folder cannot change now: ${readOnly}`)
    // Saved folders are trimmed like typed ones, so such a name would save another folder.
    if (unquote(target) !== target) throw new Error(`${JSON.stringify(target)} cannot be a working folder: its name starts or ends with a space or a quote mark.`)
    const workDir = await t.workFolder(target)
    await t.approveFolder(exec, { path: workDir, sessions: t.sessionsOfBot(bot.id), who: { en: bot.name, zh: ` ${bot.name} ` } })
    const result = await next()
    if (result?.isError !== true) await t.updateBot(bot.id, { workDir: workDir ?? '' })
    return result
  })
}

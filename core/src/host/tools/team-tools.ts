// Team tools: the roster, bot-to-bot messages and hand-offs, the Bot settings, and the
// model list. Group rounds and reading chats are in groups.js.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ToolContext } from '../../engine/registry.ts'
import type { ToolExecution } from '../dsh-types.js'
import type { HostRuntime, StoredBot } from '../runtime.ts'
import { readAvatar } from '../avatar.ts'
import { COLORS, EXTRA_COLORS } from '../constants.ts'
import { absoluteLinks } from '../links.ts'
import { unquote } from '../text.ts'
import { within } from '../folders.ts'
import {
  AVATAR_PARAM, WORK_DIR_PARAM, WORKING_DIRECTORY_TOOL,
  errorMessage, isRecord, stringOf, type ToolShared,
} from './shared.ts'

interface MessageBotArgs {
  readonly to?: string
  readonly message?: unknown
  readonly reply_to?: string
  readonly when?: string
}

interface StopBotArgs {
  readonly bot?: string
  readonly reason?: unknown
}

interface CreateBotArgs {
  readonly name?: string
  readonly role?: string
  readonly instructions?: string
  readonly brief?: unknown
  readonly model?: string
  readonly effort?: string
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
  readonly work_dir?: unknown
}

/** The `tools/execute` middleware's event: the tool call, with the arguments it passes. */
interface ToolExecuteEvent extends ToolExecution {
  readonly arguments?: unknown
}

type ToolNext = () => Promise<{ readonly isError?: boolean } | undefined>

export function installTeamTools(rt: HostRuntime, shared: ToolShared): void {
  const { ctx, state } = rt
  const t = shared.rt

  shared.register({
    name: 'list_bots',
    description: 'List every Bot on the user\'s team with its role, what it does and what it is doing right now, and the group chats you can see.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(_args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
      await t.load()
      const self = t.selfOf(context.sessionId)
      const lines = Object.values(state.bots).map(bot => {
        const model = bot.appliedModel ?? bot.model
        const tags = [bot.role, model ? `model ${model}` : '', bot.workDir ? `works in ${bot.workDir}` : '', t.isMain(bot.id) ? 'Main Bot' : '', bot.id === self ? 'you' : ''].filter(Boolean).join(', ')
        const job = bot.instructions ? ` — ${(bot.instructions.split('\n')[0] ?? '').slice(0, 120)}` : ''
        const now = bot.id === self ? '' : `\n  now: ${t.statusOf(bot.id)}`
        return `- ${bot.name}${tags ? ` (${tags})` : ''}${job}${now}`
      })
      if (lines.length === 0) return 'No Bots yet.'
      const rooms = shared.visibleRooms(self)
      return [
        'Bots:',
        ...lines,
        '',
        rooms.length === 0 ? 'Group chats: none you can see.' : 'Group chats:',
        ...rooms.map(room => shared.roomLine(room, self)),
      ].join('\n')
    },
  })

  shared.register({
    name: 'message_bot',
    description: 'Send a message to another Bot on the team. If that Bot is working, it reads your message at its next step and can change course, then answers once that work is done; if it is idle, it starts on it right away. Its reply arrives later as a new message to you; with reply_to "user" it answers the user in its own chat instead. In a group chat it reaches only members of that group, as writing "@Name" there does.',
    parameters: {
      to: { type: 'string', required: true, description: 'Exact Bot name from list_bots' },
      message: { type: 'string', required: true, description: 'Self-contained message; the other Bot cannot see this conversation' },
      reply_to: {
        type: 'string',
        enum: ['me', 'user'],
        description: '"me" (default): the reply comes back to you and the user does not see it. "user": the Bot answers the user in its own chat, where the user reads it, and nothing comes back to you. Use "user" whenever the user wants to hear from that Bot directly or asks Bots to say something in their own chats.',
      },
      when: {
        type: 'string',
        enum: ['now', 'queue'],
        description: '"now" (default): a working Bot reads your message at its next step, between its current actions, and answers once its current work is done; use it for questions, information it needs, corrections and warnings. "queue": it reads your message only after its current work is done, as a separate task; use it only for a new task unrelated to what it is doing now. With reply_to "user" the message always queues.',
      },
    },
    schema: z.object({
      to: z.string(), message: z.string(), reply_to: z.string().optional(), when: z.string().optional(),
    }).passthrough(),
    async execute(args: MessageBotArgs, context: ToolContext): Promise<string> {
      await t.load()
      const sender = shared.callerBot(context)
      if (sender === undefined) return 'Only Bots on the team can use message_bot.'
      const target = t.findBot(args.to)
      if (target === undefined) return `No Bot named ${args.to}. Team: ${Object.values(state.bots).map(bot => bot.name).join(', ')}`
      if (target.id === sender.id) return 'You cannot message yourself.'
      if (String(args.message ?? '').trim() === '') return 'Write a message to send.'
      const text = absoluteLinks(String(args.message), t.sessionFolder(context.session ?? { id: context.sessionId }))
      const room = shared.roomOfCaller(context)
      if (room !== undefined) return shared.callInGroup(context, room, sender, target, text.trim())
      const posted = shared.calledInPosts.get(context.sessionId)
      const postedIn = posted !== undefined && posted.turn === shared.turnOf(context) ? posted.calls.get(target.id) : undefined
      if (postedIn !== undefined) shared.refuse(`Not sent: you called ${target.name} in "${postedIn}" in this turn, and it works on that there. Send each task one way only; to add to it, post in that group.`)
      // Whoever waits for this work gets the answer by itself; a message there only
      // sends the work round in a circle.
      const works = shared.worksOf(context)
      if (t.upstreamOf(works).has(target.id)) {
        shared.refuse(`Not sent: ${target.name} is waiting for the result of the work you are doing, and your answer reaches it by itself. Finish the work and end your turn; to ask ${target.name} something, end your turn with the question.`)
      }
      const toUser = args.reply_to === 'user'
      const work = toUser ? undefined : works[0]
      const chat = t.chatOf(target.id)
      const agent = await t.resolveAgent(chat)
      const status = t.statusOf(target.id)
      // A request it has not read yet, sent for the same work, takes this one in, so
      // messages to a Bot that cannot read them do not pile up.
      const earlier = shared.unreadRequest(agent, sender.id, toUser)
      const joinable = earlier !== undefined && (toUser || t.sameWork(stringOf(earlier.message.source?.exchangeId), work))
      const before = joinable && earlier !== undefined ? shared.bodyOf(earlier.message) : undefined
      let long = await t.attachLong(before ? `${before.text}\n\n${text}` : text, `Message from ${sender.name}.txt`)
      if (long === undefined) return shared.tooLong(text)
      const joins = before !== undefined && earlier !== undefined && agent.inbox?.remove?.(earlier.message.id) === true
      if (before !== undefined && !joins) long = await t.attachLong(text, `Message from ${sender.name}.txt`) ?? long
      const working = t.live.get(chat)?.turn !== undefined
      const steer = (args.when !== 'queue' && !toUser) || (joins && earlier !== undefined && earlier.steered)
      const exchangeId = joins && earlier !== undefined
        ? stringOf(earlier.message.source?.exchangeId) ?? randomUUID()
        : randomUUID()
      if (joins) t.forgetDelivery?.(exchangeId)
      else if (!toUser) t.openWork(exchangeId, { from: sender.id, to: target.id, parent: work })
      try {
        await t.deliver({ fromId: sender.id, toId: target.id, text: long.text, files: [...long.files, ...(joins && before !== undefined ? before.files : [])], length: long.length, role: 'request', steer, exchangeId, ...(joins ? { merged: true } : {}), ...(toUser ? { audience: 'user' } : {}) })
      } catch (error) {
        if (!joins) t.dropWork(exchangeId)
        throw error
      }
      const sent = toUser
        ? `Delivered to ${target.name}. It will answer the user in its own chat; nothing comes back to you, so point the user to ${target.name}'s chat instead of relaying.`
        : working && steer
          ? `Delivered to ${target.name} while it is working: it reads your message at its next step and answers once that work is done. Its reply will arrive later as a new message; do not wait for it.`
          : working
            ? `Queued for ${target.name}: it reads your message after its current work. Its reply will arrive later as a new message; do not wait for it.`
            : `Delivered to ${target.name}. Its reply will arrive later as a new message; do not wait for it.`
      const asker = t.ownsWork(sender.id, work) ? t.botOf(shared.workFrom(work))?.name : undefined
      const notes = [
        joins ? `${target.name} had not read your earlier message yet, so this one was added to it, and it answers both at once.` : '',
        status === 'idle' ? '' : `${target.name} now: ${status}.`,
        asker ? `When you have handed on everything, end your turn: each reply brings you back to this work, and your answer goes to ${asker} once all of it is back.` : '',
      ].filter(Boolean)
      const out = [sent, ...notes].join(' ')
      // Messages reach a Bot's own chat only; work in a group goes on without them.
      const groups = shared.activeSessions(target.id).running.filter(sessionId => sessionId !== chat)
      if (groups.length === 0) return out
      const stop = t.isMain(sender.id) ? ' If it must not go on there, use stop_bot.' : ''
      return `${out} Your message does not reach its work in ${groups.map(shared.whereOf).join(' and ')}.${stop}`
    },
  })

  shared.register({
    name: 'stop_bot',
    description: 'Main Bot only. Stop another Bot\'s running turn immediately — when it must not finish a dangerous action and a message_bot warning is not enough. Its queued messages are dropped with the turn. It is then told why in a new turn, whose reply comes back to you.',
    parameters: {
      bot: { type: 'string', required: true, description: 'Exact Bot name from list_bots' },
      reason: { type: 'string', description: 'Why it was stopped; it reads this afterwards' },
    },
    schema: z.object({ bot: z.string(), reason: z.string().optional() }).passthrough(),
    async execute(args: StopBotArgs, context: ToolContext): Promise<string> {
      await t.load()
      const sender = shared.callerBot(context)
      if (sender === undefined || !t.isMain(sender.id)) shared.refuse('Only a Main Bot can stop other Bots.')
      const target = t.findBot(args.bot)
      if (target === undefined) shared.refuse(`No Bot named ${args.bot}. Team: ${Object.values(state.bots).map(bot => bot.name).join(', ')}`)
      if (target.id === sender.id) shared.refuse('You cannot stop yourself.')
      const { running } = shared.activeSessions(target.id)
      if (running.length === 0) shared.refuse(`${target.name} is not running right now, so there is nothing to stop. Use message_bot to reach it.`)
      for (const sessionId of running) {
        const agent = await t.resolveAgent(sessionId)
        agent.cancel({ kind: 'hook', reason: 'ds-bot/stopped' })
      }
      const why = String(args.reason ?? '').trim() || 'Stop what you are doing; the previous turn was ended on purpose. Acknowledge briefly.'
      await t.deliver({ fromId: sender.id, toId: target.id, text: why, role: 'stopped', ...shared.callerRoom(context) })
      return `Stopped ${target.name} in ${running.map(shared.whereOf).join(' and ')}. It is told why in a new turn, whose reply comes back to you.`
    },
  })

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
      work_dir: WORK_DIR_PARAM,
      avatar: AVATAR_PARAM,
    },
    schema: z.object({
      name: z.string(), role: z.string(), instructions: z.string(),
      brief: z.string().optional(), model: z.string().optional(), effort: z.string().optional(),
      work_dir: z.string().optional(), avatar: z.string().optional(),
    }).passthrough(),
    async execute(args: CreateBotArgs, context: ToolContext): Promise<string> {
      await t.load()
      if (!t.isMain(t.selfOf(context.sessionId))) return 'Only the Main Bot can create Bots. Ask the Main Bot instead.'
      let bot: StoredBot
      try {
        const folder = t.sessionFolder(context.session ?? { id: context.sessionId })
        const avatar = args.avatar ? await readAvatar(String(args.avatar), { ...(folder !== undefined ? { baseDir: folder } : {}), isData: t.inData }) : undefined
        const workDir = args.work_dir ? await t.cleanWorkDir(args.work_dir) : undefined
        const name = String(args.name ?? '').trim()
        await t.approveFolder(context, { path: workDir, who: { en: `the new Bot ${name}`, zh: `新 Bot ${name} ` }, toolName: 'create_bot' })
        // Without a named model the new Bot takes its creator's: the DSH default may be
        // a provider that has no key, and then the new Bot fails on its first reply.
        const creator = shared.callerBot(context)
        const served = creator?.model ? (await t.catalog()).some(entry => entry.ref === creator.model) : undefined
        const model = args.model || (served ? creator?.model : undefined)
        bot = await t.createBot({ ...args, avatar: avatar === undefined ? undefined : { image: avatar }, model, workDir, effort: args.effort, createdBy: creator?.id })
        return `Created ${bot.name}${workDir ? `, working in ${workDir}` : ''}. It is greeting the user now.`
      } catch (error) {
        return `Could not create the Bot: ${errorMessage(error)}`
      }
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
      work_dir: { ...WORK_DIR_PARAM, description: `${WORK_DIR_PARAM.description}; an empty string returns it to the team workspace` },
    },
    schema: z.object({
      bot: z.string().optional(), name: z.string().optional(), role: z.string().optional(),
      instructions: z.string().optional(), color: z.string().optional(), avatar: z.string().optional(),
      model: z.string().optional(), effort: z.string().optional(), work_dir: z.string().optional(),
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
        const moving = typeof args.work_dir === 'string'
        const workDir = moving ? await t.cleanWorkDir(args.work_dir) : undefined
        if (moving && workDir !== bot.workDir) await t.approveFolder(context, { path: workDir, sessions: t.sessionsOfBot(bot.id), who: { en: bot.name, zh: ` ${bot.name} ` }, toolName: 'update_bot' })
        // The photo rides on the Bot's other avatar fields, as the settings page's upload
        // does: setting one keeps a custom character, and clearing removes only the image.
        // They are read here, after the waits above, so a change made meanwhile stays.
        const avatar = image === undefined ? undefined : { ...t.botOf(bot.id)?.avatar, image }
        const next = await t.updateBot(bot.id, { name: newName, role, instructions, color, ...(avatar !== undefined ? { avatar } : {}), ...(model ? { model } : {}), ...(effort === undefined ? {} : { effort }), ...(moving ? { workDir: workDir ?? '' } : {}) })
        if (!moving) return `Updated ${next.name}.`
        const folder = workDir ?? 'the team workspace'
        return bot.id === caller.id ? `Updated ${next.name}. From your next step on, you work in ${folder}.` : `Updated ${next.name}. It now works in ${folder}.`
      } catch (error) {
        return `Could not update the Bot: ${errorMessage(error)}`
      }
    },
  })

  // DSH's working_directory changes a Session's folder in place, and the next part starts in
  // the Bot's working folder again. A Bot that changes to a folder outside its working folder
  // sets its working folder instead, with update_bot's checks, and goes on in a fresh part
  // there; a folder inside it only moves this Session there.
  ctx.on<ToolExecuteEvent, ToolNext>('tools/execute', async (exec, next) => {
    // Resolved as DSH gets it, untrimmed, so that both mean the same folder.
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

  shared.register({
    name: 'list_models',
    description: 'List the models a Bot can run on, as provider/model refs for create_bot and update_bot. A model in use also lists the thinking levels it serves.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(): Promise<string> {
      const models = await t.catalog({ fresh: true })
      if (models.length === 0) return 'No models are configured. Ask the user to add one in Settings → Models.'
      const fallback = t.defaultRef?.()
      // Only catalog entries that already carry `reasoning` (models a Bot runs on)
      // show levels; asking every model for its levels would take a call each.
      return models.map((entry) => {
        const levels = entry.reasoning?.efforts?.map(effort => effort.id) ?? []
        const thinking = levels.length > 0 ? `, thinking: ${levels.join(', ')}${entry.reasoning?.defaultEffort === undefined ? '' : ` (default: ${entry.reasoning.defaultEffort})`}` : ''
        return `- ${entry.ref}${entry.name !== entry.id ? ` (${entry.name})` : ''}${entry.input?.includes('image') ? ', reads images' : ''}${entry.ref === fallback ? ', default' : ''}${thinking}`
      }).join('\n')
    },
  })
}

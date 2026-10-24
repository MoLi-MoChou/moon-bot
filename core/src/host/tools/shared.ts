// The pieces every Bot tool module shares: the tool output shape and parameter blocks,
// the runtime methods the still-JS host modules install, and the small readers the tools
// use on the team (the caller, the visible groups, hand-off bodies).
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolRegistry, type ToolEntry } from '../../engine/registry.ts'
import { registerDshTool } from './dsh.ts'
import type { CapabilityStatus } from '../capabilities-mount.ts'
import type {
  Agent,
  AgentSession,
  AttachmentRef,
  InboxMessage,
  ToolParameter,
} from '../dsh-types.js'
import type {
  CapabilityItem,
  HostRuntime,
  LiveEntry,
  StoredBot,
  StoredRoom,
  StoredState,
  TurnInfo,
} from '../runtime.ts'
import { MESSAGE_INLINE_MAX, SOURCE_KIND } from '../constants.ts'
import { unquote } from '../text.ts'
import { LEAN_HIDDEN_TOOLS } from '../../shared/lean.ts'

/** What every tool answers: the value as the text the model reads. */
export interface ToolOutput {
  readonly schema: { readonly type: 'string' }
  readonly render: (args: Readonly<Record<string, unknown>>, value: unknown) => readonly { readonly type: 'text'; readonly text: string }[]
}

export const output: ToolOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

export const GROUP_REF: ToolParameter = { type: 'string', required: true, description: 'Exact group chat name from list_bots' }

export const BLOCKING_QUESTION_TOOL = 'ask_user_question'
// DS Bot carries no goal across conversation parts, so Bot Sessions do not run DSH goals.
const GOAL_TOOLS = ['create_goal', 'update_goal', 'get_goal']
// Moon Bot patch: plus the tools of the features LEAN hides (group chats, schedules).
export const HIDDEN_TOOLS: readonly string[] = [BLOCKING_QUESTION_TOOL, ...GOAL_TOOLS, ...LEAN_HIDDEN_TOOLS]
export const GOAL_REFUSAL = 'DS Bot does not run goals. Ask the Bot in a message instead.'
export const MODE_PARAM: ToolParameter = {
  type: 'string',
  enum: ['everyone', 'admin'],
  description: '"everyone": every member answers a plain message in turn, admin first. "admin" (the default): a plain message goes to the admin, who calls others with @Name. @mentions always choose who answers.',
}
export const WORK_DIR_PARAM: ToolParameter = { type: 'string', description: 'Full path of the folder to work in, where commands and file tools start. Only when the user asks for it' }
export const AVATAR_PARAM: ToolParameter = {
  type: 'string',
  description: 'Profile picture: a local image path (a relative path starts in your working folder) or a data URL. PNG, JPEG, WebP, or GIF; square, 256x256 recommended, up to 120 KB. Images are not resized.',
}
export const WORKING_DIRECTORY_TOOL = 'working_directory'

/** A long message that went as a DSH file, as delivery's `attachLong` answers. */
export interface AttachResult {
  readonly text: string
  readonly files: readonly AttachmentRef[]
  readonly length?: number
}

export interface OpenWorkOptions {
  readonly from?: string
  readonly to?: string
  readonly parent?: string | undefined
  readonly fromRoom?: string
  readonly room?: string
}

export interface ApproveFolderOptions {
  readonly path?: string | undefined
  readonly sessions?: readonly string[]
  readonly who: { readonly en: string; readonly zh: string }
}

export interface PostToRoomOptions {
  readonly reportBack?: boolean
  readonly member?: boolean
  readonly sub?: string
  readonly length?: number
  readonly resumed?: boolean
  readonly quiet?: boolean
  readonly again?: boolean
}

export interface RoomChange {
  readonly room: StoredRoom
  readonly changes: readonly string[]
}

/** What `sessionFolder` reads off a Session, or off an Agent standing in for one. */
export interface SessionFolderInput {
  readonly id?: string
  readonly header?: { readonly cwd?: unknown }
}

/**
 * The runtime the tools see: `HostRuntime` plus the methods `roster.js`, `handoffs.ts`,
 * `folders.ts`, `groups.js` and `capabilities.ts` put on it. Those modules run before (or
 * after) this one and install these at run time; the shared `HostRuntime` only carries the
 * slice earlier migrations needed.
 */
export interface ToolsRuntime extends HostRuntime {
  statusOf(botId: string): string
  roomStepText(sessionId: string, info: TurnInfo | undefined, text: string, first: boolean): Promise<void>
  workOf(info: TurnInfo | undefined): string | undefined
  sameWork(id: string | undefined, parent: string | undefined): boolean
  attachLong(text: string, name: string): Promise<AttachResult | undefined>
  openWork(id: string, options: OpenWorkOptions): void
  dropWork(id: string): void
  ownsWork(botId: string | undefined, workId: string | undefined): boolean
  upstreamOf(workIds: readonly string[]): ReadonlySet<string>
  roomBusy(roomId: string): boolean
  postToRoom(room: StoredRoom, bot: StoredBot, text: string, options: PostToRoomOptions, files?: readonly AttachmentRef[]): Promise<void>
  createBot(options: Readonly<Record<string, unknown>>): Promise<StoredBot>
  updateBot(id: string, patch: Readonly<Record<string, unknown>>): Promise<StoredBot>
  createRoom(options: Readonly<Record<string, unknown>>): Promise<StoredRoom>
  updateRoom(id: string, patch: Readonly<Record<string, unknown>>, actorId: string | undefined): Promise<RoomChange>
  deleteRoom(id: string): Promise<void>
  cleanWorkDir(input: unknown): Promise<string | undefined>
  approveFolder(exec: ToolRunContext, options: ApproveFolderOptions): Promise<void>
  sessionsOfBot(botId: string): readonly string[]
  workDirOf(options: { readonly botId?: string | undefined; readonly roomId?: string | undefined }): string | undefined
  sessionFolder(session: SessionFolderInput | AgentSession | undefined): string | undefined
  folderAt(base: string | undefined, input: string): Promise<string | undefined>
  isFolder(path: string): Promise<boolean>
  real(path: string): Promise<string>
  workFolder(path: string): Promise<string | undefined>
  inData(path: string): Promise<boolean>
  capabilityStatusesView(): Readonly<Record<string, Readonly<Record<string, CapabilityStatus>>>>
  capabilitySave(body: Readonly<Record<string, unknown>>, options: { readonly botId: string | undefined }): Promise<CapabilityItem>
  capabilityDelete(name: string | undefined, options: { readonly botId: string | undefined }): Promise<boolean>
  changeCapabilityAttachment(
    endpoint: string,
    body: { readonly name?: string | undefined; readonly bot?: string | undefined },
    callerId: string | undefined,
  ): Promise<{ readonly bot: string }>
}

export interface CalledInPosts {
  readonly turn: unknown
  readonly calls: Map<string, string>
}

export type PickRoomResult =
  | { readonly room: StoredRoom; readonly error?: undefined }
  | { readonly room?: undefined; readonly error: string }

export interface BodyOfMessage {
  readonly text: string
  readonly files: readonly AttachmentRef[]
}

/** One message's own words and files, without its header line. */
interface MessageBlock {
  readonly type?: string
  readonly text?: string
  readonly attachment?: AttachmentRef
}

export interface ToolShared {
  readonly rt: ToolsRuntime
  register(entry: ToolEntry): void
  readonly state: StoredState
  readonly calledInPosts: Map<string | undefined, CalledInPosts>
  callerBot(exec: ToolRunContext): StoredBot | undefined
  callerRoom(exec: ToolRunContext): { readonly fromRoomId?: string }
  roomOfCaller(exec: ToolRunContext): StoredRoom | undefined
  roomLine(room: StoredRoom, self: string | undefined): string
  visibleRooms(self: string | undefined): StoredRoom[]
  activeSessions(botId: string): { readonly running: readonly string[]; readonly idle: boolean }
  liveEntry(sessionId: string | undefined): LiveEntry | undefined
  whereOf(sessionId: string): string
  unreadRequest(agent: Agent, senderId: string, toUser: boolean): { readonly message: InboxMessage; readonly steered: boolean } | undefined
  bodyOf(message: InboxMessage): BodyOfMessage
  refuse(message: string): never
  worksOf(exec: ToolRunContext): readonly string[]
  tooLong(text: string): string
  callInGroup(exec: ToolRunContext, room: StoredRoom, sender: StoredBot, target: StoredBot, message: string): Promise<string>
  turnOf(exec: ToolRunContext): unknown
  hiddenTurn(sessionId: string): boolean
  workFrom(workId: string | undefined): string | undefined
  nameList(value: unknown): string[]
  resolveBots(refs: unknown): { readonly bots: StoredBot[]; readonly unknown: string[] }
  teamNames(): string
  groupNames(self: string | undefined): string
  pickRoom(ref: string | undefined, self: string | undefined): PickRoomResult
}

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export function createShared(host: HostRuntime, registry: ToolRegistry = new ToolRegistry()): ToolShared {
  const rt = host as ToolsRuntime
  const { state, ctx } = rt

  const callerBot = (exec: ToolRunContext): StoredBot | undefined => rt.botOf(rt.selfOf(exec.agent?.id))
  const callerRoom = (exec: ToolRunContext): { readonly fromRoomId?: string } => {
    const sessionId = exec.agent?.id
    const roomId = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)?.roomId
    return roomId ? { fromRoomId: roomId } : {}
  }
  const roomOfCaller = (exec: ToolRunContext): StoredRoom | undefined => {
    const sessionId = exec.agent?.id
    return sessionId === undefined ? undefined : rt.roomOf(rt.groupOwners.get(sessionId)?.roomId)
  }

  const roomLine = (room: StoredRoom, self: string | undefined): string => {
    const members = (room.members ?? []).map(id => rt.botOf(id))
      .filter((bot): bot is StoredBot => bot !== undefined)
      .map(bot => `${bot.name}${bot.id === room.admin ? ' (admin)' : ''}${bot.id === self ? ' (you)' : ''}`)
    const parts = [
      `members: ${members.join(', ')}`,
      room.mode === 'admin' && room.admin ? 'plain messages go to the admin first' : 'every member replies in turn',
      room.notice ? `notice: ${(room.notice.split('\n')[0] ?? '').slice(0, 100)}` : '',
      room.workDir ? `members work in ${room.workDir} here` : '',
      room.permission ? `members work with the ${room.permission} permissions here` : '',
    ].filter(Boolean)
    return `- "${room.name}" — ${parts.join('; ')}`
  }
  // Main Bots see every group; other Bots see the groups they are in.
  const visibleRooms = (self: string | undefined): StoredRoom[] =>
    Object.values(state.rooms).filter(room => rt.isMain(self) || (self !== undefined && (room.members ?? []).includes(self)))

  const liveEntry = (sessionId: string | undefined): LiveEntry | undefined =>
    (sessionId === undefined ? undefined : rt.live.get(sessionId))

  const whereOf = (sessionId: string): string => {
    const room = rt.roomOf(rt.groupOwners.get(sessionId)?.roomId)
    return room ? `group "${room.name}"` : 'its own chat'
  }

  // Sessions a Bot is running in right now: its own chat plus each group Session
  // with a live turn. An idle Bot reports just its own chat.
  const activeSessions = (botId: string): { readonly running: readonly string[]; readonly idle: boolean } => {
    const running = [...new Set([rt.chatOf(botId), ...rt.groupSessionsOf(botId)])]
      .filter(sessionId => rt.live.get(sessionId)?.turn !== undefined)
    return { running, idle: running.length === 0 }
  }

  // A Bot request still in the inbox: no step or turn has taken it out yet.
  const unreadRequest = (
    agent: Agent,
    senderId: string,
    toUser: boolean,
  ): { readonly message: InboxMessage; readonly steered: boolean } | undefined => {
    const messages: readonly (readonly [InboxMessage, boolean])[] = [
      ...(agent.inbox?.nextStep ?? []).map((message): readonly [InboxMessage, boolean] => [message, true]),
      ...(agent.inbox?.nextTurn ?? []).map((message): readonly [InboxMessage, boolean] => [message, false]),
    ]
    for (const [message, steered] of messages) {
      const source = message.source
      if (source?.kind === SOURCE_KIND && source.role === 'request' && source.senderSessionId === senderId
        && (source.audience === 'user') === toUser && !source.deferred && !source.resumed) return { message, steered }
    }
    return undefined
  }

  const bodyOf = (message: InboxMessage): BodyOfMessage => {
    const content: readonly MessageBlock[] = Array.isArray(message.content) ? message.content : []
    const first = content.find(block => block.type === 'text')?.text ?? ''
    return {
      text: first.slice(first.indexOf('\n') + 1),
      files: content.flatMap(block => (block.type === 'file' && block.attachment !== undefined ? [block.attachment] : [])),
    }
  }

  // A tool that throws shows as failed in the chat, instead of as sent or stopped.
  const refuse = (message: string): never => { throw new Error(message) }

  // The works (handoffs.ts) the calling turn does: what it answers, and the requests
  // that joined it.
  const worksOf = (exec: ToolRunContext): readonly string[] => {
    const turn = liveEntry(exec.agent?.id)
    return [rt.workOf(turn?.info), ...(turn?.joined ?? []).map(joined => rt.workOf(joined.info))]
      .filter((id): id is string => id !== undefined)
  }
  const tooLong = (text: string): string => `Not sent: the message has ${text.length} characters, more than ${MESSAGE_INLINE_MAX}, and this DeepSeek Harness cannot send it as a file. Write it to a file in your working folder and send its path instead.`

  // Work for a group stays in it: from a group Session, message_bot calls a member there
  // exactly as an "@Name" line would, and never reaches a Bot outside the group.
  const callInGroup = async (exec: ToolRunContext, room: StoredRoom, sender: StoredBot, target: StoredBot, message: string): Promise<string> => {
    if (!(room.members ?? []).includes(target.id)) {
      const add = rt.isMain(sender.id) || rt.isAdminOf(room, sender.id) ? ', or add it yourself with update_group first' : ''
      refuse(`Not sent: ${target.name} is not in "${room.name}", and work for this group stays in it. Ask the user to add ${target.name} to the group${add}.`)
    }
    const call = `@${target.name}`
    const sessionId = exec.agent?.id
    if (sessionId === undefined) return refuse('Not sent: only a Bot working in the group can call a member there.')
    await rt.roomStepText(sessionId, rt.live.get(sessionId)?.info, message.startsWith(call) ? message : `${call} ${message}`, false)
    return `Called ${target.name} in "${room.name}" with your message, as writing "${call}" there does: it works on it in the group, and you answer its result there. Nothing went to its own chat.`
  }

  // The Bots each Session's post_to_group called by name in its current turn, so that
  // turn does not also send them the same work in their own chats.
  const turnOf = (exec: ToolRunContext): unknown => liveEntry(exec.agent?.id)?.turn

  const hiddenTurn = (sessionId: string): boolean => {
    const turn = rt.live.get(sessionId)?.turn
    return typeof turn === 'number' && (state.exchangeTurns[sessionId] ?? []).includes(turn)
  }

  const workFrom = (workId: string | undefined): string | undefined =>
    (workId === undefined ? undefined : state.works?.[workId]?.from)

  // Group tools take Bot names as an array, or as one comma-separated string from
  // models that flatten it.
  const nameList = (value: unknown): string[] => {
    const items: readonly unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、]/) : []
    return items.map(item => String(item ?? '').trim()).filter(Boolean)
  }
  const resolveBots = (refs: unknown): { readonly bots: StoredBot[]; readonly unknown: string[] } => {
    const bots: StoredBot[] = []
    const unknown: string[] = []
    for (const ref of nameList(refs)) {
      const bot = rt.findBot(ref)
      if (bot === undefined) unknown.push(ref)
      else if (!bots.includes(bot)) bots.push(bot)
    }
    return { bots, unknown }
  }
  const teamNames = (): string => Object.values(state.bots).map(bot => bot.name).join(', ')
  const groupNames = (self: string | undefined): string =>
    visibleRooms(self).map(room => `"${room.name}"`).join(', ') || 'none'
  const pickRoom = (ref: string | undefined, self: string | undefined): PickRoomResult => {
    const matches = rt.findRooms(ref).filter(room => visibleRooms(self).includes(room))
    const room = matches[0]
    if (matches.length === 1 && room !== undefined) return { room }
    if (matches.length > 1) return { error: `Several group chats are called "${unquote(ref)}". Rename one first.` }
    return { error: `No group chat called "${unquote(ref)}" that you can see. Groups: ${groupNames(self)}.` }
  }

  return {
    rt, state, calledInPosts: new Map<string | undefined, CalledInPosts>(),
    register: (entry: ToolEntry): void => {
      registry.register(entry); registerDshTool(ctx, entry, rt)
    },
    callerBot, callerRoom, roomOfCaller, roomLine, visibleRooms, activeSessions, whereOf,
    unreadRequest, bodyOf, refuse, worksOf, tooLong, callInGroup, turnOf, hiddenTurn, workFrom, liveEntry,
    nameList, resolveBots, teamNames, groupNames, pickRoom,
  }
}

// Group chats: the public surface the rest of the host imports, the group tools
// (group_relay, read_own_chat, read_group_chat). The runtime slice they use is in
// `groups/types.ts`.
//
// The room itself lives in `groups/log.ts` (the log, members' group Sessions, prompts,
// and posts), the rounds in `groups/rounds.ts`, the shared text rules in
// `groups/notice.ts`, and the shapes they all use in `groups/types.ts`.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createUserMessage } from './llm-bits.ts'
import { SOURCE_KIND, TEXT_KEPT } from './constants.ts'
import { headOf } from './text.ts'
import type { ToolContext } from '../engine/registry.ts'
import type { StoredBot, TurnInfo } from './runtime.ts'
import { failureLine, failureSay, fileLine, lineText, mentionsIn, transcript } from './groups/notice.ts'
import type { FailureDetail, GroupRoom, GroupRound, GroupRuntime, RoomLine, RoomPost } from './groups/types.ts'
import { ROOM_LOG_MAX, ensureRoomLog, installRoomLog } from './groups/log.ts'
import { installRounds } from './groups/rounds.ts'
import type { RelayContext, ReadOwnChatArgs, ReadGroupChatArgs } from './groups-types.ts'

export { isPass, mentionsIn, referenceNote, stripOwnName } from './groups/notice.ts'
export type {
  FailureDetail,
  GroupReply,
  GroupRoom,
  GroupRound,
  GroupSlot,
  MemberSession,
  ReadyRoom,
  RoomLine,
  RoomPost,
  RoomReference,
  RoomTurnResult,
  RoomWaiter,
  SlotStatus,
  StartedTurn,
} from './groups/types.ts'

const GROUP_REF = { type: 'string', required: true, description: 'Exact group chat name from list_bots' }
const ROOM_READ_MAX = 30

export function install(rt: GroupRuntime): void {
  const { ctx } = rt

  async function reportRound(room: GroupRoom, post: RoomPost, round: GroupRound): Promise<void> {
    if (post.botId === undefined) return
    const lines = round.replies.filter(reply => reply.kind === undefined).map(reply => `${reply.name}: ${reply.text}`)
    const waiting = round.replies.filter(reply => reply.kind === 'approval').map(reply => reply.name)
    const working = round.replies.filter(reply => reply.kind === 'working').map(reply => reply.name)
    const text = [
      lines.length > 0 ? `Replies to your post (oldest first):\n${lines.join('\n')}` : 'Nobody replied to your post.',
      working.length > 0 ? `Still working on it: ${working.join(', ')}. Each posts its result in the group when done, not to you; read_group_chat shows it.` : '',
      waiting.length > 0 ? `Waiting for the user's approval: ${waiting.join(', ')}. What they say afterwards is posted in the group, not sent to you; read_group_chat shows it.` : '',
      round.passed.length > 0 ? `Stayed silent: ${round.passed.join(', ')}.` : '',
      round.failed.length > 0
        ? `Could not answer because their model call failed: ${round.replies
            .filter(reply => reply.kind === 'failed')
            .map(reply => `${reply.name} (${failureLine({ code: reply.code, status: reply.status, message: reply.text })})`)
            .join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    // Replies the poster waited for go on with the work it posted for.
    const work = post.sub === undefined ? undefined : rt.closeWork?.(post.sub, `Group "${room.name}"`, text)
    await rt.deliver({ toId: post.botId, role: 'report', roomId: room.id, text, ...(work ? { work, replyTo: post.sub } : {}) }).catch(error => rt.warn('moon-bot: group report to %s failed: %s', post.name, error))
  }

  // The user stops a member's work in this group from the group's details. Messages
  // still waiting for that member here go with it.
  async function stopMemberWork(roomId: string, botId: string): Promise<boolean> {
    await rt.load()
    const room = rt.roomOf(roomId)
    const member = rt.botOf(botId)
    const sessionId = rt.own(room?.sessions, botId)
    if (room === undefined || member === undefined || sessionId === undefined || rt.live.get(sessionId)?.turn === undefined) return false
    const agent = await rt.resolveAgent(sessionId)
    agent.cancel({ kind: 'user' })
    await log.postToRoom(room, member, '', { quiet: true, stopped: true })
    return true
  }
  rt.stopMemberWork = stopMemberWork

  // The round said such a member posts when done; a failed model call is how it ended.
  // Nobody answers it.
  async function lateRoomFailure(sessionId: string, info: TurnInfo, failure: FailureDetail): Promise<void> {
    const owner = rt.groupOwners.get(sessionId)
    const room = rt.roomOf(owner?.roomId ?? info.roomId)
    const member = rt.botOf(owner?.botId)
    if (room === undefined || member === undefined || !room.members.includes(member.id)) return
    const { code, status, message } = failure
    const zh = String(rt.uiLanguage?.() ?? '').startsWith('Chinese')
    await log
      .postToRoom(room, member, zh ? `没能做完：${failureSay(failure, true)}。` : `Could not finish: ${failureSay(failure)}.`, {
        late: true,
        quiet: true,
        failed: { code, ...(status ? { status } : {}), message },
      })
      .catch(error => rt.warn('moon-bot: late group failure from %s failed: %s', member.name, error))
  }
  rt.lateRoomFailure = lateRoomFailure

  // A group the user just made opens with its admin asking what the group is for.
  async function greetRoom(roomId: string): Promise<void> {
    const room = rt.roomOf(roomId)
    if (!room?.admin) return
    const agent = await rt.resolveAgent(room.id)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: '[Group chat created]' }],
        source: { kind: SOURCE_KIND, form: 'relay', role: 'kickoff', exchangeId: randomUUID(), senderName: 'You', roomId: room.id },
      }),
    )
    await ctx.sessions.flush(agent.session)
  }
  rt.greetRoom = greetRoom

  rt.registerTool({
    name: 'group_relay',
    description: 'Group chat relay only. Deliver the latest user message to the Bots in this group chat, one at a time, and collect their replies.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(_args: Readonly<Record<string, unknown>>, context: RelayContext): Promise<string> {
      await rt.load()
      const room = rt.roomOf(context.sessionId)
      if (room === undefined) return JSON.stringify({ error: 'Not a group chat' })
      if (typeof room.archivedAt === 'number') return JSON.stringify({ error: 'This group chat is archived' })
      ensureRoomLog(room)
      // Everything queued since the last relay is posted in order, so messages that the
      // Session folds into one turn are not lost; the newest one picks the speakers.
      const queued = rt.roomInbox.get(room.id) ?? []
      rt.roomInbox.delete(room.id)
      const posts: RoomPost[] = queued.length > 0 ? queued : [{ text: '' }]
      // A post a running round already logged stays inside the round this relay opens.
      const loggedSeqs = posts.flatMap(post => (typeof post.logged === 'number' ? [post.logged] : []))
      const startSeq = Math.min(room.seq + 1, ...loggedSeqs)
      // The opening greeting is a cue for the admin, not a line of the group; a member's
      // late failure, its work picked up after a restart, its work the user stopped, or
      // the end of work whose result it already posted is an event of the round.
      const event = (item: RoomPost): boolean => item.failed !== undefined || item.resumed === true || item.stopped === true || item.done === true
      for (const post of posts.filter(item => !item.kickoff && !event(item) && item.logged === undefined)) {
        // Image readings go into the log only; `@` names are picked from what the user typed.
        // A file stays with its line and reaches each member the line is shown to.
        const readings = post.images === undefined ? [] : await rt.imagesForGroup(post.images, room.id)
        const text = [post.text, ...readings, ...(post.files ?? []).map(fileLine)].filter(Boolean).join('\n')
        log.appendRoom(room, {
          ...(post.botId ? { who: rt.botOf(post.botId)?.name ?? post.name ?? 'Bot', botId: post.botId } : { who: 'User' }),
          text,
          ...(post.files === undefined ? {} : { files: post.files }),
        })
      }
      if (posts.some(post => !post.botId && !post.kickoff)) room.lateRounds = 0
      await rt.save()
      // An event post, and a member post that calls nobody, never pick the speakers
      // over a message queued with them.
      const callsNobody = (post: RoomPost): boolean => post.member === true && rounds.openingSpeakers(room, post).length === 0
      const opener = lastPost(posts, post => !event(post) && !callsNobody(post)) ?? lastPost(posts, post => !event(post)) ?? posts.at(-1)
      if (opener === undefined) return JSON.stringify({ replies: [], passed: [] })
      const references = posts.flatMap(post => post.references ?? [])
      // A member a Bot's post calls by name works for that Bot.
      const named = opener.botId === undefined ? [] : mentionsIn(opener.text ?? '', room.members.map(rt.botOf).filter(isBot)).found
      const round: GroupRound = {
        roomId: room.id,
        members: room.members,
        startSeq,
        ...(opener.kickoff ? { kickoff: true } : {}),
        ...(references.length > 0 ? { references, shown: [] } : {}),
        slots: rounds.openingSpeakers(room, opener).map(member => ({
          id: member.id,
          name: member.name,
          status: 'waiting',
          ...(opener.kickoff ? { note: 'the group was just created' } : {}),
          ...(named.includes(member) ? { by: opener.botId } : {}),
          ...(opener.done ? { note: `${opener.name ?? 'a member'} finished the work you asked for` } : {}),
        })),
        speaking: null,
        turns: 0,
        replies: [],
        passed: [],
        failed: [],
        started: [],
      }
      for (const post of posts.filter(item => item.failed !== undefined && item.logged === undefined)) {
        const failed = post.failed
        if (failed === undefined) continue
        const bot = rt.botOf(post.botId)
        const { code, status, message } = failed
        round.failed.push(bot?.name ?? post.name ?? 'Bot')
        round.replies.push({ kind: 'failed', botId: post.botId, name: bot?.name ?? post.name, color: bot?.color, code, ...(status ? { status } : {}), text: message, time: Date.now() })
      }
      // The log line tells the admin and the other members on their next turn.
      for (const post of posts.filter(item => (item.resumed === true || item.stopped === true || item.done === true) && item.logged === undefined)) {
        const bot = rt.botOf(post.botId)
        const name = bot?.name ?? post.name
        const kind = post.done ? 'done' : post.stopped ? 'stopped' : post.again ? 'cut' : 'resumed'
        log.appendRoom(room, { who: name, botId: post.botId, kind, text: '' })
        round.replies.push({ kind, botId: post.botId, name, color: bot?.color, time: Date.now() })
      }
      if (posts.some(post => post.resumed || post.stopped || post.done)) await rt.save()
      const signal = context.signal ?? new AbortController().signal
      rt.roomProgress.set(context.callId, round)
      try {
        await rounds.runRound(room, round, signal, context.agent)
      } catch (error) {
        rt.warn('moon-bot: group round in %s stopped: %s', room.name, error)
      } finally {
        rt.roomProgress.delete(context.callId)
      }
      if (signal.aborted) {
        for (const turn of round.started) void rt.stopRoomTurn?.(room.sessions?.[turn.botId] ?? turn.sessionId, turn.exchangeId)
      }
      await rt.save()
      for (const post of posts) {
        if (post.reportBack && rt.botOf(post.botId)) void reportRound(room, post, round)
      }
      context.concludeTurn?.()
      return JSON.stringify({ replies: round.replies, passed: round.passed, ...(round.failed.length > 0 ? { failed: round.failed } : {}) })
    },
  })

  // Private context enters a group only through this tool, and the group sees each use.
  rt.registerTool({
    name: 'read_own_chat',
    description:
      'Read or search your own chat with the user, across all its parts, including earlier parts that left your working context. Each line starts with its anchor, such as [part 2 #1234 · 10-08 14:22]; long messages are cut. Pass the anchor as around to read that message in full, with what was said just before and after it. In a group chat the group sees that you looked, so share only what the group needs.',
    parameters: {
      query: { type: 'string', description: 'Words to look for in every part, separated by spaces. A message must have all of them; when none has, those with the most are shown. Omit for the latest messages' },
      around: { type: 'string', description: 'An anchor from an earlier result, such as "part 2 #1234": shows that message in full and the messages just before and after it' },
      part: { type: 'integer', description: 'Number of an earlier part: shows the handoff note you wrote when it ended' },
    },
    schema: z
      .object({
        query: z.string().optional(),
        around: z.string().optional(),
        part: z.number().int().optional(),
      })
      .passthrough(),
    async execute(args: ReadOwnChatArgs, context: ToolContext): Promise<string> {
      await rt.load()
      const id = context.sessionId
      const owner = rt.groupOwners.get(id)
      const botId = owner?.botId ?? rt.chatOwners.get(id)
      if (botId === undefined) return 'Only Bots on the team can use read_own_chat.'
      const member = rt.botOf(botId)
      const room = rt.roomOf(owner?.roomId)
      const query = String(args.query ?? '')
        .trim()
        .slice(0, 80)
      const around = String(args.around ?? '')
        .trim()
        .slice(0, 40)
      const parts = rt.partsOf(botId)
      const number = typeof args.part === 'number' && Number.isInteger(args.part) ? args.part : undefined
      if (room !== undefined && member !== undefined) {
        ensureRoomLog(room)
        const text = query !== '' ? query : around !== '' ? `around ${around}` : number !== undefined ? `part ${number}` : ''
        log.appendRoom(room, { who: member.name, botId: member.id, kind: 'lookup', text })
        for (const round of rt.roomProgress.values()) {
          if (round.roomId === room.id) round.replies.push({ kind: 'lookup', botId: member.id, name: member.name, color: member.color, text, time: Date.now() })
        }
        void rt.save().catch(() => {})
      }
      const partsNote = parts.length > 1 ? `\n\nYour own chat has ${parts.length} parts: ${rt.partIndex(parts)}. Call read_own_chat with part N for the note that closed an earlier part, or with words to search all parts.` : ''
      if (query === '' && around !== '') {
        const found = await rt.aroundOwnChat(botId, around)
        if ('error' in found) return `${found.error}${partsNote}`
        if (found.lines.length === 0) return `Nothing was said around ${around}.${partsNote}`
        const heading = found.exact ? `around ${around}` : `with no message at ${around}; the nearest ones`
        return `Your own chat ${heading} (oldest first):\n${found.lines.join('\n')}${partsNote}`
      }
      if (query === '' && number !== undefined) {
        const part = parts[number - 1]
        if (part === undefined) return `Your own chat has no part ${number}.${partsNote}`
        if (part.endedAt === undefined) return `Part ${number} is the current one; it is in your context.${partsNote}`
        return `Part ${number} of your own chat (${rt.clock(part.startedAt)} – ${rt.clock(part.endedAt)}). The handoff note that closed it:\n${rt.noteText(part) ?? '(none: the part ended on a context overflow)'}${partsNote}`
      }
      if (query === '') {
        const lines = await rt.latestOwnChat(botId, { askingId: id })
        return lines.length === 0 ? `Your own chat is empty.${partsNote}` : `Your own chat (oldest first):\n${lines.join('\n')}${partsNote}`
      }
      const { lines, every } = await rt.searchOwnChat(botId, query, { askingId: id })
      if (lines.length === 0) return `Nothing in your own chat mentions "${query}".${partsNote}`
      const heading = every ? `messages mentioning "${query}"` : `no message has all of "${query}"; messages with the most of these words`
      return `Your own chat, ${heading} (oldest first):\n${lines.join('\n')}${partsNote}`
    },
  })

  rt.registerTool({
    name: 'read_group_chat',
    description: 'Read the latest messages of a group chat, including what you said there. You speak in groups from separate conversations, so your own chat does not show them. Main Bots may read any group; others the groups they are in.',
    parameters: {
      group: GROUP_REF,
      seq: { type: 'integer', description: 'Read one message whole: the seq that a cut message names' },
    },
    schema: z.object({ group: z.string(), seq: z.number().int().optional() }).passthrough(),
    async execute(args: ReadGroupChatArgs, context: ToolContext): Promise<string> {
      await rt.load()
      const self = rt.selfOf(context.sessionId)
      if (rt.botOf(self) === undefined) return 'Only Bots on the team can read group chats.'
      const picked = rt.pickRoom(args.group, self)
      if ('error' in picked) return picked.error
      const room = picked.room
      ensureRoomLog(room)
      await log.loadGroupLines(room)
      if (args.seq !== undefined) {
        const line = room.log.find(entry => entry.seq === Number(args.seq))
        return line === undefined ? `"${room.name}" no longer keeps message ${args.seq}; it keeps its latest ${ROOM_LOG_MAX}.` : lineText(line, log.memberText(room)(line))
      }
      // Thirty whole lines could fill the context, so a long one shows its start.
      const short = (line: RoomLine): string => {
        const length = line.length ?? line.text.length
        return length <= TEXT_KEPT ? line.text : `${headOf(line.text, TEXT_KEPT)}… (cut; ${length} characters in all; read_group_chat with seq ${line.seq} reads it whole)`
      }
      const lines = room.log.slice(-ROOM_READ_MAX)
      return lines.length === 0 ? `"${room.name}" has no messages yet.` : `Latest in "${room.name}" (oldest first):\n${transcript(lines, short)}`
    },
  })

  // The step-line effect and the relay listener are registered after the tools, as
  // they were before, so the plugin's registration order stays fixed.
  const log = installRoomLog(rt)
  const rounds = installRounds(rt, log)
}

const isBot = (bot: StoredBot | undefined): bot is StoredBot => bot !== undefined

// `findLast` is newer than the ES2022 lib this project compiles against; the order and
// result are the same as Array.prototype.findLast.
function lastPost(items: readonly RoomPost[], test: (post: RoomPost) => boolean): RoomPost | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && test(item)) return item
  }
  return undefined
}

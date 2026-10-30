// Group chat rounds: the speaking order, the member turns, who a post calls next, and
// the relay step that opens a round.
//
// A group chat is one shared, ordered conversation, so members speak one at a time: a
// turn starts only after the previous speaker has posted or passed, and it shows
// everything that arrived since that member last looked, plus the speaking order and
// the member's place in it. Nobody answers a room that has moved on, and nobody has to
// count lines to know who went before. A plain message goes to every member in roster
// order, admin first, or to the admin alone in admin mode; "@Name" picks members. A
// reply that @mentions a member calls that member next, bounded per member and per
// round; the admin's calls reach further.
//
// Work does not hold a round up: a member that is still busy with tools a little after
// it started, or that is called while still at earlier work, lets the round go on. Its
// turn keeps running in its group Session, and what it ends with is posted to the group,
// where the member that asked for it answers.
import { randomUUID } from 'node:crypto'
import { ROOM_REPLY_TIMEOUT_MS, ROOM_WORK_GRACE_MS, SOURCE_KIND, TEAM_TOOLS } from '../constants.ts'
import type { Agent, AttachmentRef } from '../host-types.js'
import type { StoredBot } from '../runtime.ts'
import type { GroupRuntime } from './types.ts'
import { textOf } from '../text.ts'
import { isPass, lostSession, mentionsIn, stripOwnName } from './notice.ts'
import { openingSpeakersOf } from './speakers.ts'
import type { FailureDetail, GroupRoom, GroupRound, GroupSlot, MemberSession, ReadyRoom, RoomPost, RoomTurnResult, RoomWaiter } from './types.ts'
import type { RoomLogApi } from './log.ts'

interface RelayOptions {
  readonly sessionId?: string | undefined
  readonly purpose?: unknown
  readonly messages: readonly { readonly role?: string | undefined; readonly source?: { readonly kind?: unknown; readonly role?: unknown } | undefined }[]
  readonly tools?: readonly { readonly name: string }[] | undefined
}

interface RelayMessage {
  readonly role?: string | undefined
  readonly source?: { readonly kind?: unknown; readonly role?: unknown } | undefined
}

interface RelayChunk {
  readonly type: string
  readonly [key: string]: unknown
}

const ROOM_EXTRA_TURNS = 4
const ROOM_ADMIN_EXTRA_TURNS = 4
const ROOM_TURNS_EACH = 2
const ROOM_ADMIN_TURNS_EACH = 4

/** The round helpers the group tool surface calls. */
export interface RoundsApi {
  readonly openingSpeakers: (room: GroupRoom, opener: RoomPost) => StoredBot[]
  readonly runRound: (room: ReadyRoom, round: GroupRound, signal: AbortSignal, agent: Agent | undefined) => Promise<void>
}

export function installRounds(rt: GroupRuntime, log: RoomLogApi): RoundsApi {
  const { ctx } = rt
  const messageOf = (error: unknown): string => {
    const raw = error !== null && typeof error === 'object' ? (error as { readonly message?: unknown }).message : undefined
    return String(raw ?? error).slice(0, 300)
  }
  const isTextBlock = (block: unknown): boolean => block !== null && typeof block === 'object' && (block as { readonly type?: unknown }).type === 'text'

  // A member's message in the round is in the log and in the round's replies already;
  // this turn only waits for the member's Session to end it.
  async function roomTurn(
    room: ReadyRoom,
    member: StoredBot,
    sessionId: string,
    { text, files }: { readonly text: string; readonly files: readonly AttachmentRef[] },
    note: string,
    signal: AbortSignal,
    round: GroupRound,
    by: string | undefined,
    said: string[] = [],
  ): Promise<RoomTurnResult> {
    if (signal.aborted) return null
    const startedAt = Date.now()
    const exchangeId = randomUUID()
    const turn = { botId: member.id, sessionId, exchangeId }
    const { started } = round
    started.push(turn)
    // Checked before the delivery, which may start the turn at once. Advance the
    // transcript watermark only after delivery succeeds; a failed delivery must be
    // replayed to the member's next session.
    const busy = rt.live.get(sessionId)?.turn !== undefined
    const done = new Promise<RoomTurnResult>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let grace: ReturnType<typeof setTimeout> | undefined
      const finish = (value: RoomTurnResult): void => {
        clearTimeout(timer)
        clearTimeout(grace)
        rt.roomWaiters.delete(exchangeId)
        resolve(value)
      }
      const touch = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => finish({ missed: true }), ROOM_REPLY_TIMEOUT_MS)
      }
      const work = (): void => {
        grace ??= setTimeout(() => finish({ working: true }), ROOM_WORK_GRACE_MS)
      }
      const say = (raw: string): void => {
        const step = stripOwnName(member.name, raw)
        if (isPass(step)) return
        said.push(step)
        log.postInRound(room, round, member, step, Date.now() - startedAt)
      }
      touch()
      rt.roomWaiters.set(exchangeId, { sessionId, botId: member.id, roomId: room.id, resolve: finish, fail: (failure: FailureDetail) => finish({ failure }), touch, work, say, approval: () => finish({ approval: true }) })
      signal.addEventListener('abort', () => finish(null), { once: true })
    })
    try {
      await rt.deliver({ fromId: undefined, toId: member.id, sessionId, role: 'room', roomId: room.id, exchangeId, note, text, files, ...(by ? { askedBy: by } : {}) })
      room.seen[member.id] = room.seq
      // Still held by an earlier request: this turn cannot start until the user answers.
      if (rt.waitsForApproval?.(sessionId)) rt.roomWaiters.get(exchangeId)?.approval()
      // Still at earlier work: the call waits in its inbox and is answered after that.
      else if (busy) rt.roomWaiters.get(exchangeId)?.resolve({ working: true })
    } catch (error) {
      rt.warn('moon-bot: group delivery to %s failed: %s', member.name, error)
      // A delivery that failed is not a pass: the round shows it. Nothing here can
      // repair a lost Session, so the member's next turn in the group starts a new one.
      const lost = lostSession(error)
      if (lost && room.sessions?.[member.id] === sessionId) {
        rt.retireGroupSession(room, member.id)
        void rt.save().catch(() => {})
      }
      const raw = error !== null && typeof error === 'object' ? (error as { readonly message?: unknown }).message : undefined
      rt.roomWaiters.get(exchangeId)?.fail({ code: lost ? 'SESSION_RESET' : 'SESSION', message: String(raw ?? error).slice(0, 300) })
    }
    const reply = await done
    // A turn that ended leaves nothing for a stop to cancel.
    if (typeof reply === 'string' || (typeof reply === 'object' && reply !== null && 'failure' in reply)) started.splice(started.indexOf(turn), 1)
    if (reply === null || typeof reply === 'object') return reply
    return stripOwnName(member.name, String(reply ?? '').trim())
  }

  // A member that reaches its context limit mid-turn goes on in a fresh Session, so a
  // waiter is also found by the member and group that Session now speaks for.
  const waitersOf = (sessionId: string): RoomWaiter[] => {
    const owner = rt.groupOwners.get(sessionId)
    return [...rt.roomWaiters.values()].filter(waiter => waiter.sessionId === sessionId || (owner !== undefined && waiter.botId === owner.botId && waiter.roomId === owner.roomId))
  }
  rt.touchRoomTurn = (sessionId: string): void => {
    for (const waiter of waitersOf(sessionId)) waiter.touch()
  }
  rt.failRoomTurn = (sessionId: string, failure: FailureDetail): boolean => {
    const waiters = waitersOf(sessionId)
    for (const waiter of waiters) waiter.fail(failure)
    return waiters.length > 0
  }
  rt.yieldRoomTurn = (sessionId: string): void => {
    for (const waiter of waitersOf(sessionId)) waiter.approval()
  }
  // The team's own tools are quick; any other tool is the start of work.
  const QUICK_TOOLS = new Set(TEAM_TOOLS)
  rt.workRoomTurn = (sessionId: string, tool: string): void => {
    if (QUICK_TOOLS.has(tool)) return
    for (const waiter of waitersOf(sessionId)) waiter.work()
  }

  // A called member moves up if it is still waiting, or gets one more turn if it
  // already spoke; either way it goes right after slot `index`. `cap` is the caller's
  // per-member turn bound for the round; `by` is the calling member, if a member called.
  function callMembers(round: GroupRound, turns: Map<string, number>, index: number, callees: readonly StoredBot[], note: string, cap: number, by: string | undefined): void {
    let next = index + 1
    for (const peer of callees) {
      if ((turns.get(peer.id) ?? 0) >= cap) continue
      const waiting = round.slots.findIndex((other, at) => at > index && other.id === peer.id && other.status === 'waiting')
      const called: GroupSlot = waiting === -1 ? { id: peer.id, name: peer.name, status: 'waiting' } : (round.slots.splice(waiting, 1)[0] ?? { id: peer.id, name: peer.name, status: 'waiting' })
      called.note = note
      if (by === undefined) delete called.by
      else called.by = by
      round.slots.splice(next, 0, called)
      next += 1
    }
  }

  // The user's messages waiting in the group Session's inbox while a round runs, from
  // the composer whether it queued or steered them. Images and chat references are
  // only read when the Session takes the message itself, so a message with either
  // stays for the next round, and so does everything after it in that list.
  const waitingLines = (agent: Agent | undefined): { readonly id: string; readonly text: string }[] =>
    ['nextStep', 'nextTurn'].flatMap(list => {
      const lines: { readonly id: string; readonly text: string }[] = []
      for (const message of agent?.inbox?.[list as 'nextStep' | 'nextTurn'] ?? []) {
        if (message.source?.kind !== 'user') continue
        const content: readonly unknown[] = Array.isArray(message.content) ? message.content : []
        const text = textOf(content)
        if (text === '' || content.some(block => !isTextBlock(block)) || text.includes('moon-bot-session:') || text.includes('dsh-session:')) break
        lines.push({ id: message.id, text })
      }
      return lines
    })

  // Messages the user sent while this round is running post into the log before the
  // next speaker, so everyone still to speak sees them. The members the message's own
  // round would open with answer it next, inside this round. Each message leaves the
  // Session's inbox, so it does not open another round when this one ends. Returns
  // the number of turns added, which the round's limit allows for.
  function drainRoomInbox(room: ReadyRoom, round: GroupRound, turns: Map<string, number>, index: number, agent: Agent | undefined): number {
    // The greeting's prompt tells the admin the user has not written yet.
    if (round.kickoff) return 0
    const waiting = waitingLines(agent)
    if (agent === undefined || waiting.length === 0) return 0
    const lines = waiting.filter(line => agent.inbox?.remove(line.id) === true)
    if (lines.length === 0) return 0
    const before = round.slots.length
    const members = room.members.map(rt.botOf).filter((bot): bot is StoredBot => bot !== undefined)
    for (const line of lines) {
      log.appendRoom(room, { who: 'User', text: line.text })
      round.replies.push({ kind: 'user', text: line.text, time: Date.now() })
      const { all, found } = mentionsIn(line.text, members)
      const note = all || found.length > 0 ? 'the user mentioned you' : 'new message from the user'
      callMembers(round, turns, index - 1, openingSpeakersOf(rt, room, { text: line.text }), note, ROOM_ADMIN_TURNS_EACH, undefined)
    }
    // The user spoke in this room, so late results may call members again.
    room.lateRounds = 0
    void rt.save().catch(() => {})
    return round.slots.length - before
  }

  async function runRound(room: ReadyRoom, round: GroupRound, signal: AbortSignal, agent: Agent | undefined): Promise<void> {
    let limit = round.slots.length + ROOM_EXTRA_TURNS + (room.admin ? ROOM_ADMIN_EXTRA_TURNS : 0)
    const turns = new Map<string, number>()
    // The inbox check keeps a message sent during the last speaker's turn inside
    // this round: it drains at the loop's head even once the slots ran out.
    for (let index = 0; (index < round.slots.length || waitingLines(agent).length > 0) && round.turns < limit; index += 1) {
      if (signal.aborted) break
      limit += drainRoomInbox(room, round, turns, index, agent)
      if (index >= round.slots.length) break
      const slot = round.slots[index]
      if (slot === undefined) break
      const member = rt.botOf(slot.id)
      // Settings may change mid-round, for example when the admin removes someone.
      if (member === undefined || !room.members.includes(slot.id)) {
        slot.status = 'left'
        continue
      }
      slot.status = 'speaking'
      round.speaking = member.id
      round.turns += 1
      turns.set(member.id, (turns.get(member.id) ?? 0) + 1)
      let session: MemberSession | undefined
      try {
        session = await log.groupSessionFor(room, member)
      } catch (error) {
        rt.warn('moon-bot: group Session for %s in %s failed: %s', member.name, room.name, error)
        round.speaking = null
        slot.status = 'failed'
        round.failed.push(member.name)
        round.replies.push({ kind: 'failed', botId: member.id, name: member.name, color: member.color, code: 'SESSION', text: messageOf(error), time: Date.now() })
        continue
      }
      if (session === undefined) {
        round.speaking = null
        slot.status = 'left'
        continue
      }
      await log.loadGroupLines(room)
      const prompt = log.roomPrompt(room, member, round)
      round.shown?.push(member.id)
      const text = session.brief === undefined ? prompt.text : `${session.brief}\n\n${prompt.text}`
      const said: string[] = []
      const startedAt = Date.now()
      const reply = await roomTurn(room, member, session.id, { text, files: prompt.files }, slot.note ?? 'your turn', signal, round, slot.by, said)
      round.speaking = null
      const final = typeof reply === 'string' && !isPass(reply) ? reply : undefined
      if (typeof reply === 'object' && reply !== null && 'failure' in reply) {
        // Not a pass: the user sees why the member is silent, and the round goes on.
        slot.status = 'failed'
        round.failed.push(member.name)
        const { code, status, message } = reply.failure
        round.replies.push({ kind: 'failed', botId: member.id, name: member.name, color: member.color, code, ...(status ? { status } : {}), text: message, time: Date.now() })
      } else if (typeof reply === 'object' && reply !== null && 'approval' in reply) {
        // The member's turn goes on in the background and posts when it ends.
        slot.status = 'waiting-approval'
        round.replies.push({ kind: 'approval', botId: member.id, name: member.name, color: member.color, time: Date.now() })
      } else if (typeof reply === 'object' && reply !== null && 'working' in reply) {
        slot.status = 'working'
        round.replies.push({ kind: 'working', botId: member.id, name: member.name, color: member.color, time: Date.now() })
      } else if (final !== undefined || (typeof reply === 'string' && said.length > 0)) {
        slot.status = 'posted'
        if (final !== undefined) log.postInRound(room, round, member, final, Date.now() - startedAt)
      } else {
        slot.status = typeof reply === 'string' ? 'passed' : 'missed'
        round.passed.push(member.name)
        if (typeof reply === 'object' && reply !== null && 'missed' in reply) round.replies.push({ kind: 'missed', botId: member.id, name: member.name, color: member.color, time: Date.now() })
      }
      const spoken = final === undefined ? said : [...said, final]
      if (spoken.length === 0) continue
      // Only the admin's "@all" calls everyone, so a member cannot set off a storm.
      const leads = rt.isAdminOf(room, member.id)
      const everyone = room.members.map(rt.botOf).filter((bot): bot is StoredBot => bot !== undefined)
      const others = everyone.filter(other => other.id !== member.id)
      const { all, found: named } = mentionsIn(spoken.join('\n\n'), everyone)
      const found = named.filter(other => other.id !== member.id)
      const callees = leads && all ? [...found, ...others.filter(other => !found.includes(other))] : found
      callMembers(round, turns, index, callees, `${member.name} mentioned you`, leads ? ROOM_ADMIN_TURNS_EACH : ROOM_TURNS_EACH, member.id)
    }
  }

  // A Bot that posts never answers its own post. @mentions choose the speakers; else
  // the admin answers alone in admin mode, or first of everyone. What a member posts
  // after its round moved on is answered by the member that asked for it; work the
  // user asked for is left for the user to read.
  // A group chat's own Session never consults the model: models drift from "only call
  // group_relay" (they message one member directly when the user names it), so the
  // relay step is synthesized here. Auxiliary calls such as titles, and DS Bot's own
  // calls for the room such as image readings, still reach the model.
  ctx.on<RelayOptions, () => AsyncIterable<RelayChunk>>('llm/stream', (options, next) => {
    if (options.sessionId === undefined || options.purpose !== undefined || rt.ownRequest(options)) return next()
    return (async function* relayOrPass(): AsyncGenerator<RelayChunk> {
      await rt.load()
      if (rt.roomOf(options.sessionId) === undefined) {
        yield* next()
        return
      }
      // Plugins append context as user-role messages (time, attachments), so only a
      // message from the user, a scheduled task, or a Bot's post after the last model or
      // tool step starts a relay.
      const opens = (message: RelayMessage): boolean =>
        message.role === 'user' && (message.source?.kind === 'user' || message.source?.kind === 'schedule' || (message.source?.kind === SOURCE_KIND && (message.source.role === 'post' || message.source.role === 'kickoff')))
      const latest = [...options.messages].reverse().find(message => message.role === 'assistant' || message.role === 'tool' || opens(message))
      if (latest?.role !== 'user') {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const id = `toolu_relay_${randomUUID().replace(/-/g, '')}`
      const declared = new Set((options.tools ?? []).map(tool => tool.name))
      // Only for a group made under the PTC preset, which can call nothing but run_code;
      // new group Sessions get the standard preset.
      const [name, args]: readonly [string, string] =
        declared.has('run_code') && !declared.has('group_relay') ? ['run_code', JSON.stringify({ description: 'Relay the group chat to its Bots', code: 'return await tools.group_relay({})', timeoutMs: 600_000 })] : ['group_relay', '{}']
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    })()
  })

  return { openingSpeakers: (room: GroupRoom, opener: RoomPost) => openingSpeakersOf(rt, room, opener), runRound }
}

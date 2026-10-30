// The group log, members' hidden group Sessions, prompts, and posts: everything that
// reads or writes a room's stored state.
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createUserMessage } from '../llm-bits.ts'
import { GROUP_LINE_READ, ROOM_LATE_ROUNDS, ROOM_STEP_GAP_MS, SOURCE_KIND, TEXT_KEPT } from '../constants.ts'
import { headOf, splitRef } from '../text.ts'
import type { AttachmentRef } from '../host-types.js'
import type { StoredBot, TurnInfo } from '../runtime.ts'
import type { GroupRuntime } from './types.ts'
import { ROOM_CALLS, ROOM_REPLY, adminNote, fileLine, isPass, mentionsIn, referenceNote, roomKickoff, slotLabel, stripOwnName, transcript } from './notice.ts'
import type { GroupRoom, GroupRound, MemberSession, ReadyRoom, RoomLine, RoomPostOptions } from './types.ts'
import type { RoomLineInput, RoomLogApi, HeldLines } from './log-types.ts'
export type { RoomLineInput, RoomLogApi } from './log-types.ts'

export const ROOM_LOG_MAX = 60
const ROOM_FIRST_LOOK = 12
const ROOM_DELTA_MAX = 24
const ROOM_EARLIER_MAX = 8

// Logs written before rooms were versioned get sequence numbers in place.
export function ensureRoomLog(room: GroupRoom): asserts room is ReadyRoom {
  if (typeof room.seq !== 'number') {
    room.log = (room.log ?? []).map((line, index) => ({ ...line, seq: index + 1 }))
    room.seq = room.log.length
  } else room.log ??= []
  room.seen ??= {}
}

// A member's own lines are already in its Session, so only the others' are news.
const unseenLines = (room: ReadyRoom, memberId: string): RoomLine[] => {
  const since = room.seen[memberId]
  if (since === undefined) return room.log.slice(-ROOM_FIRST_LOOK)
  return room.log.filter(line => line.seq > since && line.botId !== memberId).slice(-ROOM_DELTA_MAX)
}

export function installRoomLog(rt: GroupRuntime): RoomLogApi {
  const { ctx } = rt

  // A long line keeps its start in state.json, which is written whole on every save,
  // and what a member reads of it (GROUP_LINE_READ) in a file of its own: written once,
  // before the state that names it, and removed with the line. All of it stays in the
  // group's Session, where the group chat shows it.
  const linesDir = join(rt.home, 'group-lines')
  const lineFile = (roomId: string, seq: number): string => join(linesDir, roomId, `${seq}.txt`)
  const wholeLines = new Map<string, string>()
  const lineKey = (roomId: string, seq: number): string => `${roomId}/${seq}`
  const writes = (): boolean => rt.readOnly?.() === undefined

  function keepGroupLine(roomId: string, line: RoomLine, text: string): RoomLine {
    const kept = headOf(text, TEXT_KEPT)
    if (kept.length === text.length) return line
    const read = headOf(text, GROUP_LINE_READ)
    wholeLines.set(lineKey(roomId, line.seq), read)
    if (writes()) {
      try {
        mkdirSync(join(linesDir, roomId), { recursive: true })
        writeFileSync(lineFile(roomId, line.seq), read, 'utf8')
      } catch (error) {
        rt.warn('moon-bot: group line %s/%s not kept whole: %s', roomId, line.seq, error)
      }
    }
    return { ...line, text: kept, length: text.length }
  }

  function dropGroupLine(roomId: string, line: RoomLine): void {
    if (line.length === undefined) return
    wholeLines.delete(lineKey(roomId, line.seq))
    if (writes()) void rm(lineFile(roomId, line.seq), { force: true }).catch(() => {})
  }

  function dropGroupLines(roomId: string): void {
    for (const key of wholeLines.keys()) if (key.startsWith(`${roomId}/`)) wholeLines.delete(key)
    if (writes()) void rm(join(linesDir, roomId), { recursive: true, force: true }).catch(() => {})
  }

  // After a restart the whole lines are read back before a member reads them.
  const loadGroupLines = (room: ReadyRoom): Promise<unknown> =>
    Promise.all(
      room.log
        .filter(line => line.length !== undefined && !wholeLines.has(lineKey(room.id, line.seq)))
        .map(line =>
          readFile(lineFile(room.id, line.seq), 'utf8').then(
            text => {
              wholeLines.set(lineKey(room.id, line.seq), text)
            },
            () => {},
          ),
        ),
    )

  // What a member reads of a line: all of it, up to GROUP_LINE_READ.
  const memberText =
    (room: GroupRoom) =>
    (line: RoomLine): string => {
      const read = line.length === undefined ? line.text : wholeLines.get(lineKey(room.id, line.seq))
      if (read === undefined) return `${line.text}… (cut; ${line.length} characters in all, the rest was not kept)`
      const length = line.length ?? read.length
      const shown = headOf(read, GROUP_LINE_READ)
      return length > shown.length ? `${shown}… (cut; ${length} characters in all)` : shown
    }

  const appendRoom = (room: ReadyRoom, line: RoomLineInput): void => {
    room.seq += 1
    const log = [...room.log, keepGroupLine(room.id, { ...line, text: line.text ?? '', seq: room.seq }, line.text ?? '')]
    for (const gone of log.slice(0, -ROOM_LOG_MAX)) dropGroupLine(room.id, gone)
    room.log = log.slice(-ROOM_LOG_MAX)
  }
  Object.assign(rt, { keepGroupLine, dropGroupLines })

  // A member's group Session, created on its first turn there. A new one starts with
  // a fresh look at the log and a brief of the member's own chat; the brief is the
  // first message, so it stays fixed and the prefix stays cacheable.
  async function groupSessionFor(room: ReadyRoom, member: StoredBot): Promise<MemberSession | undefined> {
    room.sessions ??= {}
    const known = room.sessions[member.id]
    if (known !== undefined) {
      await rt.ensureCapabilities(known)
      return { id: known, brief: undefined }
    }
    const id = await rt.createSession(`${member.name} · ${room.name}`, { dir: rt.workDirOf({ botId: member.id, roomId: room.id }) })
    // While the Session was made the member may have left or been deleted, the group been
    // deleted, or another turn made the member's Session first: the new one is not kept.
    // Undefined means the member is gone from the group.
    const gone = rt.roomOf(room.id) !== room || !room.members.includes(member.id) || rt.botOf(member.id) === undefined
    if (gone || room.sessions?.[member.id] !== undefined) {
      void ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }).catch(error => rt.warn('moon-bot: unused group Session of %s in %s not archived: %s', member.name, room.name, error))
      return gone ? undefined : groupSessionFor(room, member)
    }
    room.sessions[member.id] = id
    rt.groupOwners.set(id, { botId: member.id, roomId: room.id })
    delete room.seen[member.id]
    const ref = await rt.desiredModel(member)
    if (ref !== undefined) {
      await rt.selectSessionModel(id, splitRef(ref)).catch(error => rt.warn('moon-bot: model for %s in %s not applied: %s', member.name, room.name, error))
    }
    await rt.applyPermission(member, id, room).catch(error => rt.warn('moon-bot: permission for %s in %s not applied: %s', member.name, room.name, error))
    await rt.save()
    await rt.ensureCapabilities(id)
    return { id, brief: await rt.ownChatBrief(member) }
  }

  // Members whose turn in this group is running, and since when.
  const workingIn = (room: ReadyRoom): { readonly bot: StoredBot; readonly since: number }[] =>
    room.members.flatMap(id => {
      const sessionId = room.sessions?.[id]
      if (sessionId === undefined) return []
      const entry = rt.live.get(sessionId)
      const bot = rt.botOf(id)
      return entry?.turn !== undefined && bot !== undefined ? [{ bot, since: entry.since ?? Date.now() }] : []
    })
  const minutesSince = (at: number): number => Math.max(1, Math.round((Date.now() - at) / 60000))

  // Lines from before the round's opening message are kept apart from this round, so
  // an earlier round (an old count-off, say) never reads as part of the current one.
  // `files` are the files of the lines shown, which go to the member with the prompt.
  function roomPrompt(room: ReadyRoom, member: StoredBot, round: GroupRound): { readonly text: string; readonly files: AttachmentRef[] } {
    const peers = room.members
      .filter(id => id !== member.id)
      .map(rt.botOf)
      .filter((bot): bot is StoredBot => bot !== undefined)
      .map(bot => `${bot.name}${rt.isAdminOf(room, bot.id) ? ' (admin)' : ''}`)
    const leads = rt.isAdminOf(room, member.id)
    const lines = unseenLines(room, member.id)
    const earlier = lines.filter(line => line.seq < round.startSeq).slice(-ROOM_EARLIER_MAX)
    const current = lines.filter(line => line.seq >= round.startSeq)
    const spokeThisRound = (room.seen[member.id] ?? 0) >= round.startSeq
    const index = round.slots.findIndex(slot => slot.status === 'speaking')
    const before = index
    const after = round.slots.length - index - 1
    const members = `Members: the user${peers.length ? `, ${peers.join(', ')}` : ''} and you${leads ? ' (admin)' : ''}. Members speak one at a time; each message is posted before the next speaker starts. ${ROOM_CALLS}`
    const notice = room.notice ? `Group notice (shared instructions for every member):\n${room.notice}` : ''
    if (round.kickoff) return { text: [members, notice, leads ? adminNote(room) : '', roomKickoff(rt.uiLanguage?.())].filter(Boolean).join('\n\n'), files: [] }
    const working = workingIn(room).filter(item => item.bot.id !== member.id)
    const text = [
      members,
      notice,
      leads ? adminNote(room) : '',
      earlier.length ? `Earlier in the group, before this round (context only):\n${transcript(earlier, memberText(room))}` : '',
      current.length ? `This round so far${spokeThisRound ? ', since your last message' : ', starting with the new message'} (oldest first):\n${transcript(current, memberText(room))}` : 'Nothing new in this round since your last message.',
      round.shown?.includes(member.id) ? '' : referenceNote(round.references),
      working.length > 0 ? `Still at work on what they were asked; each posts here when done: ${working.map(item => `${item.bot.name} (${minutesSince(item.since)} min)`).join(', ')}.` : '',
      `Speaking order for this round: ${round.slots.map(slotLabel).join(' → ')}.`,
      `You are number ${index + 1} of ${round.slots.length}. ${before === 0 ? 'Nobody spoke before you' : `${before} went before you`}${after === 0 ? ', and you are the last.' : `; ${after} after you will see your message.`}`,
      ROOM_REPLY,
    ]
      .filter(Boolean)
      .join('\n\n')
    return { text, files: [...earlier, ...current].flatMap(line => line.files ?? []) }
  }

  // A member's message in the round: in the log, for the members after it, and in the
  // round's replies, for the user.
  const postInRound = (room: ReadyRoom, round: GroupRound, member: StoredBot, text: string, duration?: number): void => {
    appendRoom(room, { who: member.name, botId: member.id, text })
    round.replies.push({ botId: member.id, name: member.name, color: member.color, text, time: Date.now(), ...(duration === undefined ? {} : { duration }) })
    void rt.save().catch(() => {})
  }

  // A Bot's message into the group's own Session, which relays it as a new round.
  // While a round runs, the post goes into the group's log and that round's replies at
  // once, so it is not held back until the round ends; the relay it still opens does not
  // write it again (source `logged`).
  async function postToRoom(room: GroupRoom, sender: StoredBot, text: string, extra: RoomPostOptions = {}, files: readonly AttachmentRef[] = []): Promise<void> {
    const running = [...rt.roomProgress.values()].find(round => round.roomId === room.id)
    let logged: number | undefined
    if (running !== undefined) {
      ensureRoomLog(room)
      if (extra.failed !== undefined) {
        // A failed model call is an event of the round only: no log line, as the relay does it.
        const { code, status, message } = extra.failed
        running.failed.push(sender.name)
        running.replies.push({ kind: 'failed', botId: sender.id, name: sender.name, color: sender.color, code, ...(status ? { status } : {}), text: message, time: Date.now() })
        logged = room.seq
      } else if (extra.resumed === true || extra.stopped === true || extra.done === true) {
        const kind = extra.done === true ? 'done' : extra.stopped === true ? 'stopped' : extra.again === true ? 'cut' : 'resumed'
        appendRoom(room, { who: sender.name, botId: sender.id, kind, text: '' })
        running.replies.push({ kind, botId: sender.id, name: sender.name, color: sender.color, time: Date.now() })
        logged = room.seq
      } else {
        const line = [text, ...files.map(fileLine)].filter(Boolean).join('\n')
        appendRoom(room, { who: sender.name, botId: sender.id, text: line, ...(files.length > 0 ? { files } : {}) })
        running.replies.push({ botId: sender.id, name: sender.name, color: sender.color, text: line, time: Date.now() })
        logged = room.seq
      }
      await rt.save()
    }
    const agent = await rt.resolveAgent(room.id)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: `[Group post from ${sender.name}]\n${text}` }, ...files.map(attachment => ({ type: 'file', attachment }))],
        source: { kind: SOURCE_KIND, form: 'relay', role: 'post', exchangeId: randomUUID(), senderName: sender.name, senderSessionId: sender.id, roomId: room.id, ...extra, ...(logged !== undefined ? { logged } : {}) },
      }),
    )
    await ctx.sessions.flush(agent.session)
  }

  rt.postToRoom = postToRoom

  // A member the round moved on from (it went on working, went quiet or waited for an
  // approval) posts what its turn ended with. The member that asked for it and anyone
  // it names answer; past the late round limit nobody does, so late posts cannot keep a
  // group talking. Work whose result already went out as a step line (`shown`) and
  // that ends with nothing more to say still tells the member that asked for it, which
  // answers the result: where the result sits in the turn decides nothing.
  async function lateRoomReply(sessionId: string, info: TurnInfo, reply: string, { shown = false }: { readonly shown?: boolean } = {}): Promise<void> {
    const owner = rt.groupOwners.get(sessionId)
    const room = rt.roomOf(owner?.roomId ?? info.roomId)
    const member = rt.botOf(owner?.botId)
    if (room === undefined || member === undefined || !room.members.includes(member.id)) return
    const text = stripOwnName(member.name, reply)
    const done = isPass(text) && shown && info.askedBy !== undefined
    if (isPass(text) && !done) return
    const quiet = (room.lateRounds ?? 0) >= ROOM_LATE_ROUNDS
    if (!quiet) room.lateRounds = (room.lateRounds ?? 0) + 1
    await rt.save()
    await postToRoom(room, member, done ? '' : text, { late: true, ...(done ? { done: true } : {}), ...(info.askedBy ? { askedBy: info.askedBy } : {}), ...(quiet ? { quiet: true } : {}) }).catch(error => rt.warn('moon-bot: late group reply from %s failed: %s', member.name, error))
  }
  rt.lateRoomReply = lateRoomReply

  const memberIn = (sessionId: string, info: TurnInfo | undefined): { readonly room: GroupRoom; readonly member: StoredBot } | undefined => {
    const owner = rt.groupOwners.get(sessionId)
    const room = rt.roomOf(owner?.roomId ?? info?.roomId)
    const member = rt.botOf(owner?.botId)
    return room !== undefined && member !== undefined && room.members.includes(member.id) ? { room, member } : undefined
  }
  const callsIn = (room: GroupRoom, member: StoredBot, text: string): boolean =>
    mentionsIn(
      text,
      room.members.map(rt.botOf).filter((bot): bot is StoredBot => bot !== undefined),
    ).found.some(bot => bot.id !== member.id)

  // What a member says while it works, into the group. While the member holds its place
  // in a round, it joins that round. Later, it joins whatever round runs in the group, or
  // posts on its own. Only the members it calls with @ answer it, and not past the late
  // round limit; the member that asked for the work answers the result.
  async function postStep(sessionId: string, info: TurnInfo | undefined, text: string): Promise<void> {
    const waiter = info?.role === 'room' ? rt.roomWaiters.get(info.exchangeId) : undefined
    if (waiter !== undefined) return waiter.say(text)
    const found = memberIn(sessionId, info)
    if (found === undefined) return
    const { room, member } = found
    ensureRoomLog(room)
    const calls = callsIn(room, member, text)
    const running = [...rt.roomProgress.values()].find(round => round.roomId === room.id)
    if (!calls && running !== undefined) return postInRound(room, running, member, text)
    const quiet = !calls || (room.lateRounds ?? 0) >= ROOM_LATE_ROUNDS
    if (!quiet) room.lateRounds = (room.lateRounds ?? 0) + 1
    await rt.save()
    await postToRoom(room, member, text, { progress: true, ...(quiet ? { quiet: true } : {}) })
  }

  // Lines a member writes close together reach the group as one message, so a burst of
  // steps does not come out as a string of messages. Its first line on work it was asked
  // for and a line that calls a member go at once; lines still held when the turn ends
  // open its result. Per group Session.
  const held = new Map<string, HeldLines>()
  ctx.effect(
    () => () => {
      for (const entry of held.values()) clearTimeout(entry.timer)
    },
    'moon-bot: group step lines',
  )
  const flushSteps = (sessionId: string): Promise<void> | undefined => {
    const entry = held.get(sessionId)
    if (entry === undefined) return undefined
    clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.lines.length === 0) return undefined
    entry.last = Date.now()
    return postStep(sessionId, entry.info, entry.lines.splice(0).join('\n\n'))
  }
  rt.roomStepText = async (sessionId, info, raw, first): Promise<void> => {
    const found = memberIn(sessionId, info)
    if (found === undefined) return
    const { room, member } = found
    const text = stripOwnName(member.name, raw)
    if (isPass(text)) return
    const entry = held.get(sessionId) ?? { last: 0, lines: [] }
    held.set(sessionId, entry)
    entry.info = info
    entry.lines.push(text)
    if ((first && info?.role === 'room') || callsIn(room, member, text) || Date.now() - entry.last >= ROOM_STEP_GAP_MS) return flushSteps(sessionId)
    entry.timer ??= setTimeout(() => void flushSteps(sessionId)?.catch(error => rt.warn('moon-bot: step lines from %s not posted: %s', member.name, error)), entry.last + ROOM_STEP_GAP_MS - Date.now())
  }
  rt.takeRoomSteps = (sessionId: string): string => {
    const entry = held.get(sessionId)
    if (entry === undefined) return ''
    clearTimeout(entry.timer)
    entry.timer = undefined
    entry.last = Date.now()
    return entry.lines.splice(0).join('\n\n')
  }
  rt.withRoomSteps = (lines: string, reply: string): string => (lines === '' ? reply : isPass(reply) ? lines : `${lines}\n\n${reply}`)

  return { appendRoom, dropGroupLines, groupSessionFor, loadGroupLines, memberText, postInRound, postToRoom, roomPrompt, unseenLines }
}

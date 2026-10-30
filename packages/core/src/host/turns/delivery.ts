// Delivery and the parts of a turn: what each Bot Session is doing now (for its mascot),
// which calls it runs, the text it has said so far, the waiters and inboxes of group
// rounds, and the delivery records a finished turn leaves.
//
// The maps and the delivery bookkeeping live here; `route.ts` decides where a message
// goes and what a finished turn answers, and `turns.ts` keeps the public surface.
import type { AgentSession, AttachmentRef } from '../host-types.js'
import type { HostRuntime, TurnInfo } from '../runtime.ts'
import type { FailureDetail, GroupRound, RoomPost, RoomWaiter } from '../groups/types.ts'
import type { TurnFailure } from './failure.ts'

/** One request that joined a running turn: the trigger it came with and its text. */
export interface JoinedInfo {
  readonly info: SourceInfo
  readonly text: string
}

/**
 * A turn's trigger as this module reads it. `runtime.ts` keeps the shared fields; a
 * the host/user message carries the rest, and every one of them is a filter or a record.
 */
export interface SourceInfo extends TurnInfo {
  readonly replyTo?: string | undefined
  readonly retried?: boolean | undefined
  readonly handoff?: boolean | undefined
  readonly resume?: boolean | undefined
  readonly joined?: readonly JoinedInfo[] | undefined
  readonly senderName?: string | undefined
  readonly reportBack?: boolean | undefined
  readonly member?: boolean | undefined
  readonly sub?: string | undefined
  readonly late?: boolean | undefined
  readonly progress?: boolean | undefined
  readonly quiet?: boolean | undefined
  readonly failed?: FailureDetail | undefined
  readonly again?: boolean | undefined
  readonly stopped?: boolean | undefined
  readonly done?: boolean | undefined
  readonly logged?: number | undefined
  readonly references?: readonly { readonly label?: unknown }[] | undefined
}

/** A Session's turn and what this module tracks for it between events. */
export interface TurnEntry {
  turn?: number | undefined
  since?: number | undefined
  /** When this Session's message was accepted, before its turn starts (the optimistic state). */
  sentAt?: number | undefined
  texts: string[]
  shown: number
  info?: SourceInfo | undefined
  pending?: SourceInfo | undefined
  joined?: JoinedInfo[] | undefined
  later?: { info: SourceInfo; text: string }[] | undefined
  calls?: Map<string, { readonly name: string; readonly args: string }> | undefined
  switched?: boolean | undefined
  opened?: boolean | undefined
  answers?: boolean | undefined
  tool?: string | undefined
  step?: string | undefined
  lastText?: string | undefined
  lastCalled?: boolean | undefined
}

/** A long message as `attachLong` delivers it: start text, the file, and the whole length. */
export interface LongText {
  readonly text: string
  readonly files: readonly AttachmentRef[]
  readonly length?: number | undefined
}

/** A job in a Bot's move to a fresh part, as `parts.ts` records it. */
export interface SwitchJob {
  readonly botId: string
  readonly roomId?: string
  readonly since: number
}

/** The runtime surface the turn modules install or call. */
export interface TurnsRuntime extends HostRuntime {
  noteFailure(entry: {
    readonly source: string
    readonly text: string
    readonly code?: string | undefined
    readonly status?: number | undefined
    readonly requestId?: string | undefined
    readonly bot?: string | undefined
    readonly where?: string | undefined
    readonly sessionId?: string | undefined
  }): void
  dropKickoff(botId: string | undefined): void
  attachLong(text: string, name: string): Promise<LongText | undefined>
  closeWork?(id: string | undefined, name: string, text: string): string | undefined
  forgetBotWork?(botId: string): readonly (SourceInfo | undefined)[]
  roomStepText?(sessionId: string, info: TurnInfo | undefined, raw: string, first: boolean): Promise<void>
  takeRoomSteps?(sessionId: string): string
  withRoomSteps?(lines: string, reply: string): string
  lateRoomReply?(sessionId: string, info: TurnInfo, reply: string, options?: { readonly shown?: boolean | undefined }): Promise<void>
  lateRoomFailure?(sessionId: string, info: TurnInfo, failure: FailureDetail): Promise<void>
  failRoomTurn?(sessionId: string, failure: FailureDetail): boolean
  touchRoomTurn?(sessionId: string): void
  workRoomTurn?(sessionId: string, tool: string): void
  takenWork?(workId: string, id: string): void
  workOf?(info: TurnInfo | undefined): string | undefined
  ownsWork?(botId: string | undefined, workId: string | undefined): boolean
  waitsWork?(workId: string): boolean
  holdWork?(workId: string, text: string): void
  workAsker?(workId: string): TurnInfo | undefined
  answerText?(workId: string, reply: string, botName: string): string
  switchJobs?(): Iterable<SwitchJob>
  sessionFolder?(session: AgentSession | undefined): string | undefined
  waitingView?(): Readonly<Record<string, { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }>>
}

/** The live maps and functions `route.ts` and `turns.ts` share. */
export interface TurnsCore {
  readonly live: Map<string, TurnEntry>
  readonly roomWaiters: Map<string | undefined, RoomWaiter>
  readonly roomProgress: Map<string | undefined, GroupRound>
  readonly roomInbox: Map<string, RoomPost[]>
  readonly stoppedRoomTurns: Set<string | undefined>
  liveOf(id: string): TurnEntry
  queueRoomMessage(roomId: string, item: RoomPost): void
  setActivity(id: string, value: string | undefined): void
  startCall(id: string, entry: TurnEntry, callId: unknown, name: string, args: string): void
  endCall(id: string, entry: TurnEntry, callId: unknown): void
  claimTrigger(sessionId: string, entry: TurnEntry, info: SourceInfo): void
  showSteps(id: string, entry: TurnEntry, upTo: number): void
  markExchangeTurn(sessionId: string, turn: number | undefined): void
  unmarkExchangeTurn(sessionId: string, turn: number | undefined): void
  tellSender(id: string, source: TurnInfo, text: string, long?: LongText): void
  speaksInGroup(id: string, info: TurnInfo | undefined): boolean
  noteTurnFailure(id: string, failure: TurnFailure): void
  activityNow(): Record<string, string>
}

// A tool call some models write into their text instead of making it (the XML-like
// form of their own chat template).
const WRITTEN_CALL = /<tool_call>\s*<function=|<function=[\w.-]+>\s*<parameter=/
export const writesToolCall = (text: unknown): boolean => typeof text === 'string' && WRITTEN_CALL.test(text)
export const stripWrittenCalls = (text: string): string => text
  .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, '')
  .replace(/<function=[\w.-]+>[\s\S]*?(?:<\/function>|$)/g, '')
  .trim()

const RETRY_TEXT = 'Your last reply wrote a tool call as plain text (<tool_call>…), so it did not run and nothing happened. Call the tool through the tool interface now, then reply as you meant to.'

export const sourceOf = (value: unknown): SourceInfo | undefined => (value !== null && typeof value === 'object' ? value as SourceInfo : undefined)

/**
 * state.json keeps exchange turns as plain arrays; the shared type marks them readonly
 * because only this module appends to them. This view is the same object, mutated in place.
 */
type ExchangeTurnLists = Record<string, (number | undefined)[]>

// A request whose audience is the user is answered visibly in the recipient's own chat.
export const answersUser = (info: TurnInfo | undefined): boolean => info?.role === 'request' && info.audience === 'user'
// Roles whose turn owes the sender a reply: a 'stopped' notice asks like a request.
export const expectsReply = (info: TurnInfo | undefined): boolean => info?.role === 'request' || info?.role === 'stopped'

export function attachReference(queued: readonly RoomPost[] | undefined, source: SourceInfo | undefined, text: string): void {
  let post: RoomPost | undefined
  for (let index = (queued?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = queued?.[index]
    if (item !== undefined && item.botId === undefined && item.kickoff !== true) {
      post = item
      break
    }
  }
  if (post === undefined || text === '') return
  const labels = (Array.isArray(source?.references) ? source.references : [])
    .map(reference => reference?.label).filter((label): label is string => typeof label === 'string' && label !== '')
  post.references = [...(post.references ?? []), { labels, text }]
}

// The retry goes where the turn's trigger came from: a group round's waiter or a Bot's
// request keeps its exchange; anything else is a nudge in the Bot's own chat.
export function retryWrittenCall(rt: TurnsRuntime, id: string, info: SourceInfo | undefined): Promise<string> {
  const keeps = info !== undefined && (info.role === 'room' || expectsReply(info))
  const kept = keeps ? info : undefined
  return rt.deliver({
    ...(kept?.senderSessionId ? { fromId: kept.senderSessionId } : {}),
    toId: rt.selfOf(id) as string,
    sessionId: id,
    role: kept?.role ?? 'retry',
    ...(kept?.roomId ? { roomId: kept.roomId } : {}),
    ...(kept?.exchangeId ? { exchangeId: kept.exchangeId } : {}),
    ...(info?.work ? { work: info.work } : {}),
    ...(kept?.audience ? { audience: kept.audience } : {}),
    ...(kept?.askedBy ? { askedBy: kept.askedBy } : {}),
    ...(kept?.senderRoomId ? { fromRoomId: kept.senderRoomId } : {}),
    note: 'your tool call did not run',
    retried: true,
    text: RETRY_TEXT,
  })
}

export function installCore(rt: TurnsRuntime): TurnsCore {
  const { state } = rt

  // Every Session the turn listener handles belongs to a Bot (its own chat or a group
  // Session), so the store has an owner; `selfOf` is typed for every known Session.
  const selfId = (id: string): string => rt.selfOf(id) as string

  const live = new Map<string, TurnEntry>()
  const roomWaiters = new Map<string | undefined, RoomWaiter>()
  const roomProgress = new Map<string | undefined, GroupRound>()
  const roomInbox = new Map<string, RoomPost[]>()
  const queueRoomMessage = (roomId: string, item: RoomPost): void => {
    roomInbox.set(roomId, [...(roomInbox.get(roomId) ?? []), item])
  }
  // Member turns of a group round the user stopped: what they end with stays out of the group.
  const stoppedRoomTurns = new Set<string | undefined>()

  const liveOf = (id: string): TurnEntry => {
    let entry = live.get(id)
    if (entry === undefined) live.set(id, entry = { texts: [], shown: 0 })
    return entry
  }

  // What each running Bot is doing right now, for its mascot. Process-local: it is
  // rebuilt from live events and never saved.
  let activity: Record<string, string> = {}
  const activityOf = (tool: string): string => {
    if (/^(message_bot|stop_bot|create_bot|update_bot|create_group|update_group|delete_group|post_to_group)$/.test(tool)) return 'sending'
    if (tool === 'group_relay') return 'orbit'
    if (/search|fetch|browse|browser|read|grep|glob|list/i.test(tool)) return 'searching'
    return 'working'
  }
  const setActivity = (id: string, value: string | undefined): void => {
    if (activity[id] === value) return
    const next = { ...activity }
    if (value === undefined) delete next[id]
    else next[id] = value
    activity = next
  }
  // The newest call still running, a program's sub-calls included, is what the Session
  // is doing.
  const showCall = (id: string, entry: TurnEntry): void => {
    const name = [...(entry.calls?.values() ?? [])].at(-1)?.name
    entry.tool = name
    if (name !== undefined) setActivity(id, name === 'ask_user' || name === 'show_view' ? undefined : activityOf(name))
    else if (entry.turn !== undefined) setActivity(id, 'thinking')
  }
  const startCall = (id: string, entry: TurnEntry, callId: unknown, name: string, args: string): void => {
    if (typeof callId === 'string') (entry.calls ??= new Map()).set(callId, { name, args })
    showCall(id, entry)
  }
  const endCall = (id: string, entry: TurnEntry, callId: unknown): void => {
    if (typeof callId === 'string') entry.calls?.delete(callId)
    showCall(id, entry)
  }

  const activityNow = (): Record<string, string> => activity

  const exchangeTurns = (): ExchangeTurnLists => state.exchangeTurns as ExchangeTurnLists
  const markExchangeTurn = (sessionId: string, turn: number | undefined): void => {
    const lists = exchangeTurns()
    const turns = lists[sessionId] ??= []
    if (!turns.includes(turn)) {
      turns.push(turn)
      if (turns.length > 400) turns.splice(0, turns.length - 400)
      void rt.save().catch(() => {})
    }
  }
  const unmarkExchangeTurn = (sessionId: string, turn: number | undefined): void => {
    const turns = exchangeTurns()[sessionId] ?? []
    if (!turns.includes(turn)) return
    exchangeTurns()[sessionId] = turns.filter(other => other !== turn)
    void rt.save().catch(() => {})
  }

  // A group Session speaks only in its group, so what its turns write goes there, also
  // for turns that a finished background job or a fresh part starts; a Bot's private
  // message to it is answered privately.
  const speaksInGroup = (id: string, info: TurnInfo | undefined): boolean => rt.groupOwners.has(id) && !(info !== undefined && expectsReply(info))

  // The group hears what the member says while it works. A text with a tool call goes
  // on at once; one without may be the turn's last, so it waits for the next text or the
  // turn's end, which shows the rest as the turn's reply.
  const showSteps = (id: string, entry: TurnEntry, upTo: number): void => {
    const info = entry.info
    if (!speaksInGroup(id, info) || (info?.role === 'room' && stoppedRoomTurns.has(info.exchangeId))) return
    for (; entry.shown < upTo; entry.shown += 1) {
      const raw = entry.texts[entry.shown]
      if (raw === undefined) break
      const text = stripWrittenCalls(raw)
      if (text !== '') void rt.roomStepText?.(id, info, text, entry.shown === 0)?.catch(error => rt.warn('moon-bot: step text from %s not posted: %s', id, error))
    }
  }

  // The reply a sender waits for, also when it wrote from a group, where it gets the
  // reply in its Session there while it is still a member. A sender that asked for it
  // while working on another Bot's request goes on with that work when it reads it.
  // `long`: the text as attachLong sends it, when it went as a file.
  const tellSender = (id: string, source: TurnInfo, text: string, long?: LongText): void => {
    const sender = source.senderSessionId as string
    const back = rt.roomOf(source.senderRoomId)?.sessions?.[sender]
    const work = rt.closeWork?.(source.exchangeId, rt.botOf(selfId(id))?.name ?? 'The other Bot', text)
    void rt.deliver({
      fromId: selfId(id),
      toId: sender,
      ...(back ? { sessionId: back } : {}),
      text: long?.text ?? text,
      ...(long?.length === undefined ? {} : { files: long.files, length: long.length }),
      role: 'reply',
      replyTo: source.exchangeId,
      ...(work ? { work } : {}),
    }).catch(error => rt.warn('moon-bot: reply delivery failed: %s', error))
  }

  // A group Session is hidden as a whole, so its turns need no marking. A handoff
  // package that only opens a part is acknowledged with a fixed line, also hidden.
  const claimTrigger = (sessionId: string, entry: TurnEntry, info: SourceInfo): void => {
    entry.info = info
    // A turn that was stopped for a part switch brings its joined requests along.
    if (Array.isArray(info.joined) && info.joined.length > 0) {
      entry.joined = info.joined.filter((item: JoinedInfo) => item?.info !== undefined && item.info !== null)
    }
    if (rt.groupOwners.has(sessionId)) return
    if ((expectsReply(info) && !answersUser(info)) || info.role === 'room' || (info.role === 'handoff' && info.resume !== true)) {
      markExchangeTurn(sessionId, entry.turn)
    }
  }

  // Where a Session speaks, for the diagnostics log.
  const placeOf = (id: string): string => {
    const room = rt.roomOf(rt.groupOwners.get(id)?.roomId) ?? rt.roomOf(id)
    return room ? `group "${room.name}"` : 'own chat'
  }
  const noteTurnFailure = (id: string, failure: TurnFailure): void => {
    rt.noteFailure({
      source: 'turn',
      text: failure.message || 'the model call failed',
      code: failure.code,
      status: failure.status,
      requestId: failure.requestId,
      bot: rt.botOf(rt.selfOf(id))?.name ?? (rt.roomOf(id) ? undefined : 'unknown Bot'),
      where: placeOf(id),
      sessionId: id,
    })
  }

  return {
    live, roomWaiters, roomProgress, roomInbox, stoppedRoomTurns,
    liveOf, queueRoomMessage, setActivity, startCall, endCall, claimTrigger, showSteps,
    markExchangeTurn, unmarkExchangeTurn, tellSender,
    noteTurnFailure, activityNow, speaksInGroup,
  }
}

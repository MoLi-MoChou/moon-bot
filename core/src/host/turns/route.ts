// Turn routing: the trigger that opens a turn, the messages that land inside it (steer,
// follow, or wait for the next turn), and what its end answers, as a group post or a
// reply to the Bot or group that asked.
//
// `delivery.ts` keeps the live records and their bookkeeping; this module reads the
// Session events and decides where each message goes.
import type { AgentSession, AttachmentRef, MessageContentBlock, TurnEndReason } from '../dsh-types.js'
import type { TurnInfo } from '../runtime.ts'
import { HANDOFF_ACK, MESSAGE_INLINE_MAX, REFERENCE_KIND, REPLY_KIND, SOURCE_KIND } from '../constants.ts'
import { absoluteLinks } from '../links.ts'
import { reminderText } from '../schedules.ts'
import { textOf } from '../text.ts'
import type { SourceInfo, TurnsCore, TurnsRuntime } from './delivery.ts'
import { answersUser, attachReference, expectsReply, retryWrittenCall, stripWrittenCalls, writesToolCall } from './delivery.ts'
import { failureLine, turnFailure } from './failure.ts'

interface TurnEventData {
  readonly turn?: number | undefined
  readonly source?: SourceInfo | undefined
  readonly content?: readonly MessageContentBlock[] | undefined
  readonly message?: { readonly content?: readonly MessageContentBlock[] | undefined } | undefined
  readonly name?: unknown
  readonly callId?: unknown
  readonly subCallId?: unknown
  readonly arguments?: unknown
  readonly reason?: TurnEndReason | undefined
}

// DSH's `session/event` as this module reads it: a session id plus the payload each turn
// event carries. The API types the second argument generically, so this is the name for it.
interface TurnSessionEvent {
  readonly type: string
  readonly time?: number | undefined
  readonly data?: TurnEventData | undefined
}

const contentOf = (value: unknown): readonly MessageContentBlock[] => (Array.isArray(value) ? value as readonly MessageContentBlock[] : [])

const fileAttachments = (content: readonly MessageContentBlock[]): AttachmentRef[] => content.flatMap(block => (
  block?.type === 'file' && block.attachment !== undefined ? [block.attachment as AttachmentRef] : []
))

const imageAttachments = (content: readonly MessageContentBlock[]): AttachmentRef[] => content.flatMap(block => (
  block?.type === 'image' && !block?.offloaded && block.attachment !== undefined ? [block.attachment as AttachmentRef] : []
))

export function installRoute(rt: TurnsRuntime, core: TurnsCore): void {
  const { ctx, state } = rt

  // Every Session the turn listener handles belongs to a Bot (its own chat or a group
  // Session), so the store has an owner; `selfOf` is typed for every known Session.
  const selfId = (id: string): string => rt.selfOf(id) as string

  ctx.on<AgentSession | undefined, TurnSessionEvent>('session/event', (session, event) => {
    const id = session?.id
    if (id === undefined) return
    const data = event.data
    if (!rt.isBotSession(id) && !rt.roomOf(id)) {
      // A deleted Bot's Session can still be ending its turn; nothing of it stays.
      if (core.live.delete(id)) core.setActivity(id, undefined)
      return
    }
    const entry = core.liveOf(id)
    if (rt.groupOwners.has(id)) rt.touchRoomTurn?.(id)
    switch (event.type) {
      case 'tool/call': {
        const name = String(data?.name ?? '')
        core.startCall(id, entry, data?.callId, name, String(data?.arguments ?? ''))
        // A program is as quick as the tools it runs, so its sub-calls decide.
        if (rt.groupOwners.has(id) && name !== 'run_code') rt.workRoomTurn?.(id, name)
        break
      }
      case 'tool/ptc-dispatch-start': {
        const name = String(data?.name ?? '')
        core.startCall(id, entry, data?.subCallId, name, JSON.stringify(data?.arguments ?? {}))
        if (rt.groupOwners.has(id)) rt.workRoomTurn?.(id, name)
        break
      }
      case 'tool/ptc-dispatch':
        core.endCall(id, entry, data?.subCallId)
        break
      case 'tool/result':
        core.endCall(id, entry, data?.callId)
        break
      case 'turn/start':
        core.setActivity(id, 'thinking')
        entry.turn = data?.turn
        entry.since = event.time ?? Date.now()
        entry.sentAt = undefined
        entry.texts = []
        entry.shown = 0
        entry.step = undefined
        entry.info = undefined
        // A turn turned away before its first step may end without a turn/end.
        entry.switched = false
        entry.answers = false
        entry.opened = false
        entry.joined = []
        entry.later = []
        if (entry.pending !== undefined) {
          core.claimTrigger(id, entry, entry.pending)
          entry.pending = undefined
        }
        break
      case 'user/message': {
        const source = data?.source
        // A result that came back counts as taken once a turn reads it.
        if (source?.kind === SOURCE_KIND && source.work !== undefined && source.replyTo !== undefined) rt.takenWork?.(source.work, source.replyTo)
        // A message that shares a step with a bare handoff package is what the turn
        // answers, so the turn is not a hidden acknowledgement.
        const bare = (info: SourceInfo | undefined): boolean => info?.handoff === true && info.resume !== true
        // Whether the turn was already opened by an earlier message decides what a
        // Bot relay that lands inside it may claim: the first message of a turn
        // still claims it as today, a later one only joins it.
        const opened = entry.opened === true
        if (entry.turn !== undefined && !bare(source)
          && (source?.kind === 'user' || source?.kind === REPLY_KIND || source?.kind === 'schedule' || source?.kind === SOURCE_KIND)) {
          entry.opened = true
        }
        if (entry.turn !== undefined && (source?.kind === 'user' || source?.kind === REPLY_KIND || source?.kind === SOURCE_KIND)) {
          if (bare(source)) {
            if (entry.answers === true) break
          } else {
            entry.answers = true
            if (bare(entry.info)) {
              core.unmarkExchangeTurn(id, entry.turn)
              entry.info = undefined
            }
          }
        }
        if (source?.kind === SOURCE_KIND && source.role === 'post' && rt.roomOf(id)) {
          // A long post comes as a file (attachLong), which stays with its line.
          const files = fileAttachments(contentOf(data?.content))
          core.queueRoomMessage(id, {
            text: textOf(data?.content).replace(/^\[Group post from (?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/, ''),
            ...(files.length > 0 ? { files } : {}),
            botId: source.senderSessionId,
            name: source.senderName,
            reportBack: source.reportBack === true,
            ...(source.member ? { member: true } : {}),
            ...(source.sub ? { sub: source.sub } : {}),
            ...(source.late ? { late: true } : {}),
            ...(source.progress ? { progress: true } : {}),
            ...(source.quiet ? { quiet: true } : {}),
            ...(source.failed ? { failed: source.failed } : {}),
            ...(source.resumed ? { resumed: true } : {}),
            ...(source.again ? { again: true } : {}),
            ...(source.stopped ? { stopped: true } : {}),
            ...(source.done ? { done: true } : {}),
            ...(source.askedBy ? { askedBy: source.askedBy } : {}),
            // A post written into a running round already carries its log seq; the relay
            // must not write it again.
            ...(source.logged !== undefined ? { logged: source.logged } : {}),
          })
        } else if (source?.kind === SOURCE_KIND && source.role === 'kickoff' && rt.roomOf(id)) {
          core.queueRoomMessage(id, { text: '', kickoff: true })
        } else if (source?.kind === SOURCE_KIND) {
          if (entry.turn === undefined) entry.pending = source
          else if (!opened) core.claimTrigger(id, entry, source)
          else if (source.work !== undefined && source.work !== rt.workOf?.(entry.info) && !expectsReply(source)) {
            // A result for other work than this turn's informs it, and comes back in a
            // turn of its own once this one ends, which goes on with that work.
            entry.later = [...(entry.later ?? []), { info: source, text: textOf(data?.content).replace(/^\[(?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/, '') }]
          } else if (expectsReply(source) && !answersUser(source)
            && source.exchangeId !== entry.info?.exchangeId
            && !(entry.joined ?? []).some(joined => joined.info.exchangeId === source.exchangeId)) {
            // A request that lands inside a running turn steers that work but is
            // answered in a hidden turn of its own once the work is done, so the
            // sender never gets the turn's text. A failed-switch resume message
            // re-sends the trigger's own source; the same exchangeId must not join twice.
            const text = textOf(data?.content).replace(/^\[(?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/, '')
            entry.joined = [...(entry.joined ?? []), { info: source, text }]
          }
          // A mid-turn relay that owes no reply only informs the turn: it neither
          // claims the running turn nor queues as the next one's trigger.
        } else if (source?.kind === 'schedule' && rt.roomOf(id)) {
          // A group's scheduled task reaches the group as the user's message.
          core.queueRoomMessage(id, { text: reminderText(textOf(data?.content)) })
        } else if (source?.kind === REFERENCE_KIND && rt.roomOf(id)) {
          attachReference(core.roomInbox.get(id), source, textOf(data?.content))
        } else if (source?.kind === 'user' || source?.kind === REPLY_KIND) {
          if (rt.roomOf(id) && source.kind === 'user') {
            const content = contentOf(data?.content)
            const images = imageAttachments(content)
            const files = fileAttachments(content)
            core.queueRoomMessage(id, { text: textOf(data?.content), ...(images.length > 0 ? { images } : {}), ...(files.length > 0 ? { files } : {}) })
          }
          const own = rt.chatOwners.get(id)
          if (own !== undefined) rt.dropKickoff(own)
          // Any user message answers or supersedes the open question card and view card.
          let dropped = false
          const questions = state.questions
          if (questions !== undefined && questions[id] !== undefined) {
            delete questions[id]
            dropped = true
          }
          const views = state.views
          if (views?.[id] !== undefined) {
            delete views[id]
            dropped = true
          }
          if (dropped) void rt.save().catch(() => {})
        }
        break
      }
      case 'assistant/message': {
        const content = data?.message?.content
        const text = textOf(content)
        const called = Array.isArray(content) && content.some(block => block?.type === 'tool-call')
        if (text !== '' && text !== HANDOFF_ACK) {
          // What a turn says goes on to the group or the sender, read from other folders.
          entry.texts.push(absoluteLinks(text, rt.sessionFolder?.(session)))
          if (entry.turn !== undefined) core.showSteps(id, entry, called ? entry.texts.length : entry.texts.length - 1)
        }
        entry.lastText = text
        entry.lastCalled = called
        entry.step = called && text !== HANDOFF_ACK ? stripWrittenCalls(text) || undefined : undefined
        break
      }
      case 'turn/end': {
        core.setActivity(id, undefined)
        const info = entry.info
        const joined = entry.joined ?? []
        // What the group already saw of the turn is not posted again.
        const texts = entry.texts.slice(entry.shown)
        const shown = entry.shown > 0
        const lastText = entry.lastText
        const lastCalled = entry.lastCalled
        // A turn stopped for a switch goes on in the next part, which answers instead.
        const switched = entry.switched === true
        entry.turn = undefined
        entry.info = undefined
        entry.texts = []
        entry.shown = 0
        entry.step = undefined
        entry.switched = false
        entry.joined = []
        entry.since = undefined
        entry.tool = undefined
        entry.calls = undefined
        entry.lastText = undefined
        entry.lastCalled = undefined
        const later = entry.later ?? []
        entry.later = []
        for (const result of later) {
          void rt.deliver({
            fromId: result.info.senderSessionId,
            toId: selfId(id),
            text: result.text,
            role: result.info.role ?? '',
            exchangeId: result.info.exchangeId,
            replyTo: result.info.replyTo,
            work: result.info.work,
            ...(result.info.roomId ? { roomId: result.info.roomId } : {}),
            deferred: true,
          }).catch(error => rt.warn('ds-bot: handing back a result failed: %s', error))
        }
        const reason = data?.reason
        const failure = reason?.kind === 'error' && !switched ? turnFailure(reason.error) : undefined
        if (failure !== undefined) core.noteTurnFailure(id, failure)
        const held = rt.groupOwners.has(id) ? rt.takeRoomSteps?.(id) ?? '' : ''
        if (switched) break
        // A model that writes its tool call as text ends the turn as if it were done,
        // though nothing ran. It gets one more turn on the same trigger, so a waiting
        // round or sender gets the real answer; a second time, the text goes on without
        // the call.
        const wroteCall = failure === undefined && reason?.kind === 'completed' && lastCalled !== true && writesToolCall(lastText)
        const retry = wroteCall && info?.retried !== true && !(info?.role === 'room' && core.stoppedRoomTurns.has(info.exchangeId))
        if (retry) void retryWrittenCall(rt, id, info).catch(error => rt.warn('ds-bot: asking %s to run its written tool call failed: %s', id, error))
        const replyText = (): string => {
          const reply = (wroteCall ? texts.map(stripWrittenCalls) : texts).join('\n\n').trim()
          return wroteCall && reply === '' ? 'Tried to run a tool but wrote the call as text, so it did not run.' : reply
        }
        const groupReply = (): string => rt.withRoomSteps?.(held, replyText()) ?? replyText()
        // Whoever the turn answers gets the same three-way rule: a failure notice,
        // the turn's text (or a stopped-before-answer line), or nothing.
        const name = rt.botOf(rt.selfOf(id))?.name ?? 'The other Bot'
        const answer = (source: TurnInfo | undefined, reply: string): void => {
          if (source === undefined || !expectsReply(source) || answersUser(source)) return
          if (failure !== undefined) {
            // The sender was told a reply comes later; without this it would wait forever.
            core.tellSender(id, source, `${name} could not answer your message: its model call failed (${failureLine(failure)}). Tell the user if it matters; do not retry right away.`)
          } else if (reply !== '' || reason?.kind === 'aborted') {
            // A turn stopped before it could answer still owes the sender a line,
            // or it would wait forever for a reply that never comes.
            core.tellSender(id, source, reply !== '' ? reply : `${name} was stopped before it could answer your message.`)
          }
        }
        // Work a Bot asked for, also when what came back for it opens the turn: while
        // anything handed on for it is still out, the answer waits; then it goes up with
        // what came back. A failed or stopped turn answers at once.
        const finish = (source: TurnInfo, reply: string): void => {
          const work = rt.workOf?.(source)
          if (work === undefined || rt.ownsWork?.(rt.selfOf(id), work) !== true) return answer(source, reply)
          const asker = rt.workAsker?.(work)
          if (asker === undefined) return answer(source, reply)
          if (failure !== undefined || reason?.kind === 'aborted') return answer(asker, reply)
          if (rt.waitsWork?.(work) === true) return rt.holdWork?.(work, reply)
          // With what came back, the answer may pass what one message carries.
          const text = rt.answerText?.(work, reply, name)
          if (text === undefined) return answer(source, reply)
          if (text.length <= MESSAGE_INLINE_MAX) return core.tellSender(id, asker, text)
          void rt.attachLong(text, `Answer from ${name}.txt`)
            .then(long => core.tellSender(id, asker, text, long))
            .catch(error => rt.warn('ds-bot: answer from %s not sent: %s', name, error))
        }
        // A retried turn answers the same waiter or sender, so this one passes nothing on.
        if (!retry && info?.role === 'room') {
          const waiter = core.roomWaiters.get(info.exchangeId)
          core.roomWaiters.delete(info.exchangeId)
          const stopped = core.stoppedRoomTurns.delete(info.exchangeId)
          if (waiter !== undefined) {
            if (failure !== undefined) waiter.fail(failure)
            else waiter.resolve(reason?.kind === 'aborted' ? null : groupReply())
          } else if (!stopped && reason?.kind !== 'aborted') {
            // The round moved on without this member; how its turn ends still reaches the group.
            if (failure !== undefined) void rt.lateRoomFailure?.(id, info, failure)
            else void rt.lateRoomReply?.(id, info, groupReply(), { shown })
          }
        } else if (!retry && core.speaksInGroup(id, info)) {
          // A turn that failed before it took any input (DSH can turn it down before its first step) never names its call, so the call waiting on this Session fails.
          const inRound = failure !== undefined && info === undefined && rt.failRoomTurn?.(id, failure) === true
          if (failure !== undefined) { if (!inRound) void rt.lateRoomFailure?.(id, info ?? {}, failure) }
          else if (reason?.kind !== 'aborted') void rt.lateRoomReply?.(id, info ?? {}, groupReply(), { shown })
        } else if (!retry && info !== undefined) {
          finish(info, replyText())
        }
        for (const request of joined) {
          // A failed or stopped turn closes the request like any other; a finished
          // one hands it back to the Bot to answer next.
          if (failure !== undefined || reason?.kind === 'aborted') {
            answer(request.info, '')
            continue
          }
          void rt.deliver({
            fromId: request.info.senderSessionId,
            toId: selfId(id),
            sessionId: id,
            text: request.text,
            role: 'request',
            exchangeId: request.info.exchangeId,
            ...(request.info.senderRoomId ? { fromRoomId: request.info.senderRoomId } : {}),
            deferred: true,
          }).catch(error => rt.warn('ds-bot: deferred request delivery failed: %s', error))
        }
        break
      }
    }
  })
}

// The two halves of a cut-off turn: telling the room or the waiting work, and the
// prompt a Continue press sends. Telling never starts a model turn.
import type { HostRuntime } from './runtime.js'
import { INTERRUPTED_WORK, type TurnNote } from './resume-recovery.ts'

type ResumeHost = HostRuntime & {
  closeWork?(id: string, name: string, text: string): string | undefined
}

export const resumeText = (record: TurnNote): string => [
  'Moon Bot restarted while you were working on this, so your last turn stopped before it finished.',
  record.approval ? `You were waiting for the user's approval to run ${record.approval.tool || 'a tool'}${record.approval.reason ? ` (${record.approval.reason})` : ''}; that request is gone, so ask again if you still need it.` : '',
  'Check what is already done (files, commands, messages) before you repeat anything, then finish the task and give your reply.',
].filter(Boolean).join(' ')

const owes = (record: TurnNote): boolean => {
  const trigger = record.trigger
  return (trigger?.role === 'request' || trigger?.role === 'stopped')
    && trigger.senderSessionId !== undefined
    && trigger.audience !== 'user'
    && trigger.exchangeId !== undefined
}

/** Group log, or a result on the sender's open work. No model prompt. */
export async function tellCut(rt: ResumeHost, record: TurnNote): Promise<void> {
  const bot = rt.botOf(record.botId)
  if (bot === undefined) return
  if (record.roomId !== undefined) {
    const room = rt.roomOf(record.roomId)
    if (room === undefined || !(room.members?.includes(bot.id) ?? false)) return
    await rt.postToRoom(room, bot, '', { resumed: true, quiet: true, ...(record.resumed ? { again: true } : {}) })
    return
  }
  if (record.resumed === true || !owes(record)) return
  const exchangeId = record.trigger?.exchangeId
  if (exchangeId === undefined || rt.botOf(record.trigger?.senderSessionId) === undefined) return
  rt.closeWork?.(exchangeId, bot.name, INTERRUPTED_WORK)
}

/** The prompt Continue sends. A turn already continued once is not sent again. */
export async function deliverResume(rt: HostRuntime, sessionId: string, record: TurnNote): Promise<void> {
  const bot = rt.botOf(record.botId)
  if (bot === undefined || record.resumed === true) return
  const text = resumeText(record)
  if (record.roomId !== undefined) {
    const room = rt.roomOf(record.roomId)
    if (room === undefined || !(room.members?.includes(bot.id) ?? false)) return
    await rt.deliver({ toId: bot.id, sessionId: room.sessions?.[bot.id] ?? sessionId, role: 'room', roomId: room.id, note: 'picking up after a restart', resumed: true, text, ...(record.trigger?.askedBy ? { askedBy: record.trigger.askedBy } : {}) })
    return
  }
  const trigger = record.trigger
  const role = trigger?.role
  if (owes(record) && role !== undefined && trigger?.senderSessionId !== undefined && rt.botOf(trigger.senderSessionId)) {
    await rt.deliver({ fromId: trigger.senderSessionId, toId: bot.id, role, ...(trigger.exchangeId ? { exchangeId: trigger.exchangeId } : {}), ...(trigger.senderRoomId ? { fromRoomId: trigger.senderRoomId } : {}), resumed: true, text })
    return
  }
  await rt.deliver({ toId: bot.id, role: 'resume', resumed: true, text, ...(trigger?.work ? { work: trigger.work } : {}) })
}

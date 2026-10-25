// Group chats: the text rules every group module shares: log lines and transcripts,
// @mentions and references, notices and the wording of a member's prompt.
//
// Nothing here touches a Session or the stored state.
import type { AttachmentRef } from '../dsh-types.js'
import type { FailureText, GroupRoom, GroupSlot, RoomLine, RoomReference } from './types.ts'
import { escapeRegExp } from '../text.ts'
import { mentionSpans, speakerOf } from '../../shared/mentions.ts'
import { failureLine as failureLineImpl, failureSay as failureSayImpl } from '../turns/failure.ts'

export const ROOM_REPLY = 'Reply with your message for the group, no name prefix: in a discussion, one or two short messages. When you are asked to do something, do it now with your tools. The group does not wait for you and sees what you write while you work: say what you will do, write again only when something matters, and end with the result, never a promise to do it later. Reply [PASS] to stay silent when you have nothing new to add or the message is for someone else.'
export const ROOM_CALLS = 'Writing "@Name" calls that member next, to answer or to do what you ask; when it finishes work you gave it, you answer its result. To only mention a member, write its name without "@".'

// The mention rule reads a missing speaker name as the user, so null is its absence.
const speakerOfLine = (line: RoomLine): string | undefined | null => {
  if (line.botId === undefined) return line.who
  return line.who === undefined || line.who === null
    ? speakerOf({ botId: line.botId })
    : speakerOf({ who: line.who, botId: line.botId })
}

// `text` is what to show of a message line, by default what the log keeps of it.
export const lineText = (line: RoomLine, text: string = line.text): string => {
  if (line.kind === 'lookup') return `[${speakerOfLine(line)} looked up its own chat${line.text ? ` for "${line.text}"` : ''}]`
  if (line.kind === 'resumed') return `[${speakerOfLine(line)}'s work here was cut off when Moon Bot restarted; it is picking it back up and posts when done]`
  if (line.kind === 'cut') return `[${speakerOfLine(line)}'s work here was cut off by a restart again, so it stopped; ask it to go on if it still matters]`
  if (line.kind === 'stopped') return `[The user stopped ${speakerOfLine(line)}'s work here]`
  if (line.kind === 'done') return `[${speakerOfLine(line)} finished the work it was asked for]`
  return `${speakerOfLine(line)}: ${text}`
}
export const transcript = (lines: readonly RoomLine[], textOfLine: (line: RoomLine) => string = line => line.text): string =>
  lines.map(line => lineText(line, textOfLine(line))).join('\n')

// Models often echo the transcript format ("Name: …") despite the instruction.
export const stripOwnName = (name: string, text: string): string => text.replace(new RegExp(`^\\s*\\**${escapeRegExp(name)}\\**\\s*[:：]\\s*`), '').trim()
export const isPass = (text: string): boolean => text === '' || /^\s*[[【(（]\s*pass\s*[\]】)）]|^\s*pass\s*[.。!！]?\s*$/i.test(text)

// Who "@" calls, in order, by the same rule the bubbles draw. `references` are the
// round's referenced conversations: each one's "@label" is a reference, not a call.
// Pass every member, the speaker too, so "@新 Bot 2" said by 新 Bot 2 is never read as
// a call to 新 Bot; the caller drops the speaker.
export interface MentionMember {
  readonly id: string
  readonly name: string
}

export const mentionsIn = <T extends MentionMember>(
  text: string,
  members: readonly T[],
  references: readonly RoomReference[] | undefined = [],
): { readonly all: boolean; readonly found: T[] } => {
  const found: T[] = []
  let all = false
  const labels = (references ?? []).flatMap(reference => reference.labels)
  for (const span of mentionSpans(text, members, { references: labels })) {
    if ('all' in span) all = true
    else {
      // mentionSpans returns the member object it matched, so this is the same member.
      const bot = members.find(member => Object.is(member, span.bot))
      if (bot !== undefined && !found.includes(bot)) found.push(bot)
    }
  }
  return { all, found }
}

// What the user referenced in this round, for a member that has not been shown it yet.
export const referenceNote = (references: readonly { readonly text: string }[] | undefined): string => (references?.length
  ? `Conversations the user referenced in this round:\n\n${references.map(reference => reference.text).join('\n\n')}`
  : '')

export const slotLabel = (slot: GroupSlot): string => {
  if (slot.status === 'speaking') return `${slot.name} (you, now)`
  if (slot.status === 'posted') return `${slot.name} (posted)`
  if (slot.status === 'passed') return `${slot.name} (passed)`
  if (slot.status === 'missed') return `${slot.name} (no answer)`
  if (slot.status === 'working') return `${slot.name} (working on it; posts when done)`
  if (slot.status === 'waiting-approval') return `${slot.name} (waiting for the user's approval; posts when done)`
  if (slot.status === 'failed') return `${slot.name} (could not answer: error)`
  if (slot.status === 'left') return `${slot.name} (left the group)`
  return slot.name
}

export const adminNote = (room: GroupRoom): string => [
  'You are this group\'s admin.',
  room.mode === 'admin' ? 'Plain messages come to you first: answer them, or call the members who should answer with @Name.' : '',
  '"@all" calls every member. When the user asks, change the group with update_group.',
].filter(Boolean).join(' ')

// The opening turn of a group the user just made without a first message.
export const roomKickoff = (language: string | undefined): string => `The user just created this group and has not written yet. Greet the user in one short message and ask what they want this group to work on. Do not call members with @ yet, and do not reply [PASS]. No name prefix. Write in ${language ?? 'the user\'s language if known; otherwise Chinese'}.`

// DSH cannot open the Session at all: it is gone, or its stored log is corrupt. DSH
// reports a corrupt log only in the message of a generic failure.
export const lostSession = (error: unknown): boolean => {
  const cause: { readonly code?: unknown; readonly message?: unknown } = error !== null && typeof error === 'object' ? error : {}
  return cause.code === 'session/not-found' || /\bis corrupt\b|\bcorrupt session log\b/i.test(String(cause.message ?? ''))
}
export const fileLine = (file: AttachmentRef): string => `[File "${file.name}" (${file.bytes} bytes) attached]`

// The failure module types its parameters; the group host reads them as `FailureText`.
export const failureLine: (failure: FailureText) => string = failureLineImpl
export const failureSay: (failure: FailureText, zh?: boolean) => string = failureSayImpl

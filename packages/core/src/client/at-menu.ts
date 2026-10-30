// -------------------------------------------------------------------------
// The composer's "@" in a Bot's chat or a group chat: a Bot group that inserts
// "@Name", and the chats that "+ → Reference a chat" opens in the same menu.
// Both are sources of the shell's trigger menu; the shell's own file and session
// rows stay beside them, because a source cannot be hidden for one Session.
import { t } from './i18n.ts'
import { currentPart, relativeShort } from './text.ts'

export const BOTS_SOURCE = 'moon-bot'
export const CHATS_SOURCE = 'moon-bot-chats'
// The words the group host reads as "everyone" (groups.js ROOM_ALL).
const ROOM_ALL = ['all', 'everyone', '所有人', '全体']
const OTHER_CHATS_MAX = 8

// Just the roster fields an "@" menu reads. A Bot's chat is a chain of Sessions, so a
// Bot answers to its own id and to every part id (see sources.ts indexRoster).
export interface MentionBot {
  id: string
  name: string
  role?: string
  sessionId?: string
  parts?: readonly string[]
}
export interface MentionRoom {
  id: string
  name: string
  members: readonly string[]
  parts?: readonly string[]
}
export interface MentionRoster {
  ready?: boolean
  bots: MentionBot[]
  rooms: MentionRoom[]
  byId: Record<string, MentionBot | undefined>
  roomsById: Record<string, MentionRoom | undefined>
}

export type MentionRow =
  | { bot: MentionBot; room?: undefined; text: string }
  | { room: MentionRoom; bot?: undefined; text: string }

// One chat outside the team that a message may quote.
export interface OtherChat {
  id: string
  title?: string | undefined
  displayTitle?: string | undefined
  updatedAt?: number | undefined
  origin?: string | undefined
  blank?: boolean | undefined
}
export interface ChatList {
  byId?: Record<string, OtherChat | undefined>
  ids?: readonly string[]
}
export interface ChatRefRow {
  sessionId: string
  label: string
  bot?: MentionBot | undefined
  updatedAt?: number | undefined
}

const conversationOf = (
  roster: MentionRoster,
  sessionId: string,
): { room: MentionRoom } | { self: MentionBot } | null => {
  if (!roster.ready) return null
  const room = roster.roomsById[sessionId]
  if (room) return { room }
  const self = roster.byId[sessionId]
  return self ? { self } : null
}

// What "@query" offers: a group's members and "everyone", or in a Bot's chat every
// other Bot. Null outside the team, so a plain Session keeps the shell's menu alone.
export function mentionRows(roster: MentionRoster, sessionId: string, query = ''): MentionRow[] | null {
  const here = conversationOf(roster, sessionId)
  if (here === null) return null
  const room = 'room' in here ? here.room : null
  const selfId = 'self' in here ? here.self.id : undefined
  const bots =
    room !== null
      ? room.members.map(id => roster.byId[id]).filter((bot): bot is MentionBot => bot !== undefined)
      : roster.bots.filter(bot => bot.id !== selfId)
  const needle = query.trim().toLowerCase()
  const rows: MentionRow[] = bots
    .filter(bot => bot.name.toLowerCase().includes(needle))
    .map(bot => ({ bot, text: `@${bot.name} ` }))
  const everyone = String(t('Everyone'))
  if (room !== null && bots.length > 1 && [everyone, ...ROOM_ALL].some(word => word.toLowerCase().startsWith(needle))) {
    rows.push({ room, text: `@${everyone} ` })
  }
  return rows
}

// The chats a message here can reference: every other Bot's chat, then the latest
// conversations outside the team. Group chats stay out: a group's Session holds only
// the user's messages, so a snapshot of it would miss every Bot's reply.
export function chatRows(roster: MentionRoster, list: ChatList | undefined, sessionId: string): ChatRefRow[] {
  const here = conversationOf(roster, sessionId)
  if (here === null) return []
  const byId = list?.byId ?? {}
  const selfId = 'self' in here ? here.self.id : undefined
  const bots: ChatRefRow[] = roster.bots
    .filter(bot => bot.id !== selfId)
    .map(bot => {
      const id = String(currentPart(bot))
      return {
        sessionId: id,
        label: String(t('Chat with {name}', { name: bot.name })),
        bot,
        updatedAt: byId[id]?.updatedAt,
      }
    })
  const team = new Set<string>([
    ...roster.bots.flatMap(bot => [bot.id, String(currentPart(bot)), ...(bot.parts ?? [])]),
    ...roster.rooms.flatMap(room => [room.id, ...(room.parts ?? [])]),
  ])
  const others = (list?.ids ?? [])
    .map(id => byId[id])
    .filter(
      (row): row is OtherChat =>
        row !== undefined &&
        row.id !== sessionId &&
        !team.has(row.id) &&
        row.origin !== 'subagent' &&
        row.blank !== true,
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, OTHER_CHATS_MAX)
    .map(row => ({ sessionId: row.id, label: row.displayTitle || row.title || row.id, updatedAt: row.updatedAt }))
  return [...bots, ...others]
}

// The canonical session mention: `@[label](moon-bot-session:<base64url of the JSON id>)`.
// The host turns it into "@label" plus a read-only snapshot of that Session.
export function sessionMention(sessionId: string, label: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(sessionId))) binary += String.fromCharCode(byte)
  const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `@[${label.replace(/[\\\]]/g, mark => `\\${mark}`)}](moon-bot-session:${payload})`
}

// A trigger-menu row of the shell: only the parts a source sets are read.
interface TriggerCandidate {
  name: string
  description?: string
  icon: unknown
  section: string
  value: string
}
interface TriggerSource {
  trigger: string
  name: string
  order: number
  showGroupTitle: boolean
  candidates: (session: { sessionId: string }, query: { query: string }) => Promise<TriggerCandidate[]>
  onPick: (pair: { candidate: TriggerCandidate }) => { text: string } | { insert: Record<string, string> } | undefined
  codec?: { clipboardText: (ref: string) => string; serialize: (ref: string) => Promise<string> }
}

// `launched(sessionId)`: whether "+ → Reference a chat" opened the menu, so the chats
// never join a typed "@". `iconFor(row)` is the row's character mark.
export function atSources({
  roster,
  sessions,
  launched,
  iconFor,
}: {
  roster: { getSnapshot: () => MentionRoster }
  sessions: { list: { getSnapshot: () => ChatList } }
  launched: (sessionId: string) => boolean
  iconFor: (row: MentionRow | ChatRefRow) => unknown
}): TriggerSource[] {
  const bots: TriggerSource = {
    trigger: '@',
    name: BOTS_SOURCE,
    order: -20,
    showGroupTitle: false,
    async candidates(session, { query }) {
      return (mentionRows(roster.getSnapshot(), session.sessionId, query) ?? []).map(row => ({
        name: row.bot ? row.bot.name : String(t('Everyone')),
        ...(row.bot?.role ? { description: row.bot.role } : {}),
        ...(row.room ? { description: String(t('{count} members', { count: row.room.members.length })) } : {}),
        icon: iconFor(row),
        section: String(t('Bots')),
        value: row.text,
      }))
    },
    onPick: ({ candidate }) => (candidate.value ? { text: candidate.value } : undefined),
  }
  const chats: TriggerSource = {
    trigger: '@',
    name: CHATS_SOURCE,
    order: -10,
    showGroupTitle: false,
    async candidates(session) {
      if (!launched(session.sessionId)) return []
      return chatRows(roster.getSnapshot(), sessions.list.getSnapshot(), session.sessionId).map(row => ({
        name: row.bot ? row.bot.name : row.label,
        ...(row.updatedAt ? { description: String(relativeShort(row.updatedAt)) } : {}),
        icon: row.bot ? iconFor(row) : 'session',
        section: row.bot ? String(t('Bots')) : String(t('Conversations')),
        value: JSON.stringify({ sessionId: row.sessionId, label: row.label }),
      }))
    },
    onPick({ candidate }) {
      const { sessionId, label } = JSON.parse(candidate.value)
      const mention = sessionMention(sessionId, label)
      return { insert: { source: CHATS_SOURCE, ref: mention, label, appearance: 'session', clipboardText: mention } }
    },
    codec: { clipboardText: (ref: string) => ref, serialize: (ref: string) => Promise.resolve(ref) },
  }
  return [bots, chats]
}

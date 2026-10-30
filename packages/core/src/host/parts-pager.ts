// The chat's view of earlier parts: a Bot's own chat as one conversation, newest page
// first, each part read through the Session controller and drawn as its own rows.
// `parts.ts` owns what a part is; this module only pages and formats it.
import { HISTORY_TIMEOUT_MS, REPLY_KIND, SOURCE_KIND } from './constants.ts'
import { readReply, replyText } from './parts-text.ts'
import { textOf } from './text.ts'
import type { SessionEvent } from './host-types.js'
import type { HostRuntime } from './runtime.js'
import type { SwitchPart } from './parts-switch-move.ts'
import type { ChatItem, ChatPage, EarlierPage, PageCursor, PartPage } from './parts-types.js'
import { PROACTIVE_KIND } from './constants.ts'

const EARLIER_PAGE = 60

export interface PartPagerOptions {
  readonly rt: HostRuntime
  /** A Bot's parts, oldest first; the last one is current. */
  partsOf(botId: string, roomId?: string): readonly SwitchPart[]
}

export interface PartPager {
  displayItems(partId: string, events: readonly SessionEvent[]): ChatItem[]
  earlierPage(sessionId: string, cursor: PageCursor | undefined): Promise<EarlierPage>
  chatPage(botId: string, cursor: PageCursor | undefined): Promise<ChatPage>
}

export function createPartPager(options: PartPagerOptions): PartPager {
  const { rt, partsOf } = options
  const { ctx, state } = rt

  function displayItems(partId: string, events: readonly SessionEvent[]): ChatItem[] {
    const hidden = new Set(state.exchangeTurns[partId] ?? [])
    const items: ChatItem[] = []
    for (const event of events) {
      const data = (event.data ?? {}) as Record<string, unknown>
      const time = event.time as number
      if (event.type === 'assistant/message') {
        if (hidden.has(Number(data.turn))) continue
        // One entry per text block: the chat shows each block in a bubble of its own.
        const message = data.message as { readonly content?: unknown } | undefined
        const content: readonly unknown[] = Array.isArray(message?.content) ? message.content : []
        for (const raw of content) {
          const block = raw as { readonly type?: unknown; readonly text?: unknown } | undefined
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') items.push({ kind: 'bot', text: block.text, time })
        }
        continue
      }
      // A failed turn: the live `turn/end` reason, or the row the engine stored for it
      // (the page reads that back as `turn/error`). A turn hidden from the chat stays out.
      if (event.type === 'turn/end' || event.type === 'turn/error') {
        const turn = Number(data.turn)
        if (hidden.has(turn)) continue
        const error = (event.type === 'turn/end'
          ? (data.reason as { readonly kind?: unknown; readonly error?: unknown } | undefined)?.kind === 'error'
            ? (data.reason as { readonly error?: unknown }).error
            : undefined
          : data.error) as { readonly code?: unknown; readonly message?: unknown } | undefined
        if (error === null || typeof error !== 'object') continue
        items.push({
          kind: 'error',
          ...(typeof error.code === 'string' && error.code !== '' ? { code: error.code } : {}),
          ...(typeof error.message === 'string' && error.message.trim() !== '' ? { text: error.message.trim() } : {}),
          time,
        })
        continue
      }
      if (event.type !== 'user/message') continue
      const source = data.source as {
        readonly kind?: unknown
        readonly handoff?: unknown
        readonly deferred?: unknown
        readonly role?: unknown
        readonly senderSessionId?: unknown
        readonly senderName?: unknown
        readonly roomId?: unknown
      } | undefined
      if (source?.kind === 'user' || source?.kind === PROACTIVE_KIND) {
        const content: readonly unknown[] = Array.isArray(data.content) ? data.content : []
        const images = content.filter(raw => (raw as { readonly type?: unknown } | undefined)?.type === 'image').length
        // A message the Bot brought up itself reads as a user row — the Bot answers it — but
        // it carries the mark so the interface never pretends the user typed it.
        const proactive = source?.kind === PROACTIVE_KIND || undefined
        items.push({ kind: 'user', text: textOf(content), ...(images > 0 ? { images } : {}), ...(proactive === true ? { proactive: true } : {}), time })
      } else if (source?.kind === REPLY_KIND) {
        const text = textOf(data.content)
        const reply = readReply(text)
        if (reply?.questions !== undefined) items.push({ kind: 'answer', questions: reply.questions, answers: reply.answers, time })
        else if (reply?.views !== undefined) items.push({ kind: 'answer', text: replyText(text), views: reply.views, answers: reply.answers, time })
      } else if (source?.kind === SOURCE_KIND && source.handoff !== true && source.deferred !== true && ['request', 'reply', 'report', 'stopped'].includes(source.role as string)) {
        items.push({
          kind: 'event', role: source.role,
          botId: (source.senderSessionId ?? null) as string | null, name: (source.senderName ?? null) as string | null,
          roomId: (source.roomId ?? null) as string | null, time,
        })
      }
    }
    return items
  }

  async function partPage(parts: readonly SwitchPart[], index: number, cursor: PageCursor | undefined): Promise<PartPage> {
    const part = parts[index] as SwitchPart
    const agent = await rt.resolveAgent(part.sessionId)
    const beforeSeq = Number.isInteger(cursor?.beforeSeq) ? cursor?.beforeSeq as number : undefined
    const page = await ctx.sessionController.page({
      address: { kind: 'session', sessionId: part.sessionId },
      throughSeq: Number(agent.session.seq) - 1,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: EARLIER_PAGE,
    }, AbortSignal.timeout(HISTORY_TIMEOUT_MS))
    const events = page.records.map(record => record.event)
    const items = displayItems(part.sessionId, events)
    const more = page.hasMore && events.length > 0
    // The line above a part's first message marks where it began.
    if (!more && index > 0) items.unshift({ kind: 'divider', time: part.startedAt })
    return { items, cursor: more ? { part: index, beforeSeq: events[0]?.seq } : index > 0 ? { part: index - 1 } : null }
  }

  async function earlierPage(sessionId: string, cursor: PageCursor | undefined): Promise<EarlierPage> {
    const past = rt.pastOwners.get(sessionId)
    const botId = rt.chatOwners.get(sessionId) ?? (past?.roomId === undefined ? past?.botId : undefined)
    const parts = botId === undefined ? [] : partsOf(botId)
    const at = parts.findIndex(part => part.sessionId === sessionId)
    const index = Number.isInteger(cursor?.part) ? cursor?.part as number : at - 1
    if (at <= 0 || index < 0 || index >= at) return { items: [], cursor: null, startedAt: parts[at]?.startedAt ?? null }
    return { ...(await partPage(parts, index, cursor)), startedAt: (parts[at] as SwitchPart).startedAt }
  }

  // A Bot's whole own chat, newest page first: the current part, then the earlier
  // ones, for a window that draws the conversation itself.
  async function chatPage(botId: string, cursor: PageCursor | undefined): Promise<ChatPage> {
    const parts = partsOf(botId)
    if (parts.length === 0) throw Object.assign(new Error('Unknown Bot'), { code: 'bot/not-found' })
    const index = Number.isInteger(cursor?.part) ? (cursor?.part as number) : parts.length - 1
    const last = parts.at(-1) as SwitchPart
    if (index < 0 || index >= parts.length) return { sessionId: last.sessionId, items: [], cursor: null }
    return { sessionId: last.sessionId, ...(await partPage(parts, index, cursor)) }
  }

  return { displayItems, earlierPage, chatPage }
}

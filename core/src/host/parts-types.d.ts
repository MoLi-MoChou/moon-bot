// The shapes parts.ts works with: the compaction engines DS Bot wraps, a Bot's parts as
// the chat pages them, and a request on its way through `llm/stream`.
//
// Types only: nothing here runs. They sit beside parts.ts, as runtime.d.ts does for the
// host, so the module itself stays a logic file under the size gate.
import type { SessionEvent } from './host-types.js'

/** A compaction engine, as the host hands it over: an object DS Bot marks and wraps. */
export type CompactionEngine = Record<PropertyKey, unknown>

/** One part of a Bot's conversation, oldest first; the last one is current. */
export interface PartEntry {
  readonly sessionId: string
  readonly number: number
  readonly startedAt: number
  readonly endedAt?: number | undefined
}

/** Where the next page of a part starts. */
export interface PageCursor {
  readonly part?: number | undefined
  readonly beforeSeq?: number | undefined
}

/** One row the chat draws above the current part. */
export interface BotItem {
  readonly kind: 'bot'
  readonly text: string
  readonly time: number
}

export interface UserItem {
  readonly kind: 'user'
  readonly text: string
  readonly images?: number | undefined
  readonly time: number
}

export interface AnswerItem {
  readonly kind: 'answer'
  readonly questions?: unknown
  readonly answers?: unknown
  readonly views?: unknown
  readonly text?: string | undefined
  readonly time: number
}

export interface EventItem {
  readonly kind: 'event'
  readonly role: unknown
  readonly botId: string | null
  readonly name: string | null
  readonly roomId: string | null
  readonly time: number
}

export interface DividerItem {
  readonly kind: 'divider'
  readonly time: number
}

/**
 * A turn that failed, drawn as one line in the chat: the code names the reason (a key
 * the model refused, an endpoint it could not reach), and `text` is the model's own
 * words when there are any.
 */
export interface ErrorItem {
  readonly kind: 'error'
  readonly code?: string | undefined
  readonly text?: string | undefined
  readonly time: number
}

export type ChatItem = BotItem | UserItem | AnswerItem | EventItem | DividerItem | ErrorItem

/** One page of an earlier part. */
export interface PartPage {
  readonly items: ChatItem[]
  readonly cursor: PageCursor | null
}

export interface EarlierPage extends PartPage {
  readonly startedAt: number | null
}

export interface ChatPage extends PartPage {
  readonly sessionId: string
}

/** A message on its way through `llm/stream`, as the handoff acknowledgement reads it. */
export interface RelayMessage {
  readonly role?: string | undefined
  readonly content?: unknown
  readonly source?: {
    readonly kind?: unknown
    readonly handoff?: unknown
    readonly resume?: unknown
    readonly deferred?: unknown
    readonly role?: unknown
  } | undefined
}

export interface RelayRequest {
  readonly sessionId?: string | undefined
  readonly purpose?: string | undefined
  readonly messages?: readonly RelayMessage[] | undefined
}

export type RelayNext = () => unknown

/** The events one page carries. */
export type PartEvents = readonly SessionEvent[]

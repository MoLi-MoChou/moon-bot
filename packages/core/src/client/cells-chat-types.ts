import type { ReactNode } from 'react'
import type { AnsweredReply } from './widget-cell.tsx'
import type { CellActions, CellsUiState, ChatRoster, StoreHook } from './cells-bubbles.tsx'

export const SEPARATOR_GAP_MS = 30 * 60 * 1000
// -------------------------------------------------------------------------
// A Bot chat's entries, as the host lists them
export interface ChatBotItem {
  kind: 'bot'
  text: string
  time?: number | undefined
}
export interface ChatUserItem {
  kind: 'user'
  text?: string | undefined
  images?: number | undefined
  /** Set when the Bot brought this up on its own; the row says so. */
  proactive?: boolean | undefined
  time?: number | undefined
}
export interface ChatDividerItem {
  kind: 'divider'
  time?: number | undefined
}
/** The answered-reply payload a chat row carries; the renderer takes it whole. */
export type AnswerData = NonNullable<NonNullable<NonNullable<Parameters<typeof AnsweredReply>[0]>['node']>['data']>
export type ChatAnswerItem = {
  kind: 'answer'
  time?: number | undefined
} & AnswerData
export interface ChatEventItem {
  kind: 'event'
  role?: string | undefined
  roomId?: string | undefined
  botId?: string | undefined
  name?: string | undefined
  time?: number | undefined
}
/**
 * A turn that failed: the code names the reason (`NO-MODEL`, `AUTH`, `TRANSPORT`…), and
 * `text` is the model's own words when it left any. A person sees the reason, not the
 * code; a quiet failure the user could not see was the bug this row exists for.
 */
export interface ChatErrorItem {
  kind: 'error'
  code?: string | undefined
  text?: string | undefined
  time?: number | undefined
}
export type ChatItem = ChatBotItem | ChatUserItem | ChatDividerItem | ChatAnswerItem | ChatEventItem | ChatErrorItem
export interface ChatStackedBot {
  kind: 'bot'
  texts: string[]
  time?: number | undefined
  end?: number | undefined
}
export type ChatStackedRow = ChatStackedBot | Exclude<ChatItem, ChatBotItem>
export interface ChatRowsProps {
  items: readonly ChatItem[]
  sessionId: string
  roster: ChatRoster
  actions: CellActions
  useUi?: StoreHook<CellsUiState> | undefined
  clock?: boolean | undefined
}
export interface PartLineProps {
  time?: number | undefined
}
export interface EarlierView {
  items: readonly ChatItem[]
  cursor?: string | undefined
  loading: boolean
  failed: boolean
  startedAt?: number | undefined
}
export interface ChatRowContext {
  sessionId: string
  selfId: string | undefined
  roster: ChatRoster
  actions: CellActions
  useUi?: StoreHook<CellsUiState> | undefined
}
export interface ShimmerProps {
  children?: ReactNode
}
export interface ElapsedProps {
  at: number
  className?: string | undefined
}
export interface EarlierUserProps {
  row: ChatUserItem
}
export interface EarlierPartsProps {
  sessionId: string
  roster: ChatRoster
  actions: CellActions
}

/** Types for chat-index. */
import type { DatabaseSync, StatementSync } from 'node:sqlite'

export interface LineRow {
  readonly text: string
  readonly session: string
  readonly seq: number
  readonly time: number
  readonly who: string
}
export interface MarkRow {
  readonly through: number
  readonly keep: number
  readonly sealed: number
  readonly turn: number
}
export interface ChatIndex {
  readonly db: DatabaseSync
  readonly mark: StatementSync
  readonly setMark: StatementSync
  readonly insert: StatementSync
  readonly before: StatementSync
  readonly from: StatementSync
}
export interface ChatPart {
  readonly sessionId: string
  readonly number: number
  readonly startedAt: number
  readonly endedAt?: number | undefined
}
export interface HiddenTurn {
  readonly session: string | undefined
  readonly from: number
}
export interface TermQuery {
  readonly sql: string
  readonly args: readonly (string | number)[]
}

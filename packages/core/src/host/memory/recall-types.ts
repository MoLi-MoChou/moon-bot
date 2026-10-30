/** Types extracted. */
import type { StoredBot } from '../runtime.ts'
// Reading memory: the recall tool, and the memory panel with its summary, its
// "ask or update" call and its per-entry removal. All changes go through the same
// storage path as the tools and the review.

export interface Caller {
  readonly bot: StoredBot
  readonly sessionId: string
  readonly roomId: string | undefined
}

export interface PanelEntry {
  readonly scope: string
  readonly topic: string | null
  readonly text: string
  readonly added: string | null
  readonly by: string | null
  readonly source: string | null
}

export interface MemoryView {
  readonly roomId?: string | undefined
  readonly botId?: string | undefined
  readonly entries: readonly PanelEntry[]
  readonly sizes: Readonly<Record<string, number>>
  readonly limits: { readonly entry: number; readonly main: number; readonly topic: number; readonly topics: number }
  readonly summary: { readonly text: string; readonly at?: number | undefined } | null
  readonly fresh: boolean
  readonly summarizing: boolean
  readonly error: string | null
}

export interface AskAnswer {
  readonly op: string
  readonly scope: string
  readonly text: string
  readonly before?: string | undefined
  readonly ok: boolean
  readonly error?: string | undefined
}

export interface AskResult {
  readonly reply: string
  readonly changes: readonly AskAnswer[]
  readonly view: MemoryView
}

export interface Summary {
  readonly hash: string
  readonly text: string
  readonly at?: number | undefined
}

export interface SummaryFailure {
  readonly hash: string
  readonly model: string | undefined
  readonly message: string
}

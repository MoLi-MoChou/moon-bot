/** Types for client text helpers. */
export interface TextBot {
  id: string
  name: string
}
export interface ContentBlock {
  type?: string
  text?: string
}
export interface SummaryBlock {
  kind: 'p' | 'h'
  text: string
}
export interface ToolCallRoot {
  name?: string
  call?: { name?: string; argsRaw?: string }
  argsRaw?: string
  args?: { text?: (key: string) => string | undefined; value?: (key: string) => unknown }
}
export interface ToolArguments {
  text(key: string): string | undefined
  value(key: string): unknown
}
export interface RelaySource {
  kind?: string
  handoff?: boolean
  deferred?: boolean
  resumed?: boolean
  retried?: boolean
  role?: string
  senderSessionId?: string
}
export interface ChatBlock {
  kind?: string
  text?: string
}
export interface ChatStep {
  step?: number
  time?: number
  blocks?: ChatBlock[]
}
export interface RelayContext {
  source?: RelaySource | null
  time?: number
}
export interface CommRun {
  count: number
  peerIds: string[]
}
export interface TokenUsage {
  uncachedInputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
}
export interface OutlineEntry {
  turn?: number
  response?: string
  prompt?: string
}
export interface ProjectionValues {
  turnOutline?: OutlineEntry[]
  tokenUsage?: TokenUsage
}
export interface PreviewList {
  projectionsBySession?: Record<string, { values?: ProjectionValues } | undefined>
  byId?: Record<string, { projectionValues?: ProjectionValues } | undefined>
}
export interface RunStatsValues {
  sessionStats?: { turns?: number; decodeMs?: number; decodeTokens?: number }
  tokenUsage?: TokenUsage
  contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number }
}
export interface RunStat {
  key: string
  text: string
  title?: string
}

// The pure part of the usage ledger: Session events, oldest first, folded into one row
// per billed attempt. Nothing here touches the disk, the runtime or a Session.
import type { SessionEvent } from '../host-types.js'

/** The attempt a step is on: `llm/retry-started` moves it forward. */
export interface RetryState {
  readonly turn?: number | undefined
  readonly step?: number | undefined
  readonly count: number
}

/** Where a fold stopped: the model named last, and the attempt still open. */
export interface FoldState {
  provider: string
  model: string
  retry: RetryState | null
}

/** A fold resumed from `marks.fold`, so every field is optional. */
export interface FoldSnapshot {
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly retry?: RetryState | null | undefined
}

/** What one model call billed. */
export interface TokenTotals {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/** One billed attempt, before its Session is known. */
export interface FoldedRow extends TokenTotals {
  readonly key: string
  readonly time: number
  readonly provider: string
  readonly model: string
}

/** A fold's one read of a Session log. */
export interface FoldedCall {
  readonly rows: readonly FoldedRow[]
  readonly state: FoldState
  readonly reset: boolean
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

function usageChunk(stream: unknown): unknown {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = recordOf(stream[index])
    if (record?.type !== 'chunk') continue
    const chunk = recordOf(record.chunk)
    if (chunk?.type === 'usage') return chunk.usage
  }
  return undefined
}

/** The four token counts a `usage` payload names, missing or bad ones as zero. */
export function tokensOf(usage: unknown): TokenTotals {
  const sample = (typeof usage === 'object' && usage !== null ? usage : {}) as Readonly<Record<string, unknown>>
  return {
    input: count(sample.inputTokens),
    cacheRead: count(sample.cacheReadTokens),
    cacheWrite: count(sample.cacheWriteTokens),
    output: count(sample.outputTokens),
  }
}

// Folds Session events, oldest first, into one row per billed attempt, as the host's own
// tokenUsage projection counts them: a later sample of one attempt replaces the earlier
// one, and `llm/retry-started` begins a new attempt. The model is the one the latest
// request header named. A fork's events up to its inherited cut are the parents', so
// the cut drops the rows before it (`reset`).
export function foldCalls(events: readonly SessionEvent[], from: FoldSnapshot = {}): FoldedCall {
  const state: FoldState = { provider: from.provider ?? '', model: from.model ?? '', retry: from.retry ?? null }
  const rows = new Map<string, FoldedRow>()
  let reset = false
  for (const event of events) {
    const data = event.data ?? {}
    switch (event.type) {
      case 'request/header': {
        const config = recordOf(recordOf(data.header)?.config)
        if (
          typeof config?.provider === 'string' &&
          config.provider !== '' &&
          typeof config.model === 'string' &&
          config.model !== ''
        ) {
          state.provider = config.provider
          state.model = config.model
        }
        break
      }
      case 'request/context':
        if (
          typeof data.provider === 'string' &&
          data.provider !== '' &&
          typeof data.model === 'string' &&
          data.model !== ''
        ) {
          state.provider = data.provider
          state.model = data.model
        }
        break
      case 'llm/retry-started': {
        const retry = state.retry
        state.retry =
          retry !== null && retry.turn === data.turn && retry.step === data.step
            ? { ...retry, count: retry.count + 1 }
            : { turn: data.turn, step: data.step, count: 1 }
        break
      }
      case 'session/end-seed':
        if (data.inherited === true) {
          rows.clear()
          reset = true
        }
        break
      case 'assistant/message':
      case 'assistant/attempt': {
        const usage = (event.type === 'assistant/message' ? data.usage : undefined) ?? usageChunk(data.stream)
        if (usage === undefined || usage === null) break
        const retry = state.retry
        const attempt = retry !== null && retry.turn === data.turn && retry.step === data.step ? retry.count : 0
        const key = `${data.turn}:${data.step}:${attempt}`
        rows.set(key, {
          key,
          time: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0,
          provider: state.provider,
          model: state.model,
          ...tokensOf(usage),
        })
        break
      }
      default:
        break
    }
  }
  return { rows: [...rows.values()], state, reset }
}

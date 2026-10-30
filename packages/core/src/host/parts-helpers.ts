// Limits and token metering for parts install.
import { estimateTokens, textOf } from './text.ts'
import type { HostContext } from './host-types.js'
import type { HostRuntime } from './runtime.js'
import type { SwitchSession } from './parts-switch-move.ts'

export interface PartLimits {
  readonly RECENT_TOKENS: number
  readonly RECENT_LINE_MAX: number
  readonly LIST_TOKENS: number
  readonly LIST_LINE_MAX: number
  readonly HANDOFF_READ_MS: number
  readonly NOTE_MAX_TOKENS: number
  readonly NOTE_TIMEOUT_MS: number
  readonly NOTE_ATTEMPTS: number
  readonly NOTE_COOLDOWN_MS: readonly number[]
  readonly ORIGINAL_COMPACT: symbol
  readonly STEWARD_MAX_TOKENS: number
  readonly STEWARD_TIMEOUT_MS: number
  readonly STEWARD_LINES: number
}

export const partLimits = (config: { handoffRecentTokens?: number; handoffListTokens?: number }): PartLimits => ({
  RECENT_TOKENS: config.handoffRecentTokens ?? 16_384,
  RECENT_LINE_MAX: 4_000,
  LIST_TOKENS: config.handoffListTokens ?? 4_096,
  LIST_LINE_MAX: 400,
  HANDOFF_READ_MS: 60_000,
  NOTE_MAX_TOKENS: 8_192,
  NOTE_TIMEOUT_MS: 600_000,
  NOTE_ATTEMPTS: 2,
  NOTE_COOLDOWN_MS: [60_000, 300_000, 900_000],
  ORIGINAL_COMPACT: Symbol.for('moon-bot/compaction'),
  STEWARD_MAX_TOKENS: 4_096,
  STEWARD_TIMEOUT_MS: 120_000,
  STEWARD_LINES: 40,
})

interface TokenMeter {
  measure(session: SwitchSession): { readonly totalTokens?: number }
}

/** Token count for a Session, preferring the host meter and falling back to an estimate. */
export const createTokensOf = (
  rt: Pick<HostRuntime, 'warn'>,
  context: HostContext,
): ((session: SwitchSession) => number | undefined) => {
  let measureWarned = false
  return (session: SwitchSession): number | undefined => {
    try {
      return (context.get('tokenMeter') as TokenMeter | undefined)?.measure(session).totalTokens
    } catch (error) {
      if (!measureWarned) {
        measureWarned = true
        rt.warn('moon-bot: token measure failed; context sizes are estimated: %s', error)
      }
    }
    try {
      return estimateTokens(
        session
          .deriveMessages()
          .map(message => textOf((message as { readonly content?: unknown }).content))
          .join('\n'),
      )
    } catch {
      return undefined
    }
  }
}

// A user's request to condense the current part in place. It refuses while a turn is
// running, a delivery is still unread, or the part is already moving: a switch cuts a
// turn off, so this path never decides to switch. The only writer is the idle
// `condense` the steward already uses.
import type { Lines, SwitchAgent } from './parts-switch-move.ts'

/** Sentences the client translates. The key is the English the host returns. */
export const COMPACT_REASONS = {
  readonly: 'Another window is using this team, so this chat was not condensed.',
  running: 'This chat is in the middle of a turn, so it was not condensed.',
  unread: 'This chat still has a message waiting to be read, so it was not condensed.',
  switching: 'This chat is moving to a new part, so it was not condensed.',
  busy: 'This chat was busy, so it was not condensed.',
  'no-engine': 'This chat has no way to condense in place.',
  unchanged: 'Condensing this chat did not make room.',
  missing: 'That chat is not open, so it was not condensed.',
} as const

export type CompactAnswer =
  | { readonly compacted: true }
  | { readonly compacted: false; readonly reason: string }

export interface CompactDeps {
  readOnly(): boolean
  running(sessionId: string): boolean
  unread(sessionId: string): boolean
  switching(sessionId: string): boolean
  resolve(sessionId: string): Promise<SwitchAgent | undefined>
  lines(agent: SwitchAgent): Promise<Lines>
  prepare(agent: SwitchAgent): void
  engine(agent: SwitchAgent): boolean
  condense(agent: SwitchAgent, lines: Lines): Promise<boolean | undefined>
}

/** The manual-compact entry. One session condenses at a time; a second ask waits. */
export function createContextCompact(deps: CompactDeps): (sessionId: string) => Promise<CompactAnswer> {
  const inflight = new Set<string>()
  return async function compactChat(sessionId: string): Promise<CompactAnswer> {
    const refused = deps.readOnly() ? COMPACT_REASONS.readonly
      : deps.running(sessionId) ? COMPACT_REASONS.running
      : deps.unread(sessionId) ? COMPACT_REASONS.unread
      : deps.switching(sessionId) ? COMPACT_REASONS.switching
      : inflight.has(sessionId) ? COMPACT_REASONS.busy
      : undefined
    if (refused !== undefined) return { compacted: false, reason: refused }
    inflight.add(sessionId)
    try {
      const agent = await deps.resolve(sessionId)
      if (agent?.session === undefined) return { compacted: false, reason: COMPACT_REASONS.missing }
      deps.prepare(agent)
      if (!deps.engine(agent)) return { compacted: false, reason: COMPACT_REASONS['no-engine'] }
      const result = await deps.condense(agent, await deps.lines(agent))
      if (result === true) return { compacted: true }
      if (result === undefined) return { compacted: false, reason: COMPACT_REASONS.busy }
      return { compacted: false, reason: COMPACT_REASONS.unchanged }
    } finally {
      inflight.delete(sessionId)
    }
  }
}

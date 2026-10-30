// Reading one part for what a handoff or a checkpoint carries: the latest messages word
// for word, and before them the messages to the Bot as an anchored list. The part reader
// and the clock come in from `parts.ts`, so nothing here touches the Session record.
import { clip, estimateTokens } from './text.ts'
import type { HandoffLines } from './parts-switch-move.ts'
import type { PartReadDeps, PartSpan } from './parts-note-types.js'

// What a fresh part carries of the part that ends, read newest first: the latest messages
// word for word, and before them, in the Bot's own chat, every message to the Bot (from the
// user or another Bot) as an anchored list. A group turn message holds the whole round, so a
// group part carries only its latest messages.
export async function partHandoffLines(
  deps: PartReadDeps,
  sessionId: string,
  { budget, group, number }: PartSpan,
): Promise<HandoffLines> {
  const { clock, partLines, warn } = deps
  const { recentLineMax, listLineMax, listTokens, handoffReadMs } = deps.limits
  const recent: string[] = []
  const earlier: string[] = []
  let used = 0
  let full = false
  let listed = 0
  let unlisted = 0
  let complete = true
  const stamp = (line: { readonly time: number; readonly seq: number }): string =>
    group ? `[${clock(line.time)}]` : `[part ${number} #${line.seq} · ${clock(line.time)}]`
  try {
    for await (const line of partLines(sessionId, AbortSignal.timeout(handoffReadMs), { group, pages: Infinity })) {
      if (!full) {
        const text = clip(
          line.text,
          recentLineMax,
          group
            ? 'the full text is in the saved record'
            : `read_own_chat around "part ${number} #${line.seq}" shows all of it`,
        )
        const cost = estimateTokens(text)
        if (recent.length === 0 || used + cost <= budget) {
          recent.push(`${stamp(line)} ${text}`)
          used += cost
          continue
        }
        full = true
      }
      if (group) break
      if (line.who === 'you') continue
      const text = clip(line.text, listLineMax, `read_own_chat around "part ${number} #${line.seq}" shows all of it`)
      const cost = estimateTokens(text)
      if (unlisted > 0 || listed + cost > listTokens) {
        unlisted += 1
        continue
      }
      earlier.push(`${stamp(line)} ${text}`)
      listed += cost
    }
  } catch (error) {
    // The latest messages matter most; what could not be read is only noted.
    if (recent.length === 0) throw error
    complete = false
    warn('moon-bot: reading %s for its handoff stopped early: %s', sessionId, error)
  }
  // `whole`: every message of the part is in `recent`.
  return { recent: recent.reverse(), earlier: earlier.reverse(), unlisted, complete, whole: complete && !full }
}

// The messages to the Bot in this part, newest kept first within the budget, as a
// checkpoint carries them. Read from the saved record, so messages an earlier checkpoint
// condensed are there too.
export async function partKeptMessages(
  deps: PartReadDeps,
  sessionId: string,
  { budget, group, number }: PartSpan,
): Promise<{ readonly kept: string[]; readonly more: boolean }> {
  const { clock, partLines } = deps
  const { recentLineMax, handoffReadMs } = deps.limits
  const kept: string[] = []
  let used = 0
  let more = false
  for await (const line of partLines(sessionId, AbortSignal.timeout(handoffReadMs), { group, pages: Infinity })) {
    if (line.who === 'you') continue
    const text = `${group ? `[${clock(line.time)}]` : `[part ${number} #${line.seq} · ${clock(line.time)}]`} ${clip(line.text, recentLineMax, 'read_own_chat shows all of it')}`
    const cost = estimateTokens(text)
    if (kept.length > 0 && used + cost > budget) {
      more = true
      break
    }
    kept.push(text)
    used += cost
  }
  return { kept: kept.reverse(), more }
}

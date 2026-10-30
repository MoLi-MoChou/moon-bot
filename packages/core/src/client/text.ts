import { hostText, t } from './i18n.ts'
import type {
  ContentBlock,
  SummaryBlock,
  ToolCallRoot,
  ToolArguments,
  RelaySource,
  ChatStep,
  RelayContext,
  CommRun,
  PreviewList,
  TokenUsage,
  RunStatsValues,
  RunStat,
} from './text-types.ts'
export type {
  TextBot,
  ContentBlock,
  SummaryBlock,
  ToolCallRoot,
  ToolArguments,
  RelaySource,
  ChatStep,
  RelayContext,
  CommRun,
  PreviewList,
  TokenUsage,
  RunStatsValues,
  RunStat,
} from './text-types.ts'
export { MENTION_ORIGIN, linkMentions, mentionTarget } from './text-mentions.ts'

// -------------------------------------------------------------------------
// Text helpers
export { clockLabel, dayLabel, elapsedLabel, messageClock, relativeShort } from './text-time.ts'

export const contentText = (content?: readonly ContentBlock[]): string =>
  (content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
// A name can contain brackets. Generated headers end at the newline; without a
// newline, a legacy inline header still stops at its first closing bracket.
export const HEADER =
  /^\[(Message from|Reply from|Group chat|Group post from|Bot team setup|Handoff · part|Secret card)(?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/
export const currentPart = (bot: { sessionId?: string; id?: string }): string => bot.sessionId ?? bot.id ?? ''
// The prompts in a due scheduled task's message. the host frames it for the model: one
// task as `reminder_prompt_json: "…"`, several as `reminders_json: [{reminder_prompt}]`.
export function reminderPrompts(text: string): string[] {
  const one = /^reminder_prompt_json: (.*)$/m.exec(text)
  const batch = /^reminders_json: (.*)$/m.exec(text)
  try {
    const single: unknown[] = one ? [JSON.parse(one[1] ?? '') as unknown] : []
    const many: unknown[] = batch
      ? (JSON.parse(batch[1] ?? '') as { reminder_prompt?: unknown }[]).map(entry => entry.reminder_prompt)
      : []
    const prompts = [...single, ...many]
    return prompts.filter((prompt): prompt is string => typeof prompt === 'string' && prompt.trim() !== '')
  } catch {
    // An unreadable framing shows as the plain "Routine started" line.
    return []
  }
}
export const stripHeader = (text: string): string => text.replace(HEADER, '')

// Of the Bots in a conversation, the one whose memory changed last, by the host's
// clock: changes reaching one window in the same poll share a `seen` time.
export function latestMemoryChange(
  news: Record<string, { seen?: number | undefined; at?: number | undefined } | undefined> | undefined,
  ids: readonly string[],
): string | null {
  const at = (id: string): number => (news?.[id]?.seen ? (news[id]?.at ?? 0) : 0)
  return ids.reduce<string | null>((best, id) => (at(id) > (best === null ? 0 : at(best)) ? id : best), ids[0] ?? null)
}

// A memory summary is "## Heading" lines, each over one paragraph; stray Markdown
// marks and list bullets are dropped.
export function summaryBlocks(text: unknown): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/\*\*|__/g, '')
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'h', text: (heading[1] ?? '').trim() })
    } else if (line === '') {
      flush()
    } else {
      paragraph.push(line.replace(/^[-*•]\s+/, ''))
    }
  }
  flush()
  return blocks
}

export function isHiddenTurn(
  roster: { exchangeTurns?: Record<string, readonly number[] | undefined> },
  sessionId: string | undefined | null,
  turn: number | undefined | null,
): boolean {
  if (sessionId === undefined || sessionId === null || turn === undefined || turn === null) return false
  return (roster.exchangeTurns?.[sessionId] ?? []).includes(turn)
}

export const toolName = (root: ToolCallRoot): string | undefined => root.name || root.call?.name

export function toolArgs(root: ToolCallRoot): ToolArguments {
  if (typeof root.args?.text === 'function') {
    return {
      text: (key: string) => root.args?.text?.(key) ?? undefined,
      value: (key: string) => (typeof root.args?.value === 'function' ? root.args.value(key) : undefined),
    }
  }
  let parsed: unknown
  let read = false
  const object = (): Record<string, unknown> | null => {
    if (!read) {
      read = true
      try {
        parsed = JSON.parse(root.argsRaw ?? root.call?.argsRaw ?? '') as unknown
      } catch {
        parsed = null
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = null
    }
    return parsed as Record<string, unknown> | null
  }
  return {
    text: (key: string) => {
      const value = object()?.[key]
      return typeof value === 'string' ? value : undefined
    },
    value: (key: string) => object()?.[key],
  }
}

// A relay context is a Bot-to-Bot request, reply or stop notice injected into the
// model's history. Moon Bot's own package sources (kickoff, room, secret, handoff
// parts) are not events in the chat, nor is a request handed back after its line was
// already shown: deferred, resumed after a restart, or retried after a tool call
// written as text.
const RELAY_ROLES = new Set<string>(['request', 'reply', 'stopped'])
export const isRelayContext = (data: { source?: RelaySource | null } | undefined): boolean => {
  const source = data?.source
  if (
    source === null ||
    source === undefined ||
    typeof source !== 'object' ||
    source.kind !== 'bot' ||
    source.handoff === true
  )
    return false
  if (source.deferred === true || source.resumed === true || source.retried === true) return false
  return source.role !== undefined && RELAY_ROLES.has(source.role) && typeof source.senderSessionId === 'string'
}

// 'context' chat nodes never reach the flow on the host, so a relay spliced into
// a running turn would be invisible; the step that answers it renders the line.
// A relay attaches to the next step that renders a cell: tool-only steps mount
// nothing (ui-chat gives them no visible node), so `prev` is the previous step
// with visible content, not the previous step in the list.
const stepShows = (step: ChatStep | undefined): boolean =>
  (step?.blocks ?? []).some(block => {
    if (block === undefined || block.kind === 'tool-call') return false
    return block.kind === 'text' || block.kind === 'reasoning' ? String(block.text ?? '').trim() !== '' : true
  })
const stepHasReasoning = (step: ChatStep | undefined): boolean =>
  (step?.blocks ?? []).some(block => block?.kind === 'reasoning' && String(block.text ?? '').trim() !== '')
// The step's own cells: a reasoning step emits a 'reasoning' part and a step
// with reply content a 'response' part, or both. The line belongs in the first
// of them — before the thinking row, else before the reply.
export const relayPart = (data: ChatStep | undefined, groupPart?: string): boolean =>
  groupPart === undefined || (stepHasReasoning(data) ? groupPart === 'reasoning' : groupPart === 'response')

export function relaysBefore(
  contexts: readonly RelayContext[] | undefined,
  steps: readonly ChatStep[],
  step: ChatStep | undefined,
): RelayContext[] {
  const index = steps.findIndex(entry => entry?.step === step?.step)
  if (index === -1) return []
  let prev = -Infinity
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = steps[cursor]
    if (candidate !== undefined && stepShows(candidate)) {
      prev = candidate.time ?? 0
      break
    }
  }
  // The lower bound is inclusive: a relay steered right after the previous
  // step's assistant/message can share its millisecond, and it still belongs to
  // this step — its own model call follows the previous one. The upper bound
  // stays strict: a step's time is its settled message or first visible token.
  const upper = step?.time ?? Infinity
  return (contexts ?? []).filter(
    data => isRelayContext(data) && typeof data.time === 'number' && data.time >= prev && data.time < upper,
  )
}

// Back-to-back Bot-to-Bot messages fold into one "N messages with" line. A
// hidden exchange turn holds a request and its reply; a visible one (a reply, or a
// request answered to the user) adds only its trigger and ends the run. Group turns
// never show in a one-to-one chat, so they do not break a run.
// `order` lists the Session's turns; `peers` maps each relayed turn to its sender's id.
// Returns null (unknown), 'folded', or { count, peerIds } for the run's first line.
export function commRunOf(
  order: readonly number[],
  peers: Record<number, string | undefined>,
  turn: number,
  hiddenTurns: readonly number[] = [],
): CommRun | 'folded' | null {
  const turns: { turn: number; peer: string | undefined; hidden: boolean }[] = []
  for (const entry of order) {
    const peer = peers[entry]
    const hidden = hiddenTurns.includes(entry)
    if (hidden && peer === undefined) continue
    turns.push({ turn: entry, peer, hidden })
  }
  const at = turns.findIndex(entry => entry.turn === turn)
  if (at === -1) return null
  const current = turns[at]
  if (current?.peer === undefined) return null
  const previous = turns[at - 1]
  if (previous?.peer !== undefined && previous.hidden) return 'folded'
  let count = 0
  const peerIds: string[] = []
  for (let index = at; index < turns.length; index += 1) {
    const entry = turns[index]
    if (entry === undefined) break
    const before = turns[index - 1]
    if (entry.peer === undefined || (index > at && before !== undefined && !before.hidden)) break
    count += entry.hidden ? 2 : 1
    if (!peerIds.includes(entry.peer)) peerIds.push(entry.peer)
  }
  return { count, peerIds }
}

// Latest visible line for a sidebar row; Bot-to-Bot exchange turns stay out of it.
export function previewOf(list: PreviewList, id: string, hiddenTurns: readonly number[] = []): string {
  const outline = list.projectionsBySession?.[id]?.values?.turnOutline ?? list.byId?.[id]?.projectionValues?.turnOutline
  if (!Array.isArray(outline)) return ''
  for (let index = outline.length - 1; index >= 0; index -= 1) {
    const entry = outline[index]
    if (entry === undefined || (entry.turn !== undefined && hiddenTurns.includes(entry.turn))) continue
    const text = entry.response ?? entry.prompt ?? ''
    if (text !== '') return hostText(stripHeader(text).replace(/\s+/g, ' ').trim())
  }
  return ''
}

export const formatTokens = (count: number): string =>
  count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${(count / 1e3).toFixed(1)}K` : String(count)

// Same buckets as the shell's usage pill: every prompt-side billing bucket plus output.
export function usageOf(
  list: { projectionsBySession?: Record<string, { values?: { tokenUsage?: TokenUsage } } | undefined> },
  ids: readonly string[],
): string {
  let input = 0
  let cacheRead = 0
  let output = 0
  for (const id of ids) {
    const usage = list.projectionsBySession?.[id]?.values?.tokenUsage
    if (usage === undefined) continue
    input += (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    cacheRead += usage.cacheReadTokens ?? 0
    output += usage.outputTokens ?? 0
  }
  if (input + output === 0) return ''
  const hit = input > 0 ? Math.round((cacheRead / input) * 100) : 0
  return t('{tokens} tok · Cache hit {hit}%', { tokens: formatTokens(input + output), hit })
}

// A share that is not whole never reads as 100%: it gets decimals until it does not.
function percentText(part: number, whole: number): string {
  if (part >= whole) return '100'
  for (let places = 0; places < 3; places += 1) {
    const text = ((part / whole) * 100).toFixed(places)
    if (Number(text) < 100) return text
  }
  return '99.99'
}

// One Session's figures from the host's sessionStats, tokenUsage and contextPressure views, as
// its status bar counts them: turns, output tokens over decode time, cache reads over
// every prompt-side token, and the context in use. Figures with nothing to count yet are left out.
export function runStatsOf(values: RunStatsValues | undefined): RunStat[] {
  const stats = values?.sessionStats
  const usage = values?.tokenUsage
  const pressure = values?.contextPressure
  const shown: RunStat[] = []
  const turns = stats?.turns ?? 0
  if (turns > 0) shown.push({ key: 'turns', text: turns === 1 ? t('1 turn') : t('{count} turns', { count: turns }) })
  const decodeMs = stats?.decodeMs ?? 0
  const decodeTokens = stats?.decodeTokens ?? 0
  if (decodeMs > 0 && decodeTokens > 0) {
    const speed = decodeTokens / (decodeMs / 1000)
    shown.push({
      key: 'speed',
      text: t('{speed} tok/s', { speed: speed >= 10 ? Math.round(speed) : Math.round(speed * 10) / 10 }),
    })
  }
  const prompt = (usage?.uncachedInputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
  if (prompt > 0)
    shown.push({ key: 'cache', text: t('Cache hit {hit}%', { hit: percentText(usage?.cacheReadTokens ?? 0, prompt) }) })
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const window = pressure?.contextWindow ?? 0
  if (used !== undefined && Number.isFinite(used) && window > 0) {
    shown.push({
      key: 'context',
      text: t('Context {percent}%', { percent: Math.min(100, Math.round((used / window) * 100)) }),
      title: t('{used} of {total} tokens of context in use', { used: formatTokens(used), total: formatTokens(window) }),
    })
  }
  return shown
}

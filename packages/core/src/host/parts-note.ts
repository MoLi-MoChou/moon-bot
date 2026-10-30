// The model-facing half of making room in a long conversation: the handoff note a part
// writes before it moves on, the checkpoint that replaces older messages in place, and
// the context steward's one-line decision. Every request here runs on the conversation's
// own prefix, so the provider serves it from cache and nobody waits.
//
// `parts.ts` owns when any of this runs; this module owns what is asked and what comes
// back. The part reading lives in `parts-note-read.ts` and the note prompt in
// `parts-note-text.ts`; the shapes are in `parts-note-types.d.ts`.
import { BlockAssembler } from './llm-bits.ts'
import type { LlmStreamChunk } from './llm-bits.ts'
import {
  CHECKPOINT_PROMPT,
  STEWARD_SYSTEM,
  checkpointCount,
  checkpointTail,
  checkpointTailNote,
  checkpointText,
  parseDecision,
  stewardRequest,
} from './steward.ts'
import { canonicalHeadings } from './parts-text.ts'
import {
  FOLDER_PROMPT,
  HANDOFF_PROMPT,
  NOTE_NAMES,
  NOTE_RETRY_SHORTER,
  missingSections,
  noteRetryMissing,
} from './parts-note-text.ts'
import { partHandoffLines, partKeptMessages } from './parts-note-read.ts'
import type { HandoffLines, Lines, SwitchAgent, WrittenNote } from './parts-switch-move.ts'
import type {
  CheckpointInput,
  CheckpointResult,
  NoteSession,
  PartNote,
  PartNoteOptions,
  PartReadDeps,
  PartSpan,
} from './parts-note-types.js'

export function createPartNote(options: PartNoteOptions): PartNote {
  const {
    ctx,
    rt,
    clock,
    limits,
    condensing,
    engineOf,
    placeOf,
    partsOf,
    partLines,
    tokensOf,
    contextLines,
    setPartBase,
  } = options
  const {
    recentTokens: RECENT_TOKENS,
    handoffReadMs: HANDOFF_READ_MS,
    noteMaxTokens: NOTE_MAX_TOKENS,
    noteTimeoutMs: NOTE_TIMEOUT_MS,
    noteAttempts: NOTE_ATTEMPTS,
    stewardMaxTokens: STEWARD_MAX_TOKENS,
    stewardTimeoutMs: STEWARD_TIMEOUT_MS,
    stewardLines: STEWARD_LINES,
  } = limits
  const logger = ctx.logger
  // The part reading takes only what it needs from here, so it stays a plain module.
  // Called only when a read stops early, so a host without a logger still installs.
  const readDeps: PartReadDeps = { clock, partLines, warn: (template, ...args) => rt.warn(template, ...args), limits }
  const handoffLines = (sessionId: string, span: PartSpan): Promise<HandoffLines> =>
    partHandoffLines(readDeps, sessionId, span)
  const keptMessages = (
    sessionId: string,
    span: PartSpan,
  ): Promise<{ readonly kept: string[]; readonly more: boolean }> => partKeptMessages(readDeps, sessionId, span)

  // The same system prompt, tools, and messages as the conversation's own requests,
  // plus the note prompt; nothing is written into the Session. A cut-off note, or one
  // without every section, is asked for again once; then the note fails.
  async function writeNote(
    agent: SwitchAgent,
    signal: AbortSignal,
    { folder = false }: { readonly folder?: boolean | undefined } = {},
  ): Promise<WrittenNote> {
    const session = agent.session as NoteSession
    const header = session.requestHeader()
    const route = header?.config
    if (!route?.provider || !route?.model) throw new Error('the Session has not called a model yet')
    const budget = (route as { readonly maxTokens?: number | undefined }).maxTokens
    const messages = session.deriveMessages()
    const base = folder ? FOLDER_PROMPT : HANDOFF_PROMPT
    let retry: string | undefined
    let problem = ''
    for (let attempt = 1; attempt <= NOTE_ATTEMPTS; attempt += 1) {
      const prompt = retry === undefined ? base : `${base}\n\n${retry}`
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
        messages: [...messages, { role: 'user', content: [{ type: 'text', text: prompt }] }],
        toolHistory: session.toolHistory(),
        ...(header?.tools ? { tools: [...header.tools] } : {}),
        maxTokens: Math.min(NOTE_MAX_TOKENS, budget ?? NOTE_MAX_TOKENS),
        sessionId: session.id,
        purpose: 'compaction',
        signal,
      }))
        assembler.push(chunk as LlmStreamChunk)
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure?.message ?? finish.kind)
      const text = assembler
        .blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n')
        .trim()
      const note = missingSections(text).length > 0 ? canonicalHeadings(text, NOTE_NAMES) : text
      const missing = missingSections(note)
      if (finish.kind === 'max-tokens') {
        problem = 'it was cut off at the output limit'
        retry = NOTE_RETRY_SHORTER
      } else if (note === '') {
        problem = 'it was empty'
        retry = undefined
      } else if (missing.length > 0) {
        problem = `it lacked ${missing.join(', ')}`
        retry = noteRetryMissing(missing)
      } else {
        return { note, attempts: attempt }
      }
      rt.warn(
        'moon-bot: handoff note attempt %d of %d for %s not used: %s',
        attempt,
        NOTE_ATTEMPTS,
        session.id,
        problem,
      )
    }
    throw new Error(`no usable note in ${NOTE_ATTEMPTS} attempts; the last one: ${problem}`)
  }

  // DS Bot's summary for a Bot Session, in place of the backend's. Like the backend's
  // own, it is one request on the conversation's own prefix, so the provider serves
  // that from cache.
  async function writeCheckpoint(
    input: CheckpointInput,
    agent: SwitchAgent,
    signal: AbortSignal,
  ): Promise<CheckpointResult> {
    const session = agent.session as NoteSession
    const route = session.requestHeader()?.config
    if (!route?.provider || !route?.model) throw new Error('the Session has not called a model yet')
    // The results list grows with the work, so the checkpoint may write as much as one
    // of the Bot's own replies.
    const maxTokens = (route as { readonly maxTokens?: number | undefined }).maxTokens
    const head = input.messages
    const tail = checkpointTail(head, session.deriveMessages())
    const prompt = tail.length === 0 ? CHECKPOINT_PROMPT : `${CHECKPOINT_PROMPT}\n\n${checkpointTailNote(tail)}`
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      messages: [...head, ...tail, { role: 'user', content: [{ type: 'text', text: prompt }] }],
      toolHistory: session.toolHistory(),
      ...(input.tools ? { tools: [...input.tools] } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      sessionId: session.id,
      purpose: 'compaction',
      signal,
    }))
      assembler.push(chunk as LlmStreamChunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure?.message ?? finish.kind)
    if (finish.kind === 'max-tokens') throw new Error('the checkpoint was cut off at the output limit')
    const rawOutput = assembler.blocks()
    const summary = rawOutput
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('\n')
      .trim()
    if (summary === '') throw new Error('the checkpoint was empty')
    const place = placeOf(session.id)
    const lines = await contextLines(session).catch(() => undefined)
    const { kept, more } = await keptMessages(session.id, {
      budget: Math.min(RECENT_TOKENS, Math.floor((lines?.check ?? 4 * RECENT_TOKENS) / 4)),
      group: place?.roomId !== undefined,
      number: place === undefined ? 1 : partsOf(place.botId, place.roomId).length,
    })
    const text = checkpointText({ number: checkpointCount(input.messages) + 1, summary, kept, more })
    return {
      summary: [{ type: 'text', text }],
      rawOutput,
      llmStreamCall: true,
      provider: route.provider,
      model: route.model,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }

  // The steward's call: the latest messages of this part, and nothing of the Bot's
  // own prefix, so it stays small. Undefined when its answer names no action.
  async function askSteward(
    agent: SwitchAgent,
    { midTurn }: { readonly midTurn: boolean },
  ): Promise<'switch' | 'compact' | undefined> {
    const session = agent.session as NoteSession
    const route = session.requestHeader()?.config
    if (!route?.provider || !route?.model) return undefined
    const group = placeOf(agent.id)?.roomId !== undefined
    const lines: { readonly who: string; readonly text: string }[] = []
    for await (const line of partLines(agent.id, AbortSignal.timeout(HANDOFF_READ_MS), { group })) {
      lines.push({
        who: line.who,
        text: line.who === 'you' || line.who === 'user' ? line.text.replace(/^(?:You|User): /, '') : line.text,
      })
      if (lines.length >= STEWARD_LINES) break
    }
    const info = await ctx.llm.resolveModelInfo(route.provider, route.model).catch(() => undefined)
    // The decision needs no long thinking.
    const off = info?.reasoning?.efforts?.some(effort => effort.id === 'off')
    const messages: unknown[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: stewardRequest({ lines, midTurn, checkpoints: checkpointCount(session.deriveMessages()), group }),
          },
        ],
      },
    ]
    rt.tagUsage(messages, { sessionId: agent.id, kind: 'compaction' })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      ...(off ? { reasoningEffort: 'off' } : {}),
      system: STEWARD_SYSTEM,
      messages,
      maxTokens: STEWARD_MAX_TOKENS,
      sessionId: session.id,
      purpose: 'compaction',
      signal: AbortSignal.timeout(STEWARD_TIMEOUT_MS),
    }))
      assembler.push(chunk as LlmStreamChunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure?.message ?? finish.kind)
    return parseDecision(
      assembler
        .blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n'),
    )
  }

  // What the steward decides; a part that cannot be condensed, or a steward that
  // gives no answer, moves on as it always could.
  async function decide(agent: SwitchAgent, { midTurn }: { readonly midTurn: boolean }): Promise<'compact' | 'switch'> {
    if (engineOf(agent) === undefined) return 'switch'
    try {
      const action = await askSteward(agent, { midTurn })
      if (action !== undefined) return action
      rt.warn('moon-bot: the context steward gave no usable answer for %s; moving on to a fresh part', agent.id)
    } catch (error) {
      rt.warn('moon-bot: the context steward failed for %s; moving on to a fresh part: %s', agent.id, error)
    }
    return 'switch'
  }

  // Condenses the part through its own backend. `inTurn`: before a step of a running
  // turn, through the backend's overflow path, which condenses all but the latest
  // node; otherwise as an idle maintenance pass. True when the part ended up below
  // the check line, false when it did not (it then moves on), undefined when a turn
  // got in first (the part is checked again when that turn ends).
  async function condense(
    agent: SwitchAgent,
    lines: Lines,
    { inTurn, signal }: { readonly inTurn: boolean; readonly signal?: AbortSignal | undefined },
  ): Promise<boolean | undefined> {
    const engine = engineOf(agent)
    const before = tokensOf(agent.session)
    const sessionId = agent.session.id
    condensing.add(sessionId)
    try {
      // Through the service itself, past DS Bot's own wrapper: only a call on the
      // service gives the engine its own context, with the services it injects.
      // A Session with no engine is a host bug, noted like a failed pass below.
      if (engine === undefined) throw new Error('no compaction engine serves this Session')
      // The old path passed no signal when a turn overflowed, so a stuck compaction had
      // no limit at all; here it gets the note timeout, so a hung pass cannot hold the step.
      const result = inTurn
        ? await engine.compactIfNeeded(agent, 'context-overflow', signal ?? AbortSignal.timeout(NOTE_TIMEOUT_MS))
        : await engine.compactNow(agent, AbortSignal.timeout(NOTE_TIMEOUT_MS))
      if (result === null) return false
    } catch (error) {
      if (!inTurn && (error as { readonly code?: string } | undefined)?.code === 'busy') return undefined
      if (!inTurn && (error as { readonly code?: string } | undefined)?.code === 'cancelled') return undefined
      rt.warn('moon-bot: condensing %s failed: %s', agent.id, error)
      return false
    } finally {
      condensing.delete(sessionId)
    }
    // The prefix cache starts over anyway, so the memory section catches up.
    rt.renewMemory(sessionId)
    const after = tokensOf(agent.session) ?? before
    setPartBase(agent.id, after)
    logger.info(
      'moon-bot: %s condensed from %d to %d tokens (check line %d, hard line %d)',
      agent.id,
      before ?? -1,
      after ?? -1,
      lines.check,
      lines.hard,
    )
    // A Session that reports no size after the pass has not provably made room.
    if (after === undefined) return false
    return after < lines.check
  }

  return { handoffLines, writeNote, keptMessages, writeCheckpoint, askSteward, decide, condense }
}

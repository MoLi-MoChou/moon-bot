// Parts: making room in a long conversation (a checkpoint in place, or a switch to a
// fresh Session), the handoff note and package, and earlier pages for the chat view.
//
// A Bot's conversations are long-lived, and the compaction backend's own pressure
// line does not apply to them. Once a turn ends with the context past the check line
// (a share of what the model can take), the context steward (steward.js) reads the
// latest messages and decides. Work still under way: the older messages are condensed
// in place into a checkpoint that keeps the messages to the Bot word for word, and
// the part goes on. Work at a stopping point: the part moves on to a fresh Session,
// and the old one is archived whole. For that the Bot writes a handoff note while
// idle, from the same prefix as its own requests, so the provider serves it from
// cache and nobody waits. A turn that grows past the hard line, near the window, gets
// the same decision before its next step; a context overflow moves on without a note.
// The next part opens with the handoff package: the note, the latest messages word for
// word, and where the rest is. Input that arrives meanwhile waits and moves along.
// read_own_chat searches every part, the condensed messages included.
import { randomUUID } from 'node:crypto'
import { HANDOFF_ACK, SOURCE_KIND } from './constants.ts'
import { linesFor } from './steward.ts'
import { createClock, estimateTokens, textOf } from './text.ts'

// An ask_user card as the user saw it. The user's reply is often just an option label,
// which means nothing without the card. Arguments the tool would refuse (no question,
// options that are not { label } objects) showed no card, so they give no text.
import { canonicalHeadings, cardText, historyEntry, questionReply, readReply, replyText, viewCardText, viewReply } from './parts-text.ts'
import { handoffPackage, noteText } from './parts-handoff.ts'

export { handoffPackage, noteText }
import { createPartSwitch } from './parts-switch.ts'
import { createPartNote } from './parts-note.ts'
import { createPartPager } from './parts-pager.ts'
import type { Agent, DshContext } from './dsh-types.js'
import type { HostRuntime } from './runtime.js'
import type { LlmMessageSource } from './dsh-types.js'
import type { Lines, SwitchAgent, SwitchJob, SwitchPart, SwitchSession } from './parts-switch-move.ts'
import type { PartSwitchRuntime } from './parts-switch.ts'
import type { SwitchState } from './parts-switch-move.ts'
import type { PartEngine, PartLine } from './parts-note-types.js'
import type { CompactionEngine, PartEntry, RelayNext, RelayRequest } from './parts-types.js'

export { createPartSwitch }

export { canonicalHeadings, cardText, historyEntry, questionReply, readReply, replyText, viewCardText, viewReply }

/** A compaction hook, called with the engine as `this`. */
type EngineMethod = (this: unknown, ...args: readonly unknown[]) => Promise<unknown>

export function install(rt: HostRuntime): void {
  const { ctx, config, state } = rt
  const context: DshContext = ctx

  const RECENT_TOKENS = config.handoffRecentTokens ?? 16_384
  const RECENT_LINE_MAX = 4_000
  const LIST_TOKENS = config.handoffListTokens ?? 4_096
  const LIST_LINE_MAX = 400
  const HANDOFF_READ_MS = 60_000
  const NOTE_MAX_TOKENS = 8_192
  const NOTE_TIMEOUT_MS = 600_000
  const NOTE_ATTEMPTS = 2
  // After a note fails below the hard line the part stays as it is, and tries again
  // only after a wait that grows with each failure in a row.
  const NOTE_COOLDOWN_MS = [60_000, 300_000, 900_000]
  const ORIGINAL_COMPACT = Symbol.for('ds-bot/compaction')
  const STEWARD_MAX_TOKENS = 4_096
  const STEWARD_TIMEOUT_MS = 120_000
  const STEWARD_LINES = 40

  // A broken provider adapter must not crash every turn; estimate from the
  // derived messages instead, with one warning.
  let measureWarned = false
  interface TokenMeter { measure(session: SwitchSession): { readonly totalTokens?: number } }
  const tokensOf = (session: SwitchSession): number | undefined => {
    try {
      return (context.get('tokenMeter') as TokenMeter | undefined)?.measure(session).totalTokens
    } catch (error) {
      if (!measureWarned) {
        measureWarned = true
        rt.warn('ds-bot: token measure failed; context sizes are estimated: %s', error)
      }
    }
    try {
      return estimateTokens(session.deriveMessages().map(message => textOf((message as { readonly content?: unknown }).content)).join('\n'))
    } catch {
      return undefined
    }
  }
  const clock = createClock(config.timeZone)

  // Lines for the model the Session last routed to; undefined while it has not
  // routed yet.
  async function contextLines(session: SwitchSession): Promise<Lines | undefined> {
    const route = session.requestHeader()?.config
    if (!route?.provider || !route?.model) return undefined
    const info = await context.llm.resolveModelInfo(route.provider, route.model)
    const maxTokens = (route as { readonly maxTokens?: number | undefined }).maxTokens
    return linesFor({ window: info.context?.contextWindow, reserve: maxTokens ?? info.defaultMaxTokens, checkRatio: config.checkRatio })
  }

  // The backend's own entry points leave Bot Sessions alone, earlier parts and group
  // records included: automatic pressure and overflow compaction do nothing, and
  // /compact and explicit ranges are refused. Only DS Bot condenses a Bot Session,
  // when the steward says so, and then the summary is DS Bot's checkpoint. Each preset
  // mount has its own compaction backend. Every other Session, subagents included, is
  // as it was.
  const adoptedEngines = new Set<CompactionEngine>()
  // Sessions DS Bot itself is condensing right now.
  const condensing = new Set<string>()
  const refuseCompaction = (): Promise<never> => Promise.reject(new Error(
    'A Bot conversation makes room on its own, and read_own_chat searches all of it.'))
  const isBotTarget = (target: unknown): boolean => {
    const id = (target as { readonly session?: { readonly id?: string | undefined } | undefined } | undefined)?.session?.id
    return id !== undefined && (rt.selfOf(id) !== undefined || rt.roomOf(id) !== undefined)
  }
  const ownedByBot = (target: unknown): boolean =>
    isBotTarget(target) && !condensing.has((target as { readonly session: { readonly id: string } }).session.id)
  // The engine that serves this agent, when DS Bot can condense through it.
  const engineOf = (agent: SwitchAgent): PartEngine | undefined => {
    const presets = context.get('agentPresets') as { serviceFor?(agent: SwitchAgent, name: string): unknown } | undefined
    const engines: readonly unknown[] = [presets?.serviceFor?.(agent, 'compaction'), context.get('compaction')]
    return engines.find(engine => typeof ((engine as CompactionEngine | undefined)?.[ORIGINAL_COMPACT] as { readonly summarize?: unknown } | undefined)?.summarize === 'function') as unknown as PartEngine | undefined
  }

  // The wrapper decides per call, so it can go on before the Session is a Bot's.
  function adoptCompaction(agent: SwitchAgent): void {
    const presets = context.get('agentPresets') as { serviceFor?(agent: SwitchAgent, name: string): unknown } | undefined
    adoptEngine(presets?.serviceFor?.(agent, 'compaction') as CompactionEngine | undefined)
    adoptEngine(context.get('compaction') as CompactionEngine | undefined)
  }
  function adoptEngine(engine: CompactionEngine | undefined): void {
    // The mark lives on the engine itself, so two lookups of one engine adopt it once.
    if (engine === undefined || engine[ORIGINAL_COMPACT] !== undefined || typeof engine.compactIfNeeded !== 'function') return
    const original = engine[ORIGINAL_COMPACT] = {
      compactIfNeeded: engine.compactIfNeeded,
      compactNow: engine.compactNow,
      compactRegion: engine.compactRegion,
      // compaction-basic's one customization hook; it runs for every summary.
      ...(typeof engine.summarize === 'function' ? { summarize: engine.summarize } : {}),
    }
    engine.compactIfNeeded = function compactOutsideBots(this: unknown, target: unknown, trigger: string, signal?: AbortSignal): Promise<unknown> {
      if (ownedByBot(target)) return Promise.resolve(null)
      return (original.compactIfNeeded as EngineMethod).call(this, target, trigger, signal)
    }
    engine.compactNow = function compactNowOutsideBots(this: unknown, target: unknown, signal?: AbortSignal, commandId?: string): Promise<unknown> {
      if (ownedByBot(target)) return refuseCompaction()
      return (original.compactNow as EngineMethod).call(this, target, signal, commandId)
    }
    engine.compactRegion = function compactRegionOutsideBots(this: unknown, start: number, end: number, target: unknown, signal?: AbortSignal): Promise<unknown> {
      if (ownedByBot(target)) return refuseCompaction()
      return (original.compactRegion as EngineMethod).call(this, start, end, target, signal)
    }
    if (original.summarize !== undefined) {
      engine.summarize = function summarizeForBots(this: unknown, input: unknown, agent: unknown, signal: AbortSignal): Promise<unknown> {
        if (isBotTarget(agent)) return writeCheckpoint(input as Parameters<typeof writeCheckpoint>[0], agent as SwitchAgent, signal)
        return (original.summarize as EngineMethod).call(this, input, agent, signal)
      }
    }
    adoptedEngines.add(engine)
  }
  ctx.effect(() => () => {
    for (const engine of adoptedEngines) {
      for (const [key, method] of Object.entries((engine[ORIGINAL_COMPACT] ?? {}) as Record<string, unknown>)) {
        delete engine[key]
        if (engine[key] !== method) engine[key] = method
      }
      delete engine[ORIGINAL_COMPACT]
    }
    adoptedEngines.clear()
  }, 'ds-bot: Bot compaction')
  ctx.on<{ readonly agent: Agent }>('agent/created', ({ agent }) => { adoptCompaction(agent as unknown as SwitchAgent) })

  // A Bot's own chat, or its Session in one group, as numbered parts, oldest first;
  // the last one is current.
  function partsOf(botId: string, roomId?: string): readonly SwitchPart[] {
    const bot = rt.botOf(botId)
    if (bot === undefined) return []
    const room = rt.roomOf(roomId)
    const earlier = ((room ? room.segments?.[botId] : bot.segments) ?? []) as readonly { readonly sessionId: string; readonly endedAt?: number | undefined }[]
    const current = room ? room.sessions?.[botId] : rt.chatOf(botId)
    const parts: PartEntry[] = earlier.map((segment, index) => ({ ...segment, number: index + 1, startedAt: (earlier[index - 1]?.endedAt ?? bot.createdAt) as number }))
    if (current !== undefined) parts.push({ sessionId: current, number: parts.length + 1, startedAt: (earlier.at(-1)?.endedAt ?? bot.createdAt) as number })
    return parts
  }

  // What was said in one part, newest first: the user, other Bots, and the Bot itself.
  async function* partLines(sessionId: string, signal: AbortSignal, { group = false, pages }: { readonly group?: boolean | undefined; readonly pages?: number | undefined } = {}): AsyncGenerator<PartLine> {
    // Read backwards, a Bot's answers come before the message they answer.
    let answers: PartLine[] = []
    for await (const event of rt.eventsBackwards(sessionId, signal, pages)) {
      const entry = historyEntry(event, group)
      if (entry === undefined) continue
      if (entry.answer) {
        answers.push({ text: `You: ${entry.text}`, time: event.time as number, seq: event.seq as number, who: 'you' })
        continue
      }
      const kept = entry.keepAnswers ? answers : []
      answers = []
      yield* kept
      if (entry.text !== '') yield { text: entry.who === 'user' ? `User: ${entry.text}` : entry.text, time: event.time as number, seq: event.seq as number, who: entry.who as string }
    }
  }

  // The note, the checkpoint, and the steward's one-line call: each is one request on
  // the conversation's own prefix. They live in `parts-note.ts`, which reads and
  // measures through the closures injected here; the factory is built before the
  // compaction engines are adopted, because adopting one may call `writeCheckpoint`.
  const { handoffLines, writeNote, writeCheckpoint, decide, condense } = createPartNote({
    ctx,
    rt,
    clock,
    condensing,
    engineOf,
    tokensOf,
    contextLines,
    // Bound late: the switch factory is built further down, and these are only called
    // from a turn.
    placeOf: sessionId => placeOf(sessionId),
    partsOf,
    partLines,
    setPartBase: (sessionId, tokens) => partSwitch.setPartBase(sessionId, tokens),
    limits: {
      recentTokens: RECENT_TOKENS, recentLineMax: RECENT_LINE_MAX,
      listTokens: LIST_TOKENS, listLineMax: LIST_LINE_MAX,
      handoffReadMs: HANDOFF_READ_MS, noteMaxTokens: NOTE_MAX_TOKENS,
      noteTimeoutMs: NOTE_TIMEOUT_MS, noteAttempts: NOTE_ATTEMPTS,
      stewardMaxTokens: STEWARD_MAX_TOKENS, stewardTimeoutMs: STEWARD_TIMEOUT_MS,
      stewardLines: STEWARD_LINES,
    },
  })

  // The note a part opened with, as the fresh part shows it. A note DS Bot put
  // together without the model carries the last note the model wrote.
  // A turn stopped for a switch goes on with its own source, so its reply still
  // reaches whoever asked.
  const handoffSource = (job: SwitchJob, resume: boolean): LlmMessageSource => ({
    ...(resume && job.info ? job.info : { kind: SOURCE_KIND, form: 'relay', role: 'handoff', senderName: 'DS Bot' }),
    exchangeId: job.info?.exchangeId ?? randomUUID(),
    handoff: true,
    ...(resume ? { resume: true } : {}),
    ...(resume && job.joined?.length ? { joined: job.joined } : {}),
  })

  const placeOf = (sessionId: string): { readonly botId: string; readonly roomId?: string | undefined } | undefined => {
    const botId = rt.chatOwners.get(sessionId)
    if (botId !== undefined) return { botId }
    const owner = rt.groupOwners.get(sessionId)
    return owner && { botId: owner.botId, roomId: owner.roomId }
  }

  const partSwitch = createPartSwitch({
    ctx,
    // The host runtime carries the services the other modules provide (store, folders,
    // turns, schedules); the switch names the slice it calls.
    rt: rt as unknown as PartSwitchRuntime,
    state: state as unknown as SwitchState,
    placeOf,
    tokensOf,
    contextLines,
    condense,
    decide,
    adoptCompaction,
    // A read-only process (another instance holds the team) neither condenses nor switches.
    readOnly: () => rt.readOnly() !== undefined,
    writeNote,
    handoffLines,
    handoffPackage,
    handoffSource,
    partsOf,
    recentTokens: RECENT_TOKENS,
    noteTimeoutMs: NOTE_TIMEOUT_MS,
    noteCooldownMs: NOTE_COOLDOWN_MS,
  })

  // The handoff package opens a part as a turn of its own, so it is the first message
  // in the part's history. When nothing is left to do, that turn's reply is a fixed
  // line instead of a model call.
  ctx.on<RelayRequest, RelayNext>('llm/stream', (options, next) => {
    if (options.sessionId === undefined || options.purpose !== undefined || rt.ownRequest(options)) return next()
    const messages = options.messages ?? []
    // Past the last assistant or tool message: what opened this part.
    let since = 0
    for (let at = messages.length - 1; at >= 0; at -= 1) {
      const role = messages[at]?.role
      if (role === 'assistant' || role === 'tool') { since = at + 1; break }
    }
    const opened = messages.slice(since).filter(message => message.role === 'user' && (message.source?.kind === 'user' || message.source?.kind === SOURCE_KIND))
    const bare = opened.length > 0 && opened.every(message => message.source?.kind === SOURCE_KIND && message.source.handoff === true && message.source.resume !== true)
    if (!bare) return next()
    return (async function* acknowledge() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: HANDOFF_ACK }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: HANDOFF_ACK } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  })

  // The chat pages earlier parts through its own module; the switch and the rest stay here.
  const { displayItems, earlierPage, chatPage } = createPartPager({ rt, partsOf })

  Object.assign(rt, { clock, partsOf, historyEntry, partLines, noteText, earlierPage, chatPage, displayItems, followFolder: partSwitch.followFolder, heldBack: partSwitch.heldBack, switchJobs: () => partSwitch.switchJobs() })
}

// The part switch: when a part ends, the Bot moves on to a fresh Session, and the input
// that waits moves with it. The state tables live here, as does the rescue path for a
// part whose requests keep failing. `parts-switch-move.ts` performs one move.
import { randomUUID } from 'node:crypto'
import { createUserMessage } from './llm-bits.ts'
import { SOURCE_KIND } from './constants.ts'
import { RESUME_DELAY_MS } from './resume.ts'
import { textOf } from './text.ts'
import { FOLDER_RETRY_MS, createPartMove } from './parts-switch-move.ts'
import type { Disposer } from './dsh-types.js'
import type {
  Lines, PartMove, PartMoveOptions, PartMoveRuntime, SwitchAgent, SwitchEvent, SwitchJob, SwitchLiveEntry,
  SwitchMessage, SwitchOwner, SwitchSession, SwitchState, SwitchTables,
} from './parts-switch-move.ts'
import type { TurnInfo } from './runtime.js'

const OVERFLOW = 'CONTEXT_WINDOW_EXCEEDED'
// A failed connection says nothing about the conversation, so it never moves a part on.
const STUCK_CODES = ['INVALID_REQUEST', 'IMAGE_OFFLOAD_REQUIRED']
const SWITCH_ATTEMPTS = 5
const PAUSE_NOTE = 'DS Bot paused your turn for a context check. Go on with it now from where you stopped.'

/** The runtime surface the switch lifecycle calls. */
export interface PartSwitchRuntime extends PartMoveRuntime {
  readonly pastOwners: Map<string, SwitchOwner>; liveOf(sessionId: string): SwitchLiveEntry
  renewMemory(sessionId: string): void; keepTeamFolder(): Promise<string | undefined>
}

interface WorkingDirectoryService { get(session: SwitchSession): string | undefined; set(agent: SwitchAgent, target: string, signal?: AbortSignal): Promise<void> }

interface PreStepPayload { readonly agent: SwitchAgent; readonly step: number; readonly messages: readonly SwitchMessage[]; readonly signal?: AbortSignal | undefined }

interface RequestErrorPayload { readonly agent: SwitchAgent; readonly failure?: { readonly code?: string | undefined } | undefined; readonly signal?: AbortSignal | undefined }

interface AssembleContext { readonly agent?: SwitchAgent | undefined; readonly signal?: AbortSignal | undefined }

type Next = () => unknown

export interface StartSwitchOptions {
  readonly resume?: boolean; readonly carry?: readonly SwitchMessage[]; readonly info?: TurnInfo | undefined
  readonly joined?: readonly unknown[] | undefined; readonly overflow?: boolean; readonly failed?: string | undefined
  readonly bare?: boolean; readonly folder?: boolean; readonly hard?: boolean
}

export interface PartSwitchOptions extends Omit<PartMoveOptions, 'rt' | 'tables'> {
  readonly rt: PartSwitchRuntime; readonly state: SwitchState
  readOnly(): boolean
  condense(agent: SwitchAgent, lines: Lines, options: { readonly inTurn: boolean; readonly signal?: AbortSignal | undefined }): Promise<boolean | undefined>
  decide(agent: SwitchAgent, options: { readonly midTurn: boolean }): Promise<'compact' | 'switch'>
  adoptCompaction(agent: SwitchAgent): void
}

export interface PartSwitch {
  heldBack(): Promise<void>; followFolder(botId: string): Promise<void>; switchJobs(): Iterable<SwitchJob>
  setPartBase(sessionId: string, tokens: number | undefined): void
}

export function createPartSwitch(options: PartSwitchOptions): PartSwitch {
  const { ctx, rt, state, placeOf, tokensOf, contextLines, condense, decide, adoptCompaction, readOnly, recentTokens, noteTimeoutMs, noteCooldownMs } = options
  const { writeNote, handoffLines, handoffPackage, handoffSource, partsOf } = options

  const switches: Map<string, SwitchJob> = new Map()
  // Parts whose move to their working folder failed, and the time before which it is
  // not tried again.
  const folderRetry = new Map<string, number>()
  // Parts opened because requests kept failing, until one of their turns ends well:
  // 'carried' brought the latest messages along, 'bare' left them out.
  const rescued = new Map<string, 'carried' | 'bare'>()
  // Parts that have not started a turn yet, with their handoff package's size.
  const freshParts = new Map<string, number>()
  // Context size where a part started, or where a checkpoint or a failed switch left
  // it. A part makes room again only once it grew by a quarter of the check line past
  // it, so a large system prompt or a broken switch cannot make it act every turn.
  const partBase = new Map<string, number | undefined>()
  // Parts whose note failed below the hard line: failures in a row, and the time
  // before which the check line does not try again.
  const noteFailures = new Map<string, { readonly count: number; readonly until: number }>()
  // Parts the steward is deciding about at the end of a turn.
  const checking = new Set<string>()
  const tables: SwitchTables = { switches, folderRetry, rescued, freshParts, partBase, noteFailures, checking }
  const move: PartMove = createPartMove({ ctx, rt, state, tables, placeOf, tokensOf, contextLines, writeNote, handoffLines, handoffPackage, handoffSource, partsOf, recentTokens, noteTimeoutMs, noteCooldownMs })

  const grown = (sessionId: string, tokens: number, lines: Lines): boolean => tokens >= (partBase.get(sessionId) ?? 0) + lines.check / 4

  // The plugin's own fiber is disposed (a reload, or DSH closing): every service
  // lookup fails with the same inactive-context error, and logging through rt.warn
  // would fail the same way, so an unloaded failure is noted once at info instead.
  const fiberUid = (): unknown => (ctx.fiber as { readonly uid?: unknown } | undefined)?.uid
  const unloaded = (error: unknown): boolean => fiberUid() === null || /in inactive context/.test(String((error as { readonly message?: unknown } | undefined)?.message ?? error))
  const noteInfo = (template: string, ...args: readonly unknown[]): void => { try { ctx.logger.info(template, ...args) } catch {} }

  // `hard`: past the hard line or the window, the part moves on even without a note
  // from the model. `folder`: the part moves on because its working folder changed.
  function startSwitch(agent: SwitchAgent, { resume = false, carry = [], info, joined, overflow = false, failed, bare = false, folder = false, hard = overflow || folder }: StartSwitchOptions = {}): void {
    const place = placeOf(agent.id)
    if (place === undefined || switches.has(agent.id) || readOnly()) return
    const job: SwitchJob = { ...place, carry: [...carry], info, joined, resume, overflow, failed, bare, folder, hard, since: Date.now() }
    switches.set(agent.id, job)
    void runSwitch(agent, job)
      .catch(error => {
        if (unloaded(error)) return noteInfo('ds-bot: plugin unloaded while %s switched parts; input kept in part %s', rt.botOf(job.botId)?.name ?? agent.id, agent.id)
        rt.warn('ds-bot: %s did not move on to a fresh part: %s', rt.botOf(job.botId)?.name ?? agent.id, error)
      })
      .finally(async () => {
        switches.delete(agent.id)
        if (job.moved) {
          // A move that had to put input back keeps the part marked for the restart pass.
          if (job.kept !== true) {
            delete state.switching[agent.id]
            await rt.save()
          }
          noteFailures.delete(agent.id)
          folderRetry.delete(agent.id)
          // The folder may have changed again while the switch ran.
          if (job.roomId === undefined) void followFolder(job.botId)
          return
        }
        if (folder) folderRetry.set(agent.id, Date.now() + FOLDER_RETRY_MS)
        if (!job.noteFailed) partBase.set(agent.id, tokensOf(agent.session) ?? 0)
        // The stopped turn goes on where it was. A retry finds the note among the
        // input this part kept, so it is added once.
        const back = job.carry.splice(0)
        const noted = [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => textOf(message.content) === PAUSE_NOTE)
        if (resume && !back.some(message => textOf(message.content) === PAUSE_NOTE) && !noted) {
          const carried = job.joined?.length ? { joined: job.joined } : {}
          // The local DSH shim types a new user message without the id the runtime gives it.
          back.unshift(createUserMessage({
            content: [{ type: 'text', text: PAUSE_NOTE }],
            source: job.info ? { ...job.info, ...carried } : { kind: SOURCE_KIND, form: 'relay', role: 'resume', exchangeId: randomUUID(), senderName: 'DS Bot', ...carried },
          }) as unknown as SwitchMessage)
        }
        await move.forward(job, back).then(() => {
          delete state.switching[agent.id]
        }).catch((error) => {
          job.kept = true
          try { move.restore(agent, back) } catch {}
          if (unloaded(error)) return noteInfo('ds-bot: plugin unloaded during the switch of %s; input kept in part %s', agent.id, agent.id)
          rt.warn('ds-bot: input for %s was not handed on: %s', agent.id, error)
          // The input is back where it was; the turn that owns it goes on at once.
          try { move.wake(agent) } catch {}
        })
        await rt.save()
      })
      // A state write that fails here (full disk, a file another program holds, a lost lock)
      // must not end up as an unhandled rejection, which stops the whole host.
      .catch(error => rt.warn('ds-bot: the switch of %s did not finish: %s', agent.id, error))
  }

  async function runSwitch(agent: SwitchAgent, job: SwitchJob): Promise<void> {
    // Marks the part while the switch runs; it stays marked whenever input was put
    // back, so a restart knows where to look without resolving every earlier part.
    state.switching[agent.id] = job.roomId === undefined ? { botId: job.botId } : { botId: job.botId, roomId: job.roomId }
    await rt.save()
    for (let attempt = 1; ; attempt += 1) {
      await agent.whenIdle()
      try {
        // Input that arrives meanwhile waits in the old part's inbox.
        await agent.runMaintenance(signal => move.moveOn(agent, job, signal))
        break
      } catch (error) {
        // A turn that started first is turned away by the pre-step check below.
        if (!job.started && attempt < SWITCH_ATTEMPTS) continue
        throw error
      }
    }
    if (job.moved) {
      rt.renewMemory(agent.id)
      await ctx.workspaceRegistry.archiveSession(agent.id)
        .catch(error => rt.warn('ds-bot: earlier part %s not archived: %s', agent.id, error))
    }
  }

  // `messages` left the inbox for this step, so the switch carries them along.
  function switchBeforeStep(agent: SwitchAgent, payload: PreStepPayload, options: Pick<StartSwitchOptions, 'hard' | 'folder'>): { readonly kind: 'reject' } {
    // A switch may have started while the checks above awaited.
    const running = switches.get(agent.id)
    if (running !== undefined) {
      running.carry.push(...payload.messages)
      return { kind: 'reject' }
    }
    const midTurn = payload.step > 1
    const entry = rt.liveOf(agent.id)
    entry.switched = true
    startSwitch(agent, { resume: midTurn, carry: payload.messages, info: midTurn ? entry.info : undefined, joined: midTurn ? [...(entry.joined ?? [])] : undefined, ...options })
    return { kind: 'reject' }
  }

  // Runs first: an earlier part hands its input on, a part past the hard line makes
  // room before the step (condensed in place, or it stops and goes on in a fresh
  // part), and the backend's own pre-step listener sees the wrapper.
  ctx.on<PreStepPayload, Next>('agent/pre-step', async (payload, next) => {
    await rt.load()
    const { agent } = payload
    const past = rt.pastOwners.get(agent.id)
    if (past !== undefined && !rt.isBotSession(agent.id)) {
      await move.forward(past, payload.messages).catch(error => rt.warn('ds-bot: input for %s was not handed on: %s', agent.id, error))
      return { kind: 'reject' }
    }
    if (!rt.isBotSession(agent.id)) return next()
    adoptCompaction(agent)
    const job = switches.get(agent.id)
    if (job !== undefined) {
      job.carry.push(...payload.messages)
      return { kind: 'reject' }
    }
    const fresh = freshParts.get(agent.id)
    if (fresh !== undefined) {
      freshParts.delete(agent.id)
      partBase.set(agent.id, (tokensOf(agent.session) ?? 0) + fresh)
    }
    if (!readOnly() && await move.folderMove(agent, { midTurn: payload.step > 1 }) !== undefined) return switchBeforeStep(agent, payload, { folder: true })
    const lines = await contextLines(agent.session).catch(() => undefined)
    const tokens = tokensOf(agent.session)
    if (lines === undefined || tokens === undefined || tokens < lines.hard || !grown(agent.id, tokens, lines) || readOnly()) return next()
    if (await decide(agent, { midTurn: payload.step > 1 }) === 'compact' && await condense(agent, lines, { inTurn: true, signal: payload.signal })) return next()
    return switchBeforeStep(agent, payload, { hard: true })
  }, { prepend: true })

  // DSH 0.2.1 checks a Session's folder as it puts each model request together, before
  // agent/pre-step, and fails the turn when both the folder and the one the Session was
  // made in are gone. The team folder is DS Bot's own, so it is made again; a Bot whose
  // own folder went away first changes to the folder it would move to, through DSH's
  // documented way out (`workingDirectory.set`), and the pre-step then moves it to a
  // fresh part there, as on DSH 0.2.0.
  // The local DSH context type names only two listener arguments; this event has three.
  const onAssemble = ctx.on as unknown as (name: string, listener: (assembly: unknown, context: AssembleContext, next: Next) => unknown, options?: { readonly prepend?: boolean }) => Disposer
  onAssemble('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent
    const folders = ctx.get<WorkingDirectoryService>('workingDirectory')
    if (agent === undefined || typeof folders?.get !== 'function' || readOnly()) return next()
    const current = folders.get(agent.session)
    if (current === undefined || await rt.isFolder(current)) return next()
    await rt.load()
    const team = await rt.keepTeamFolder()
    if (current === team || !rt.isBotSession(agent.id)) return next()
    const place = placeOf(agent.id)
    const wanted = rt.workDirOf(place)
    const target = wanted !== undefined && await rt.isFolder(wanted) ? wanted : team
    if (target !== undefined) {
      await folders.set(agent, target, context.signal)
        .catch(error => rt.warn('ds-bot: %s works in %s, which is gone, and could not change to %s: %s', rt.botOf(place?.botId)?.name ?? agent.id, current, target, error))
    }
    return next()
  }, { prepend: true })

  // A Bot's own chat moves to its new folder now when it is idle; a running turn
  // moves at its next step, and each group conversation at its next turn there.
  async function followFolder(botId: string): Promise<void> {
    const sessionId = rt.chatOf(botId)
    if (sessionId === undefined || switches.has(sessionId) || readOnly()) return
    try {
      const agent = await rt.resolveAgent(sessionId)
      if (agent.status === 'idle' && await move.folderMove(agent) !== undefined) startSwitch(agent, { folder: true })
    } catch (error) {
      rt.warn('ds-bot: %s did not move to its working folder: %s', rt.botOf(botId)?.name ?? botId, error)
    }
  }

  ctx.on<RequestErrorPayload, Next>('agent/request-error', async (payload, next) => {
    const code = payload.failure?.code
    if (code === undefined || !STUCK_CODES.includes(code)) return next()
    const decided = await next()
    if (decided !== undefined || payload.signal?.aborted) return decided
    await rt.load()
    const { agent } = payload
    if (!rt.isBotSession(agent.id) || switches.has(agent.id) || readOnly() || rescued.get(agent.id) === 'bare') return decided
    // A provider may turn down one request for reasons of its own; a history that
    // breaks every request fails the next turn as well.
    const lastCode = lastTurnEnd(agent)?.data?.reason?.error?.code
    if (code === 'INVALID_REQUEST' && !STUCK_CODES.includes(lastCode ?? '')) return decided
    const entry = rt.liveOf(agent.id)
    entry.switched = true
    // The latest messages carried into a rescued part may be what breaks the request.
    startSwitch(agent, { resume: true, info: entry.info, joined: [...(entry.joined ?? [])], overflow: true, failed: code, bare: rescued.has(agent.id) })
    return undefined
  }, { prepend: true })

  ctx.on<RequestErrorPayload, Next>('agent/request-error', async (payload, next) => {
    if (payload.failure?.code !== OVERFLOW || payload.signal?.aborted) return next()
    await rt.load()
    const { agent } = payload
    if (!rt.isBotSession(agent.id) || switches.has(agent.id) || readOnly()) return next()
    const entry = rt.liveOf(agent.id)
    entry.switched = true
    startSwitch(agent, { resume: true, info: entry.info, joined: [...(entry.joined ?? [])], overflow: true })
    return undefined
  }, { prepend: true })

  // At the end of a turn past the check line, the steward decides once. Either way
  // the part ends up below the line, and nothing is decided again until it grows
  // past it.
  async function checkContext(agent: SwitchAgent): Promise<void> {
    if (switches.has(agent.id) || freshParts.has(agent.id) || checking.has(agent.id) || readOnly()) return
    const lines = await contextLines(agent.session)
    const tokens = tokensOf(agent.session)
    if (lines === undefined || tokens === undefined || tokens < lines.check || !grown(agent.id, tokens, lines)) return
    const hard = tokens >= lines.hard
    if (!hard && Date.now() < (noteFailures.get(agent.id)?.until ?? 0)) return
    checking.add(agent.id)
    try {
      if (await decide(agent, { midTurn: false }) === 'compact') {
        const condensed = await condense(agent, lines, { inTurn: false })
        if (condensed !== false) return
      }
      if (switches.has(agent.id)) return
      startSwitch(agent, { hard: (tokensOf(agent.session) ?? tokens) >= lines.hard })
    } finally {
      checking.delete(agent.id)
    }
  }

  // The newest turn/end among the Session's last events in memory.
  function lastTurnEnd(agent: SwitchAgent): SwitchEvent | undefined {
    const latest = agent.session.seq - 1
    for (let seq = latest; seq >= Math.max(0, latest - 199); seq -= 1) {
      const event = agent.session.eventAt?.(seq)
      if (event?.type === 'turn/end') return event
    }
    return undefined
  }

  function releaseRescued(agent: SwitchAgent): void {
    if (!rescued.has(agent.id)) return
    const end = lastTurnEnd(agent)
    if (end !== undefined && end.data?.reason?.kind !== 'error') rescued.delete(agent.id)
  }

  ctx.effect(() => {
    const timer = setTimeout(() => void move.heldBack().catch(error => rt.warn('ds-bot: handing on input kept in earlier parts failed: %s', error)), RESUME_DELAY_MS)
    timer.unref?.()
    return () => clearTimeout(timer)
  }, 'ds-bot: hand on input kept in earlier parts')

  ctx.on<{ readonly agent: SwitchAgent; readonly status?: string | undefined }>('agent/status', ({ agent, status }) => {
    if (status === 'idle' && rt.isBotSession(agent.id)) {
      releaseRescued(agent)
      void checkContext(agent).catch(error => rt.warn('ds-bot: context check for %s failed: %s', agent.id, error))
    }
  })

  return {
    heldBack: move.heldBack,
    followFolder,
    switchJobs: () => switches.values(),
    setPartBase: (sessionId, tokens) => { partBase.set(sessionId, tokens) },
  }
}

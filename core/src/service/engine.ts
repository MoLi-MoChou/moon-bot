// The service's engine wiring (plan §阶段 3): the host runtime, the SQLite store, the
// built-in engine and the bridge, joined. A session the host resolves becomes an
// engine-backed agent whose events flow into the ordinary session/event route; the
// models come from the standalone provider routes, the prompt from the sections the
// host modules registered (the frozen memory section among them), and the transcript
// from the store. Tool definitions resolve through the registry per turn, so a
// capability mounted later is served without rewiring.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createRuntime } from '../index.ts'
import type { DshContext, PromptSection } from '../host/dsh-types.js'
import { BuiltinRuntime } from '../engine/builtin/runtime.ts'
import { sqliteTranscriptOf } from '../engine/builtin/transcript.ts'
import { engineAgentOf } from '../engine/builtin/bridge.ts'
import type { EngineServices, PromptSource, ResolvedModel } from '../engine/builtin/services.ts'
import type { EngineEvent } from '../engine/events.ts'
import { splitRef } from '../host/text.ts'
import { HIDDEN_TOOLS } from '../host/tools/shared.ts'
import { LEAN_HIDDEN_TOOLS } from '../shared/lean.ts'
import { openStore, type Store } from '../store/db.ts'
import { ServiceContext } from './context.ts'
import { FileAttachments } from './attachments.ts'
import { ServiceApproval } from './approval.ts'
import { MemorySync } from './memory-sync.ts'
import { TaskScheduler } from './scheduler.ts'
import { PolicyEngine } from '../engine/policy.ts'
import { AcpRuntime } from '../engine/acp/runtime.ts'
import type { AgentRuntime } from '../engine/runtime.ts'
import type { StandaloneLlm } from './llm.ts'

/** The host runtime's own shape, as the wiring reads it. */
interface Runtime {
  botOf(id: string | undefined): { model?: string, appliedModel?: string, effort?: string, appliedEffort?: string } | undefined
  selfOf(sessionId: string): string | undefined
  toolRegistry: { names(): readonly string[], definitions(names?: readonly string[]): readonly unknown[] }
}

export interface WiredService {
  readonly context: ServiceContext
  readonly runtime: Runtime
  readonly store: Store
  readonly engine: BuiltinRuntime
  agentOf(sessionId: string): unknown
  emitEvent(sessionId: string, event: EngineEvent): void
  close(): Promise<void>
}

export interface WireOptions {
  readonly home: string
  readonly llm: StandaloneLlm
  readonly services?: Readonly<Record<string, unknown>>
}

const EXCLUDED_TOOLS = new Set<string>([...HIDDEN_TOOLS, ...LEAN_HIDDEN_TOOLS])

/** The memory scopes a session may read: its Bot's own, the team's, and its group's. */
const memoryScopesOf = (runtime: Runtime, sessionId: string): readonly string[] => {
  const botId = runtime.selfOf(sessionId)
  if (botId === undefined) return ['team']
  const groups = (runtime as unknown as { groupOwners: Map<string, { roomId: string }> }).groupOwners
  const past = (runtime as unknown as { pastOwners: Map<string, { roomId?: string }> }).pastOwners
  const roomId = groups.get(sessionId)?.roomId ?? past.get(sessionId)?.roomId
  return [`bot:${botId}`, 'team', ...(roomId !== undefined ? [`group:${roomId}`] : [])]
}

/** What the index surfaces for this turn's words: ranked, bounded, prose-only. */
const surfacedMemories = (runtime: Runtime, store: Store, sync: MemorySync, sessionId: string, query: string | undefined): readonly string[] => {
  // Words of real length only: a question made of grammar words ("what is the…")
  // surfaces nothing, while a term that names the subject does.
  const terms = (query ?? '').replace(/[\[\]{}()#>*`|]/g, ' ').split(/\s+/).filter(term => term.length >= 4)
  if (terms.length === 0) return []
  try {
    sync.syncChanged(memoryScopesOf(runtime, sessionId))
    return store.memory.search(memoryScopesOf(runtime, sessionId), terms.join(' '), 4)
      .filter(({ row }) => row.text.trim() !== '')
      .map(({ row }) => row.text.length > 200 ? `${row.text.slice(0, 200)}…` : row.text)
  } catch {
    return []
  }
}

/** Wires the host runtime, the store, the engine and the bridge for one team home. */
export function wireService(options: WireOptions): WiredService {
  // The attachments store serves the host's file surfaces; a caller's own service of
  // the same name still wins.
  const attachments = new FileAttachments(options.home)
  const context = new ServiceContext({
    services: {
      ...(options.services === undefined ? {} : options.services),
      attachments,
    },
  })
  // The approval bridge needs the context's emit; it goes on after the construction.
  const approval = new ServiceApproval((request, next) => { context.emit('approval/request', request, next) })
  context.get = ((name: string) => name === 'approval' ? approval : undefined) as typeof context.get
  const runtime = createRuntime(context as unknown as DshContext, { home: options.home }) as unknown as Runtime
  const store = openStore(options.home)
  // The policy engine over the store's ledger.
  const policy = new PolicyEngine({ countersOf: async (sessionId, level, spend) => store.policy.spend(sessionId, level, spend) })
  // The memory mirror: Markdown stays the source of truth; the index syncs lazily.
  const memorySync = new MemorySync(store, join(options.home, 'memory'))
  memorySync.syncAll()

  // The prompt as the engine reads it: every registered section in order, the frozen
  // memory section kept apart so the stable prefix stays byte-stable.
  const sections = (): readonly PromptSection[] => context.sectionsInOrder() as readonly PromptSection[]
  const prompt: PromptSource = {
    base: async sessionId => sections()
      .filter(section => section.name !== 'bot-memory')
      .map(section => section.text({ agent: { id: sessionId } }))
      .filter(text => text !== '')
      .join('\n\n'),
    frozen: async sessionId => sections()
      .filter(section => section.name === 'bot-memory')
      .map(section => section.text({ agent: { id: sessionId } }))
      .join('\n\n'),
    // The dynamic segment rides after the frozen one, per request, so the stable
    // prefix never moves: the clock, plus what the memory index surfaces for this
    // turn's own words (plan §阶段 4's proactive recall), kept small.
    dynamic: async (sessionId, query): Promise<string | undefined> => {
      const lines: string[] = [`Current time: ${new Date().toISOString()}`]
      const hits = surfacedMemories(runtime, store, memorySync, sessionId, query)
      if (hits.length > 0) lines.push('## From memory (found for this message)', ...hits.map(text => `- ${text}`))
      const text = lines.join('\n')
      // Bounded on purpose: the dynamic segment is paid every turn.
      return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
    },
  }

  const toolsFor = (): readonly string[] => runtime.toolRegistry.names().filter(name => !EXCLUDED_TOOLS.has(name))
  const services: EngineServices = {
    models: {
      resolve: async (sessionId, config): Promise<ResolvedModel | undefined> => {
        const bot = runtime.botOf(runtime.selfOf(sessionId))
        const ref = config?.model ?? bot?.appliedModel ?? bot?.model
        if (ref === undefined || ref === '') return undefined
        const split = splitRef(ref)
        if (split === undefined) return undefined
        const route = options.llm.resolveRoute(split.provider)
        if (route === undefined) return undefined
        const effort = config?.effort ?? bot?.appliedEffort ?? bot?.effort
        return {
          id: split.model,
          baseUrl: route.baseUrl,
          api: route.api,
          ...(route.apiKey !== undefined ? { apiKey: route.apiKey } : {}),
          ...(effort !== undefined ? { effort } : {}),
        }
      },
    },
    prompt,
    // The policy engine (plan §阶段 5): L0–L2 run, L3 runs within its daily budget,
    // L4 asks always; over budget asks too. The decision is the server's — the
    // refusal never names an appeal, and no tool result carries an override.
    gate: {
      check: async (sessionId, tool): Promise<import('../engine/builtin/services.ts').GateDecision> => {
        const decision = await policy.decide(sessionId, tool)
        if (decision.kind === 'allow') return { kind: 'allow' }
        if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason }
        return new Promise(resolve => {
          let settled: ((outcome: 'allow' | 'deny') => void) | undefined
          const settledPromise = new Promise<'allow' | 'deny'>(done => { settled = done })
          const id = randomUUID()
          void context.emit('approval/request', {
            agent: { id: sessionId, session: { id: sessionId } },
            toolName: tool,
            reason: decision.reason,
            signal: undefined,
          }, () => approval.card().then((outcome: string) => {
            settled?.(outcome === 'allowed-once' || outcome === 'allowed' ? 'allow' : 'deny')
            return outcome
          }))
          resolve({ kind: 'pending', approvalId: id, settled: settledPromise })
        })
      },
    },
    transcript: sqliteTranscriptOf(store.sessions as unknown as Parameters<typeof sqliteTranscriptOf>[0]),
    toolsFor,
    definitions: [],
  }
  // The registry is complete only after install (capabilities mount later still), so
  // the definitions resolve through it every time the engine builds a turn.
  Object.defineProperty(services, 'definitions', {
    get: () => runtime.toolRegistry.definitions(toolsFor()),
  })

  const emitEvent = (sessionId: string, event: EngineEvent): void => {
    // The session/event envelope: a type plus its data, as the DSH runtime delivered it.
    context.emit('session/event', { id: sessionId }, { type: event.type, data: event })
  }
  const engine = new BuiltinRuntime({ services, emit: emitEvent })

  const agents = new Map<string, ReturnType<typeof engineAgentOf>>()
  // An ACP Bot runs its turns in an external agent; one runtime per engine spec,
  // shared by every session on it. Everything else about being a Bot — the name, the
  // memory, the group chats, the work — is the roster's, unchanged.
  const acpRuntimes = new Map<string, AcpRuntime>()
  const runtimeOf = (sessionId: string): AgentRuntime => {
    const bot = runtime.botOf(runtime.selfOf(sessionId)) as { engine?: unknown } | undefined
    const engineSpec = bot?.engine
    if (engineSpec !== null && typeof engineSpec === 'object' && (engineSpec as { kind?: unknown }).kind === 'acp') {
      const spec = engineSpec as { command?: unknown, args?: readonly string[] | undefined, key?: unknown }
      const command = typeof spec.command === 'string' ? spec.command : ''
      if (command !== '') {
        const key = typeof spec.key === 'string' ? spec.key : command
        let acp = acpRuntimes.get(key)
        if (acp === undefined) {
          acp = new AcpRuntime({
            command,
            ...(Array.isArray(spec.args) ? { args: spec.args } : {}),
            emit: emitEvent,
          })
          acpRuntimes.set(key, acp)
        }
        return acp
      }
    }
    return engine
  }

  const agentOf = (sessionId: string): unknown => {
    let agent = agents.get(sessionId)
    if (agent === undefined) {
      store.sessions.upsertSession({ id: sessionId, kind: 'bot', ownerId: runtime.selfOf(sessionId) ?? sessionId })
      // The part pager reads the agent session's seq as "the next one"; the store knows.
      agents.set(sessionId, agent = engineAgentOf(sessionId, {
        runtime: runtimeOf(sessionId),
        emitEvent,
        seqOf: () => store.sessions.countMessages(sessionId) + 1,
      }))
    }
    return agent
  }

  // The scheduler fires a task by delivering its prompt to its session with the
  // schedule source the route knows; the poll keeps running across restarts.
  const scheduler = new TaskScheduler(store, (sessionId, task) => {
    const agent = agentOf(sessionId) as { followup?(message: unknown): void } | undefined
    agent?.followup?.({
      content: [{ type: 'text', text: task.prompt === '' ? task.title : `[${task.title}]
${task.prompt}` }],
      source: { kind: 'schedule' },
    })
  })
  context.get = ((name: string) => name === 'approval' ? approval : name === 'schedule' ? scheduler : undefined) as typeof context.get
  context.effect(() => scheduler.start(), 'moon-bot: schedule poll')

  context.resolveAgentWith(agentOf)

  // A history page from the store: each row becomes the session event the chat's
  // pagers read (user and assistant messages; tool results are live-view only).
  context.pageWith(async input => {
    const sessionId = input.address.sessionId
    const limit = Math.max(1, input.maxMessages ?? 60) + 1
    const rows = store.sessions.pageBetween(sessionId, {
      ...(input.throughSeq !== undefined ? { throughSeq: input.throughSeq } : {}),
      ...(input.beforeSeq !== undefined ? { beforeSeq: input.beforeSeq } : {}),
      limit,
    })
    const max = Math.max(1, input.maxMessages ?? 60)
    const hasMore = rows.length > max
    const shown = hasMore ? rows.slice(0, max) : rows
    return {
      records: shown.flatMap((row): { seq: number, event: { type: string, time: number, data: unknown } }[] => {
        if (row.role === 'user') {
          return [{ seq: row.seq, event: { type: 'user/message', time: row.createdAt, data: { content: row.content, source: row.source } } }]
        }
        if (row.role === 'assistant') {
          return [{ seq: row.seq, event: { type: 'assistant/message', time: row.createdAt, data: { message: { content: row.content }, turn: row.turn ?? undefined } } }]
        }
        return []
      }),
      hasMore,
    }
  })

  return {
    context, runtime, store, engine, agentOf, emitEvent,
    close: async () => {
      await engine.stop()
      for (const acp of acpRuntimes.values()) await acp.stop().catch(() => {})
      await context.dispose()
      store.close()
    },
  }
}

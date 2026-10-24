// The service's engine wiring (plan §阶段 3): the host runtime, the SQLite store, the
// built-in engine and the bridge, joined. A session the host resolves becomes an
// engine-backed agent whose events flow into the ordinary session/event route; the
// models come from the standalone provider routes, the prompt from the sections the
// host modules registered (the frozen memory section among them), and the transcript
// from the store. Tool definitions resolve through the registry per turn, so a
// capability mounted later is served without rewiring.
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

/** Wires the host runtime, the store, the engine and the bridge for one team home. */
export function wireService(options: WireOptions): WiredService {
  const context = new ServiceContext(options.services === undefined ? {} : { services: options.services })
  const runtime = createRuntime(context as unknown as DshContext, { home: options.home }) as unknown as Runtime
  const store = openStore(options.home)

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
    // The policy engine (phase 5) takes this seat; until then every call runs.
    gate: { check: async () => ({ kind: 'allow' }) },
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
  const agentOf = (sessionId: string): unknown => {
    let agent = agents.get(sessionId)
    if (agent === undefined) {
      store.sessions.upsertSession({ id: sessionId, kind: 'bot', ownerId: runtime.selfOf(sessionId) ?? sessionId })
      agents.set(sessionId, agent = engineAgentOf(sessionId, { runtime: engine, emitEvent }))
    }
    return agent
  }

  context.resolveAgentWith(agentOf)

  return {
    context, runtime, store, engine, agentOf, emitEvent,
    close: async () => {
      await engine.stop()
      await context.dispose()
      store.close()
    },
  }
}

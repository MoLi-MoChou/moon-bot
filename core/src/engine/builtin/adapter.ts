// The pi side of the built-in engine: how a pi Agent is built from the host's services
// and how its events map to the EngineEvent vocabulary. Everything kernel-specific lives
// here, so the runtime module stays orchestration only (plan §四: 内置引擎 pi 内核接入).
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import { createInitialSystemMessage, toToolDeclaration, type Model } from '@earendil-works/pi-ai'
import type typebox from 'typebox'
import type { EngineContentBlock, EngineEvent, EngineStopReason } from '../events.ts'
import type { EngineSessionConfig } from '../runtime.ts'
import type { EngineServices, ResolvedModel, StoredMessage, ToolDefinition } from './services.ts'

/** A pi Model for any endpoint the engine speaks; `input` is required: image checks read it. */
export const piModelOf = (resolved: ResolvedModel): Model<'openai-completions' | 'anthropic-messages'> => ({
  id: resolved.id, name: resolved.id, api: resolved.api ?? 'openai-completions', provider: 'moon', baseUrl: resolved.baseUrl,
  input: ['text'], reasoning: false,
  contextWindow: resolved.contextWindow ?? 128000, maxTokens: resolved.maxTokens ?? 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** A host tool definition as a pi AgentTool: the registry's Zod schema is its wire schema. */
export const piToolOf = (definition: ToolDefinition, sessionId: string): AgentTool => ({
  name: definition.name,
  label: definition.label ?? definition.name,
  description: definition.description,
  // typebox schemas are JSON Schema; the host's Zod-built parameters already are one.
  parameters: definition.parameters as unknown as typebox.TSchema,
  execute: async (callId, input, signal) => {
    const outcome = await definition.execute(input as Readonly<Record<string, unknown>>, { sessionId, callId, ...(signal !== undefined ? { signal } : {}) })
    return {
      content: outcome.content.map(blockOf),
      details: undefined,
      ...(outcome.isError === true ? { isError: true } : {}),
      ...(outcome.structured !== undefined ? { structuredContent: outcome.structured as never } : {}),
    }
  },
})

const blockOf = (block: EngineContentBlock): { type: 'text'; text: string } => {
  if (block.type === 'text') return { type: 'text', text: block.text }
  // Non-text blocks (images, files) ride as their textual stand-in; the host keeps the original.
  return { type: 'text', text: JSON.stringify(block) }
}

const stopReasonOf = (reason: string | undefined): EngineStopReason['kind'] => {
  if (reason === 'aborted') return 'aborted'
  if (reason === 'error' || reason === 'pending') return 'error'
  return 'completed'
}

/** The content blocks of a pi assistant message as the host reads them. */
export const contentOfPi = (message: { content: readonly unknown[] }): readonly EngineContentBlock[] => message.content.flatMap((block): readonly EngineContentBlock[] => {
  if (block === null || typeof block !== 'object') return []
  const view = block as { type?: unknown; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
  if (view.type === 'text' && typeof view.text === 'string') return [{ type: 'text', text: view.text }]
  if (view.type === 'thinking' && typeof view.thinking === 'string') return [{ type: 'thinking', text: view.thinking }]
  if (view.type === 'toolCall') {
    return [{
      type: 'tool-call',
      id: String(view.id ?? ''),
      name: String(view.name ?? ''),
      arguments: typeof view.arguments === 'string' ? view.arguments : JSON.stringify(view.arguments ?? {}),
    }]
  }
  return []
})

export interface AdapterCallbacks {
  readonly onEvent: (event: EngineEvent) => void
}

export interface AdapterOptions {
  readonly sessionId: string
  readonly services: EngineServices
  readonly config: EngineSessionConfig | undefined
  readonly basePrompt: string
  readonly frozenPrompt: string
  readonly dynamicPrompt: string | undefined
  /** The session's stored transcript; raw kernel messages replay verbatim. */
  readonly history: readonly StoredMessage[]
  readonly resolved: ResolvedModel
  readonly callbacks: AdapterCallbacks
}

/**
 * Builds the pi Agent for one turn: the kernel-specific half of the engine. The prompt
 * order is the host's (base + frozen memory as the stored system message, the dynamic
 * segment injected per request without touching the transcript), and every tool call
 * passes the gate before it runs.
 */
export async function buildAgent(options: AdapterOptions): Promise<Agent> {
  const { sessionId, services, config, basePrompt, frozenPrompt, dynamicPrompt, history, resolved, callbacks } = options
  // The wire protocol picks the stream; the one runtime-checked cast is here, once,
  // because the Agent's streamFn is generic over every Api.
  const { streamSimple } = resolved.api === 'anthropic-messages'
    ? await import('@earendil-works/pi-ai/api/anthropic-messages')
    : await import('@earendil-works/pi-ai/api/openai-completions')
  const streamFn = streamSimple as unknown as import('@earendil-works/pi-agent-core').StreamFn
  const names = new Set(services.toolsFor(sessionId))
  const offered = (config?.tools === undefined ? [...names] : config.tools.filter(name => names.has(name)))
    .map(name => services.definitions.find(definition => definition.name === name))
    .filter((definition): definition is ToolDefinition => definition !== undefined)
  const piTools = offered.map(definition => piToolOf(definition, sessionId))
  const system = frozenPrompt === '' ? basePrompt : `${basePrompt}\n\n${frozenPrompt}`
  // The transcript replays as the kernel wrote it (raw), or as rebuilt user content;
  // system entries never replay — the prompt above is the one leading message.
  const replayed = history.flatMap((message): AgentMessage[] => {
    if (message.role === 'system') return []
    if (message.raw !== null && message.raw !== undefined) return [message.raw as AgentMessage]
    if (message.role === 'user') {
      return [{
        role: 'user',
        content: message.content.map(block => ({ type: 'text' as const, text: block.type === 'text' ? block.text : JSON.stringify(block) })),
        timestamp: message.at,
      }]
    }
    return []
  })
  const agent = new Agent({
    initialState: {
      systemPrompt: system,
      model: piModelOf(resolved),
      tools: piTools,
      // When a transcript replays, the agent does not build the leading system message,
      // so ours carries the tool declarations exactly as its own would.
      ...(replayed.length > 0 ? { messages: [createInitialSystemMessage(system, piTools.map(toToolDeclaration)) as AgentMessage, ...replayed] } : {}),
    },
    streamFn,
    // A keyless local endpoint still needs a non-empty key for the wire client; real
    // endpoints bring their own.
    getApiKey: () => resolved.apiKey ?? 'keyless',
    sessionId,
    // The dynamic segment is request-scoped: the stored transcript (and so the cached
    // prefix) never moves; what may change rides after it, once per request.
    transformContext: async messages => (dynamicPrompt === undefined || dynamicPrompt === ''
      ? messages
      : [...messages, { role: 'system', content: dynamicPrompt, timestamp: Date.now() } as AgentMessage]),
    beforeToolCall: async context => {
      const decision = await services.gate.check(sessionId, context.toolCall.name, (context.args ?? {}) as Readonly<Record<string, unknown>>)
      if (decision.kind === 'allow') return undefined
      if (decision.kind === 'deny') return { block: true, reason: decision.reason }
      // The call holds until the approval settles; a rejection names why.
      return decision.settled.then(outcome => outcome === 'allow' ? undefined : { block: true, reason: 'the approval for this call was not given' })
    },
  })
  agent.subscribe((event: AgentEvent) => {
    const mapped = eventToEngine(event)
    if (mapped !== undefined) callbacks.onEvent(mapped)
  })
  return agent
}

/** pi AgentEvents as EngineEvents; the last message's stop reason becomes the turn's end. */
export function eventToEngine(event: AgentEvent): EngineEvent | undefined {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') return { type: 'assistant/stream', text: event.assistantMessageEvent.delta }
      return undefined
    case 'message_end':
      if (event.message.role !== 'assistant') return undefined
      return { type: 'assistant/message', message: { content: contentOfPi(event.message) } }
    case 'tool_execution_start':
      return { type: 'tool/call', callId: event.toolCallId, name: event.toolName, arguments: JSON.stringify(event.args ?? {}) }
    case 'tool_execution_end':
      return { type: 'tool/result', callId: event.toolCallId, ...(event.isError === true ? { isError: true } : {}) }
    default:
      return undefined
  }
}

/** The turn/end event for a finished run, from the last assistant message pi produced. */
export const endEventOf = (turn: number, last: { stopReason?: string | undefined; errorMessage?: string | undefined; usages?: unknown } | undefined, abortReason?: string | undefined): EngineEvent => {
  if (last === undefined) return { type: 'turn/end', turn, reason: { kind: 'completed' } }
  const kind = stopReasonOf(last.stopReason)
  if (kind === 'aborted') return { type: 'turn/end', turn, reason: { kind: 'aborted', ...(abortReason !== undefined ? { reason: abortReason } : {}) } }
  if (kind === 'error') return { type: 'turn/end', turn, reason: { kind: 'error', error: { message: last.errorMessage ?? 'the model call failed' } } }
  return { type: 'turn/end', turn, reason: { kind: 'completed' } }
}

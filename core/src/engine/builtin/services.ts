// What the host injects into the built-in engine (plan §四): the engine executes turns;
// memory, policy, scheduling and the model catalog stay with Moon Bot and arrive here.
// Every interface is small on purpose: the ACP adapter implements the same seam with
// protocol-shaped versions of the same answers.
import type { EngineContentBlock } from '../events.ts'
import type { EngineSessionConfig } from '../runtime.ts'

/** A model as the engine may call it: a wire protocol, an endpoint, and a key. */
export interface ResolvedModel {
  readonly id: string
  readonly baseUrl: string
  /** The wire protocol; OpenAI-compatible endpoints are the default. */
  readonly api?: 'openai-completions' | 'anthropic-messages' | undefined
  readonly apiKey?: string | undefined
  readonly effort?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxTokens?: number | undefined
}

/** The model catalog: what a session runs on, and what else exists. */
export interface ModelSource {
  resolve(sessionId: string, config: EngineSessionConfig | undefined): Promise<ResolvedModel | undefined>
}

/** The system prompt in the order the host built it: base first, frozen memory after. */
export interface PromptSource {
  base(sessionId: string): Promise<string>
  /** The frozen memory segment: byte-stable within a session part, so the prefix caches. */
  frozen(sessionId: string): Promise<string>
  /** The dynamic segment: per-turn context (time, live state); may change every turn. */
  dynamic?(sessionId: string): Promise<string | undefined>
}

/** A tool the registry serves: Zod schema in, text/content out. */
export interface ToolDefinition<TInput = Readonly<Record<string, unknown>>> {
  readonly name: string
  readonly label?: string | undefined
  readonly description: string
  /** A JSON Schema (Zod-compatible) for the tool's input. */
  readonly parameters: Readonly<Record<string, unknown>>
  execute(input: TInput, context: ToolContext): Promise<ToolOutcome>
}

export interface ToolContext {
  readonly sessionId: string
  readonly callId: string
  readonly signal?: AbortSignal | undefined
}

export interface ToolOutcome {
  readonly content: readonly EngineContentBlock[]
  readonly isError?: boolean
  /** Structured output for the host (views, cards); the model sees `content`. */
  readonly structured?: unknown
}

/** One gate decision: run, refuse, or wait for an approval that may never come. */
export type GateDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'pending'; readonly approvalId: string }

/**
 * The tool gate: the permissions/approvals flow moved from DSH's tool execution into
 * this seam. `check` may suspend (return after its approval resolves); the engine
 * holds the call until it answers.
 */
export interface ToolGate {
  check(sessionId: string, tool: string, input: Readonly<Record<string, unknown>>): Promise<GateDecision>
  /** The approvals view (ask_user cards and the like) the host shows. */
  resolve?(approvalId: string, outcome: 'allow' | 'deny' | 'cancel'): void
}

/** The transcript store: the engine appends what a turn said; history reads back. */
export interface TranscriptStore {
  /** The stored history as pi messages: system base, then turns in order. */
  history(sessionId: string): Promise<readonly StoredMessage[]>
  append(sessionId: string, message: StoredMessage): Promise<void>
  /** A fresh session part: the handoff summary becomes the base, history clears. */
  rollOver?(sessionId: string, base: string): Promise<void>
}

export interface StoredMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'toolResult'
  readonly content: readonly EngineContentBlock[]
  readonly stopReason?: string | undefined
  readonly turn?: number | undefined
  /** The kernel message as stored JSON, replayed verbatim on the next turn. */
  readonly raw?: unknown
  readonly at: number
}

/** Everything the built-in engine needs from the host. */
export interface EngineServices {
  readonly models: ModelSource
  readonly prompt: PromptSource
  readonly gate: ToolGate
  readonly transcript: TranscriptStore
  /** Names of tools a session may call, in offer order. */
  toolsFor(sessionId: string): readonly string[]
  readonly definitions: readonly ToolDefinition[]
}

// The AgentRuntime interface (plan §四, §阶段 1): the one seam between the host services
// and whatever engine executes a Bot's turns. The built-in pi engine and the ACP adapter
// both implement it; the host never imports a kernel directly.
//
// Ownership follows the plan's principle: the engine executes turns (transcript, loop,
// streaming, cancellation); memory, policy, scheduling and validation stay with Moon
// Bot's host and reach the engine only through this interface's inputs.
import type { EngineContentBlock, EngineEvent } from './events.ts'

/** The message that opens or joins a turn: its content plus the delivery source. */
export interface TurnMessage {
  readonly content: readonly EngineContentBlock[]
  /** The trigger as delivery carries it (role, exchangeId, sender…); passed back with every `user/message`. */
  readonly source?: Readonly<Record<string, unknown>> | undefined
}

/** What a session runs on. The host owns the prompt's order and content; the engine only sends it. */
export interface EngineSessionConfig {
  /** Model id as the host's catalog resolves it; the engine maps it to its kernel. */
  readonly model?: string | undefined
  readonly effort?: string | undefined
  /** The full system prompt, frozen memory included, in the order the host built it. */
  readonly systemPrompt?: string | undefined
  /** The tools this session may call, by name; the registry decides what they are. */
  readonly tools?: readonly string[] | undefined
}

/** One turn to run: the session it runs on, its trigger, and the session's config. */
export interface TurnInput {
  readonly sessionId: string
  readonly message: TurnMessage
  readonly config?: EngineSessionConfig | undefined
}

/** Who cancelled a running turn; the abort reason the resume notes keep. */
export type CancelReason = 'user' | 'disposed' | string

/**
 * The engine seam. One instance serves every session.
 *
 * - `runTurn` returns when its turn ends; a call made while another turn runs on the
 *   same session waits for its slot (the inbox semantics the roster builds on). Events
 *   arrive in order; the last is always `turn/end`, also on failure — the engine
 *   reports trouble as an `error` reason, it does not throw.
 * - `steer` lands a message inside the running turn, or reports that none runs; it
 *   never queues.
 * - `cancelTurn` aborts the running turn; its `runTurn` iterator then ends with an
 *   `aborted` `turn/end`. Turns still queued are not cancelled.
 */
export interface AgentRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  runTurn(input: TurnInput): AsyncIterable<EngineEvent>
  steer(sessionId: string, message: TurnMessage): Promise<boolean>
  cancelTurn(sessionId: string, reason?: CancelReason): Promise<void>
}

/** A runtime together with what it is: the name the roster and the UI show. */
export interface EngineInfo {
  readonly id: string
  readonly label: string
  /** Which protocol family drives it; `builtin` is the pi kernel, `acp` an ACP agent. */
  readonly kind: 'builtin' | 'acp' | string
}

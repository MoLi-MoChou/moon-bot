// The `@deepseek-ai/*` API as the host uses it, without depending on a DSH install: the
// packages ship from the harness dev tree, not from core/node_modules, so `npm run
// typecheck` in a clean checkout would not resolve them otherwise.
//
// Only what a migrated host module imports is declared here; the surface grows with the
// migration. Each entry is a structural shape, so a DSH upgrade that keeps the shape
// needs no change here. The declarations live inside `declare module` because that is
// what makes them ambient: a top-level import here would turn the file into a module and
// the `declare module` into an augmentation of something that does not exist.
declare module '@deepseek-ai/dsh-tools' {
  /** What a tool's execute gets: the tool call and the agent that made it. */
  export interface ToolRunContext {
    readonly name?: string
    readonly callId?: string
    readonly agent?: {
      readonly id?: string
      readonly session?: { readonly header?: Readonly<Record<string, unknown>> }
    }
    readonly signal?: AbortSignal
    /** Ends the Bot's turn after a card is shown. */
    concludeTurn?(): void
  }

  /** A tool definition, as this plugin writes it. */
  export function defineTool<T extends {
    readonly name: string
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
    readonly output?: unknown
    execute(args: Readonly<Record<string, unknown>>, exec: ToolRunContext): Promise<unknown>
  }>(definition: T): T
}

declare module '@deepseek-ai/dsh-llm' {
  export interface LlmMessageSource {
    readonly kind?: unknown
    readonly [key: string]: unknown
  }

  export interface LlmTextBlock {
    readonly type: string
    readonly text?: string
    readonly [key: string]: unknown
  }

  /** A user message a plugin injects into a Session. */
  export interface LlmUserMessage {
    readonly content: readonly LlmTextBlock[]
    readonly source?: LlmMessageSource
  }

  /** One chunk of a model stream. */
  export interface LlmStreamChunk {
    readonly type?: string
    readonly [key: string]: unknown
  }

  /** A block the assembler collected. */
  export interface LlmBlock {
    readonly type: string
    readonly text?: string
    readonly [key: string]: unknown
  }

  /** How a stream ended. */
  export interface LlmStreamFinish {
    readonly kind: string
    readonly failure?: { readonly message?: string }
  }

  /** Collects a streamed reply's blocks; the caller reads the finish and the blocks. */
  export class BlockAssembler {
    push(chunk: LlmStreamChunk): void
    readonly finish: LlmStreamFinish
    blocks(): readonly LlmBlock[]
    /** Token usage of the reply, once the stream finished. */
    readonly usage?: unknown
  }

  export function createUserMessage(input: {
    readonly content: readonly LlmTextBlock[]
    readonly source?: LlmMessageSource
  }): LlmUserMessage
}

declare module '@deepseek-ai/dsh-web' {
  // Structural, like the entries above: only what web-search.ts imports. `WebError` is
  // constructed with a message, a machine-routable `code`, and optional ErrorOptions; it
  // reads as a plain Error whose `code` says which seam failed.
  export class WebError extends Error {
    /** Stable failure class (e.g. `WEB_SEARCH_UNAVAILABLE`); route on this, never by parsing `message`. */
    readonly code: string
    constructor(message: string, code: string, options?: ErrorOptions)
  }
}

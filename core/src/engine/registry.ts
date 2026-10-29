// The tool registry (plan §阶段 2): Zod is the validation truth for every tool the team
// serves; the descriptive parameter map rides along for the wire and the UI. Entries
// keep their lenient executors — the host derivation runs them exactly as before — while
// `definitions()` wraps each in schema validation for the engine path, where a kernel
// hands the registry what the model wrote, unchecked.
import { z } from 'zod'
import type { EngineContentBlock } from './events.ts'

/** What a tool executes against: the session that asked, and the call it belongs to. */
export interface ToolContext {
  readonly sessionId: string
  readonly callId: string
  /** The session object the host's folder helpers read; `{ id }` where there is no more. */
  readonly session?: unknown
  readonly signal?: AbortSignal | undefined
  /** Ends the Bot's turn after a card is shown; absent where the runtime cannot. */
  concludeTurn?(): void
}

/** What a tool answers: model-facing content, an error mark, host-facing structure. */
export interface ToolOutcome {
  readonly content: readonly EngineContentBlock[]
  readonly isError?: boolean
  readonly structured?: unknown
}

/** A plain-text answer, the common case. */
export const textOutcome = (text: string): ToolOutcome => ({ content: [{ type: 'text', text }] })

/** One registered tool: `parameters` documents, `schema` decides, `execute` runs. */
export interface ToolEntry<TInput = Readonly<Record<string, unknown>>> {
  readonly name: string
  readonly label?: string | undefined
  readonly description: string
  /** The descriptive parameter map (the host wire format) shown to models and the UI. */
  readonly parameters: Readonly<Record<string, unknown>>
  readonly schema: z.ZodType<TInput>
  execute(input: TInput, context: ToolContext): Promise<ToolOutcome | string>
}

/** A tool as the engine serves it: schema-validated input, normalized output. */
export interface ToolDefinition<TInput = Readonly<Record<string, unknown>>> {
  readonly name: string
  readonly label?: string | undefined
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  execute(input: TInput, context: ToolContext): Promise<ToolOutcome>
}

/** The input a schema refused, as the model sees it. */
const invalidOutcome = (name: string, issues: readonly z.ZodIssue[]): ToolOutcome => ({
  content: [{ type: 'text', text: `${name} received arguments it cannot accept: ${issues.map(issue => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}` }],
  isError: true,
})

/** Wraps an entry for the engine path: validate through the schema, normalize the answer. */
export function zodTool<TInput>(entry: ToolEntry<TInput>): ToolDefinition<TInput> {
  return {
    name: entry.name,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    description: entry.description,
    parameters: entry.parameters,
    async execute(input, context) {
      const parsed = entry.schema.safeParse(input)
      if (!parsed.success) return invalidOutcome(entry.name, parsed.error.issues)
      const outcome = await entry.execute(parsed.data, context)
      return typeof outcome === 'string' ? textOutcome(outcome) : outcome
    },
  }
}

/** The registry the host fills and the engine serves from. */
export class ToolRegistry {
  private readonly entries = new Map<string, ToolEntry>()
  // How many live mounts serve each name: a Bot's chat and its group Sessions can mount
  // the same capability, so one Session ending must not take the other's tools away.
  private readonly refs = new Map<string, number>()

  register(entry: ToolEntry): void {
    this.entries.set(entry.name, entry)
    this.refs.set(entry.name, (this.refs.get(entry.name) ?? 0) + 1)
  }

  get(name: string): ToolEntry | undefined {
    return this.entries.get(name)
  }

  /** Releases one mount's claim; the tool goes when the last claim does. */
  unregister(name: string): void {
    const left = (this.refs.get(name) ?? 1) - 1
    if (left > 0) { this.refs.set(name, left); return }
    this.refs.delete(name)
    this.entries.delete(name)
  }

  names(): readonly string[] {
    return [...this.entries.keys()]
  }

  /** The entries as the engine serves them, schema-validated, in registration order. */
  definitions(names?: readonly string[]): readonly ToolDefinition[] {
    const wanted = names === undefined ? undefined : new Set(names)
    return [...this.entries.values()]
      .filter(entry => wanted === undefined || wanted.has(entry.name))
      .map(entry => zodTool(entry))
  }
}

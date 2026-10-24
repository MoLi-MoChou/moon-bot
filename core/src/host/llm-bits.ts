// The two message utilities the host used to take from DSH's llm package, written for
// the standalone runtime (plan §三.3: the five runtime symbols go, one batch at a time).
// The shapes are the wire's, not DSH's: a user message is its content and source, and
// the assembler folds a stream's chunks into blocks in stream order.
import { randomUUID } from 'node:crypto'

/** A user message as an inbox takes it: role, content, source, and a stable identity. */
export interface UserMessage {
  readonly role: 'user'
  readonly id: string
  readonly content: readonly unknown[]
  readonly source?: Readonly<Record<string, unknown>> | undefined
}

export function createUserMessage(input: { content: readonly unknown[], source?: Readonly<Record<string, unknown>> | undefined }): UserMessage {
  return structuredClone({ role: 'user', id: randomUUID(), content: input.content, ...(input.source !== undefined ? { source: input.source } : {}) }) as UserMessage
}

/** One chunk of a model stream, as the loop hands it to the assembler. */
export type LlmStreamChunk =
  | { readonly type: 'block-start', readonly index: number, readonly blockType: 'text' | 'reasoning' | 'tool-call' }
  | { readonly type: 'text-delta' | 'reasoning-delta', readonly index: number, readonly text: string }
  | { readonly type: 'tool-call-delta', readonly index: number, readonly id?: string, readonly name?: string, readonly argumentsDelta: string }
  | { readonly type: 'block-end', readonly index: number, readonly block: { readonly type: string, readonly [key: string]: unknown } }
  | { readonly type: 'usage', readonly usage: Readonly<Record<string, unknown>> }
  | { readonly type: 'finish', readonly reason: StreamFinish }

/** How a stream ended; an error or abort carries its failure. */
export interface StreamFinish {
  readonly kind: string
  readonly failure?: { readonly message?: string | undefined, readonly [key: string]: unknown } | undefined
  readonly [key: string]: unknown
}

/** One assembled content block. */
export interface AssembledBlock {
  readonly type: 'text' | 'reasoning' | 'tool-call'
  readonly text?: string | undefined
  readonly id?: string | undefined
  readonly name?: string | undefined
  readonly arguments?: string | undefined
}

interface Partial {
  blockType: 'text' | 'reasoning' | 'tool-call'
  text: string
  toolCallId?: string | undefined
  toolCallName?: string | undefined
  toolCallArguments: string
  block?: AssembledBlock | undefined
}

/**
 * Folds a stream's chunks into its blocks, in stream order: deltas accumulate into the
 * block they name, a `block-end` closes one, `usage`/`finish` are kept for the end. An
 * open block assembles from what it accumulated; a `tool-call` that never closed keeps
 * a stable fabricated id.
 */
export class BlockAssembler {
  private readonly partials = new Map<number, Partial>()
  private readonly order: number[] = []
  private usageValue: Readonly<Record<string, unknown>> | undefined
  private finishValue: StreamFinish | undefined

  push(chunk: LlmStreamChunk): void {
    if (chunk.type === 'block-start') {
      if (!this.partials.has(chunk.index)) {
        this.order.push(chunk.index)
        this.partials.set(chunk.index, { blockType: chunk.blockType, text: '', toolCallArguments: '' })
      }
      return
    }
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning').text += chunk.text
      return
    }
    if (chunk.type === 'tool-call-delta') {
      const partial = this.ensure(chunk.index, 'tool-call')
      if (chunk.id !== undefined) partial.toolCallId = chunk.id
      if (chunk.name !== undefined) partial.toolCallName = chunk.name
      partial.toolCallArguments += chunk.argumentsDelta
      return
    }
    if (chunk.type === 'block-end') {
      this.ensure(chunk.index, chunk.block.type === 'reasoning' ? 'reasoning' : chunk.block.type === 'tool-call' ? 'tool-call' : 'text').block = chunk.block as AssembledBlock
      return
    }
    if (chunk.type === 'usage') {
      this.usageValue = chunk.usage
      return
    }
    if (chunk.type === 'finish') this.finishValue = chunk.reason
  }

  private ensure(index: number, blockType: Partial['blockType']): Partial {
    let partial = this.partials.get(index)
    if (partial === undefined) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  private assemble(partial: Partial, index: number): AssembledBlock {
    if (partial.block !== undefined) return partial.block
    if (partial.blockType === 'tool-call') {
      return {
        type: 'tool-call',
        id: partial.toolCallId ?? `call-${index}`,
        name: partial.toolCallName ?? '',
        arguments: partial.toolCallArguments,
      }
    }
    return { type: partial.blockType, text: partial.text }
  }

  /** Every block seen so far, in stream order. */
  blocks(): readonly AssembledBlock[] {
    return this.order.map(index => this.assemble(this.partials.get(index) as Partial, index))
  }

  /** The prefix an interrupted stream can safely finalize: text blocks with content. */
  interruptedBlocks(): readonly AssembledBlock[] {
    return this.order
      .map(index => this.assemble(this.partials.get(index) as Partial, index))
      .filter(block => (block.type === 'text' || block.type === 'reasoning') && (block.text ?? '').trim() !== '')
  }

  get usage(): Readonly<Record<string, unknown>> | undefined {
    return this.usageValue
  }

  /** The finish reason; `stop` when the stream ended without one. */
  get finish(): StreamFinish {
    return this.finishValue ?? { kind: 'stop' }
  }
}

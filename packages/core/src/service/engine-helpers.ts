// Types and memory helpers for service engine wiring.
import { HIDDEN_TOOLS } from '../host/tools/shared.ts'
import { LEAN_HIDDEN_TOOLS } from 'moon-bot-contracts'
import type { Store } from '../store/db.ts'
import type { EngineEvent } from '../engine/events.ts'
import type { BuiltinRuntime } from '../engine/builtin/runtime.ts'
import { ServiceContext } from './context.ts'
import { MemorySync } from './memory-sync.ts'
import { RelayRegistry } from './relay.ts'
import type { StandaloneLlm } from './llm.ts'

export interface Runtime {
  botOf(id: string | undefined):
    | {
        model?: string
        appliedModel?: string
        effort?: string
        appliedEffort?: string
        engine?: unknown
        runtimeId?: string
      }
    | undefined
  selfOf(sessionId: string): string | undefined
  toolRegistry: { names(): readonly string[]; definitions(names?: readonly string[]): readonly unknown[] }
  /** Where a Bot works, as the folders module resolves it; the deliverables scan needs it. */
  workDirOf?(input: { readonly botId?: string | undefined; readonly roomId?: string | undefined }): string | undefined
  groupOwners?: Map<string, { readonly roomId?: string | undefined }>
  /** A group chat by its own Session id, for the relay's model and folder. */
  roomOf?(
    roomId: string | undefined,
  ): { readonly admin?: string | null | undefined; readonly members: readonly string[] } | undefined
  redactSecrets?(text: string): string
}

export interface WiredService {
  readonly context: ServiceContext
  readonly runtime: Runtime
  readonly store: Store
  readonly engine: BuiltinRuntime
  /** The remote-agent relay: live connections the runner and the route share. */
  readonly relay: RelayRegistry
  agentOf(sessionId: string): unknown
  emitEvent(sessionId: string, event: EngineEvent): void
  close(): Promise<void>
}

export interface WireOptions {
  readonly home: string
  readonly llm: StandaloneLlm
  readonly services?: Readonly<Record<string, unknown>>
}

export const EXCLUDED_TOOLS = new Set<string>([...HIDDEN_TOOLS, ...LEAN_HIDDEN_TOOLS])

/** The memory scopes a session may read: its Bot's own, the team's, and its group's. */
export const memoryScopesOf = (runtime: Runtime, sessionId: string): readonly string[] => {
  const botId = runtime.selfOf(sessionId)
  if (botId === undefined) return ['team']
  const groups = (runtime as unknown as { groupOwners: Map<string, { roomId: string }> }).groupOwners
  const past = (runtime as unknown as { pastOwners: Map<string, { roomId?: string }> }).pastOwners
  const roomId = groups.get(sessionId)?.roomId ?? past.get(sessionId)?.roomId
  return [`bot:${botId}`, 'team', ...(roomId !== undefined ? [`group:${roomId}`] : [])]
}

/** What the index surfaces for this turn's words: ranked, bounded, prose-only. */
export const surfacedMemories = (
  runtime: Runtime,
  store: Store,
  sync: MemorySync,
  sessionId: string,
  query: string | undefined,
): readonly string[] => {
  // Words of real length only: a question made of grammar words ("what is the…")
  // surfaces nothing, while a term that names the subject does.
  const terms = (query ?? '')
    .replace(/[[\]{}()#>*`|]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length >= 4)
  if (terms.length === 0) return []
  try {
    sync.syncChanged(memoryScopesOf(runtime, sessionId))
    return store.memory
      .search(memoryScopesOf(runtime, sessionId), terms.join(' '), 4)
      .filter(({ row }) => row.text.trim() !== '')
      .map(({ row }) => (row.text.length > 200 ? `${row.text.slice(0, 200)}…` : row.text))
  } catch {
    return []
  }
}

/** Wires the host runtime, the store, the engine and the bridge for one team home. */

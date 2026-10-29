// The engines a Bot can run on, as the team tools name them.
//
// A team tool that changes a Bot's engine has to answer two things: which engines exist
// right now, and what a name the model typed means. Both live here so `create_bot` and
// `update_bot` answer the same way, and so a name that is merely similar to an engine is
// refused with the list instead of silently becoming the built-in one.
import type { EngineCatalog } from '../../engine/acp/discovery.ts'

export interface EngineChoice {
  /** How a tool names it: `builtin`, a catalog id, or `remote:<agentId>`. */
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly selectable: boolean
  readonly reason?: string | undefined
}

/** Every engine the picker would offer, in the order a person sees them. */
export function engineChoices(catalog: EngineCatalog | undefined): EngineChoice[] {
  const builtin: EngineChoice = { id: 'builtin', label: 'Moon Bot built-in', kind: 'builtin', selectable: true }
  const fromCatalog = (catalog?.list() ?? []).map((agent): EngineChoice => ({
    id: agent.id,
    label: agent.label,
    kind: agent.kind,
    selectable: agent.kind === 'acp' && agent.path !== undefined && agent.path !== '',
    ...(agent.reason === undefined ? {} : { reason: agent.reason }),
  }))
  return [builtin, ...fromCatalog]
}

/** The line a tool prints when it needs the model to ask which engine. */
export function engineList(choices: readonly EngineChoice[]): string {
  const usable = choices.filter(choice => choice.selectable)
  if (usable.length === 0) return 'Moon Bot built-in'
  return usable.map(choice => (choice.id === 'builtin' ? 'builtin (Moon Bot built-in)' : `${choice.id} (${choice.label})`)).join(', ')
}

export type EngineLookup =
  | { readonly ok: true; readonly engine: Readonly<Record<string, unknown>>; readonly runtimeId: string }
  | { readonly ok: false; readonly message: string }

/**
 * What one engine name means. An empty name is not this function's problem — the caller
 * decides whether leaving it out means "keep it" or "ask the user".
 */
export function engineOf(name: string, choices: readonly EngineChoice[], catalog: EngineCatalog | undefined): EngineLookup {
  const wanted = name.trim()
  if (wanted === 'builtin' || wanted === '') return { ok: true, engine: { kind: 'builtin' }, runtimeId: 'builtin' }
  if (wanted.startsWith('remote:')) {
    return { ok: true, engine: { kind: 'acp-remote', agentId: wanted.slice('remote:'.length) }, runtimeId: wanted }
  }
  const match = choices.find(choice => choice.id === wanted && choice.kind === 'acp')
  if (match === undefined) {
    return { ok: false, message: `There is no engine "${wanted}". The engines right now are: ${engineList(choices)}.` }
  }
  if (!match.selectable) {
    return { ok: false, message: `The engine "${wanted}" is not installed on this computer, so a Bot cannot run on it. Ask the user to install it, or pick one of: ${engineList(choices)}.` }
  }
  const agent = catalog?.list().find(entry => entry.id === wanted)
  if (agent === undefined) return { ok: false, message: `There is no engine "${wanted}" any more. The engines right now are: ${engineList(choices)}.` }
  return { ok: true, engine: { kind: 'acp', command: agent.command, args: agent.args, key: agent.key }, runtimeId: agent.key }
}

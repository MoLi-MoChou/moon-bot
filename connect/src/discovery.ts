// Local agent discovery for the connect CLI (plan §接入 CLI): the same probe the
// product's ACP discovery uses — which/where over the supported CLIs — but the
// connector must find exactly one, because it launches an agent on the user's
// behalf and must not guess between two installed ones.
import { spawnSync } from 'node:child_process'

export interface AgentCandidate {
  readonly id: string
  readonly label: string
  readonly command: string
}

// Keep in step with the kind: 'acp' entries of CANDIDATES in
// core/src/engine/acp/discovery.ts. The other CLIs there are listed as
// unsupported for a reason: they have no ACP wire protocol, so bridging them
// would only forward bytes neither end understands.
export const ACP_CANDIDATES: readonly AgentCandidate[] = [
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'gemini', label: 'Gemini', command: 'gemini' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
]

export interface FoundAgent extends AgentCandidate {
  readonly path: string
}

/** What one lookup answered; spawnSync's shape without the child process. */
export interface LookupResult {
  readonly status: number | null
  readonly stdout: string
}

export type Lookup = (tool: string, args: readonly string[]) => LookupResult

const systemLookup: Lookup = (tool, args) => {
  const result = spawnSync(tool, args, { encoding: 'utf8', windowsHide: true, timeout: 2_000 })
  return { status: result.status, stdout: String(result.stdout ?? '') }
}

/** which on Unix, where.exe on Windows — the rule core's discovery uses. */
export const lookupToolFor = (platform: NodeJS.Platform): string => platform === 'win32' ? 'where.exe' : 'which'

export const firstPathOf = (result: LookupResult): string | undefined =>
  result.status === 0 ? result.stdout.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '') : undefined

export function findAgents(candidates: readonly AgentCandidate[] = ACP_CANDIDATES, lookup: Lookup = systemLookup): readonly FoundAgent[] {
  const tool = lookupToolFor(process.platform)
  return candidates.flatMap(candidate => {
    const path = firstPathOf(lookup(tool, [candidate.command]))
    return path === undefined ? [] : [{ id: candidate.id, label: candidate.label, command: candidate.command, path }]
  })
}

export type AgentPick =
  | { readonly ok: true, readonly agent: FoundAgent }
  | { readonly ok: false, readonly problem: 'none' | 'multiple', readonly found: readonly FoundAgent[] }

export function pickAgent(found: readonly FoundAgent[]): AgentPick {
  if (found.length === 1) return { ok: true, agent: found[0] as FoundAgent }
  return { ok: false, problem: found.length === 0 ? 'none' : 'multiple', found }
}

/** The error for an ambiguous or empty discovery: name what it saw, then the fix. */
export function pickFailureMessage(found: readonly FoundAgent[]): string {
  if (found.length === 0) {
    return `No local agent found (looked for: ${ACP_CANDIDATES.map(candidate => candidate.command).join(', ')}). Install one, or name the command after "--".`
  }
  const seen = found.map(agent => `${agent.label} (${agent.path})`).join(', ')
  return `More than one local agent found: ${seen}. Name the one to use after "--", for example: -- ${found[0]?.command ?? 'claude'}`
}

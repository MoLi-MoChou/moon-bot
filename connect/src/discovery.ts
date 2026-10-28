// Local agent discovery for the connect CLI (plan §接入 CLI): the same probe the
// product's ACP discovery uses — which/where over the supported CLIs, then the version
// each one reports — but the connector must find exactly one, because it launches an
// agent on the user's behalf and must not guess between two installed ones.
import { spawnSync } from 'node:child_process'

export interface AgentCandidate {
  readonly id: string
  readonly label: string
  readonly command: string
}

// Keep in step with the kind: 'acp' entries of CANDIDATES in
// core/src/engine/acp/discovery.ts. Some vendors ship a dedicated ACP binary next to
// their chat CLI (claude-agent-acp, codex-acp); both are listed, because which one works
// depends on what the machine has. The other CLIs there are marked unsupported for a
// reason: they have no ACP wire protocol, so bridging them would forward bytes neither
// end understands.
export const ACP_CANDIDATES: readonly AgentCandidate[] = [
  { id: 'claude-acp', label: 'Claude (ACP)', command: 'claude-agent-acp' },
  { id: 'claude', label: 'Claude', command: 'claude' },
  { id: 'codex-acp', label: 'Codex (ACP)', command: 'codex-acp' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'gemini', label: 'Gemini', command: 'gemini' },
]

// The same on-demand packages core offers (ON_DEMAND_CANDIDATES there): an agent that
// is not installed can still join, by naming the npx command after `--`.
export const ON_DEMAND_PACKAGES: readonly string[] = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
  'opencode',
  'pi-gemini-acp',
]

export interface FoundAgent extends AgentCandidate {
  readonly path: string
  readonly version?: string | undefined
}

/** What one lookup answered; spawnSync's shape without the child process. */
export interface LookupResult {
  readonly status: number | null
  readonly stdout: string
}

export type Lookup = (tool: string, args: readonly string[]) => LookupResult
/** The version probe, injected so the test does not need the real CLIs. */
export type VersionProbe = (path: string) => string | undefined

const trim = (value: string): string => value.replace(/\s+/gu, ' ').trim().slice(0, 120)

const systemLookup: Lookup = (tool, args) => {
  const result = spawnSync(tool, args, { encoding: 'utf8', windowsHide: true, timeout: 2_000 })
  return { status: result.status, stdout: String(result.stdout ?? '') }
}

const systemVersion: VersionProbe = path => {
  const isWinCmd = process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(path)
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 3_000,
    ...(isWinCmd ? { shell: true } : {}),
  })
  const text = trim(String(result.stdout ?? '')) || trim(String(result.stderr ?? ''))
  return text === '' ? undefined : text
}

/** which on Unix, where.exe on Windows — the rule core's discovery uses. */
export const lookupToolFor = (platform: NodeJS.Platform): string => platform === 'win32' ? 'where.exe' : 'which'

export const firstPathOf = (result: LookupResult): string | undefined =>
  result.status === 0 ? result.stdout.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '') : undefined

export function findAgents(
  candidates: readonly AgentCandidate[] = ACP_CANDIDATES,
  lookup: Lookup = systemLookup,
  versionOf: VersionProbe = systemVersion,
): readonly FoundAgent[] {
  const tool = lookupToolFor(process.platform)
  return candidates.flatMap(candidate => {
    const path = firstPathOf(lookup(tool, [candidate.command]))
    if (path === undefined) return []
    const version = versionOf(path)
    return [{ id: candidate.id, label: candidate.label, command: candidate.command, path, ...(version === undefined ? {} : { version }) }]
  })
}

export type AgentPick =
  | { readonly ok: true, readonly agent: FoundAgent }
  | { readonly ok: false, readonly problem: 'none' | 'multiple', readonly found: readonly FoundAgent[] }

export function pickAgent(found: readonly FoundAgent[]): AgentPick {
  if (found.length === 1) return { ok: true, agent: found[0] as FoundAgent }
  return { ok: false, problem: found.length === 0 ? 'none' : 'multiple', found }
}

const describe = (agent: FoundAgent): string => `${agent.label} (${agent.path}${agent.version === undefined ? '' : `, ${agent.version}`})`

/** The error for an ambiguous or empty discovery: name what it saw, then the fix. */
export function pickFailureMessage(found: readonly FoundAgent[]): string {
  if (found.length === 0) {
    const onDemand = ON_DEMAND_PACKAGES[0] as string
    return `No local agent found (looked for: ${ACP_CANDIDATES.map(candidate => candidate.command).join(', ')}). Install one, name a command after "--", or run one on demand: -- npx -y ${onDemand}`
  }
  return `More than one local agent found: ${found.map(describe).join(', ')}. Name the one to use after "--", for example: -- ${found[0]?.command ?? 'claude'}`
}

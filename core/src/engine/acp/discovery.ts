// Local ACP/runtime discovery. The product does not install agents; it finds the
// supported CLI tools already available on the machine and reports their executable
// path and version for the Bot selector.
import { spawnSync } from 'node:child_process'

export interface LocalAgent {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly args: readonly string[]
  readonly key: string
  readonly kind: 'acp' | 'unsupported'
  readonly path?: string
  readonly version?: string
  readonly reason?: string
  readonly onDemand?: boolean
}

interface Candidate {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly kind: LocalAgent['kind']
  readonly args?: readonly string[]
  readonly reason?: string
}

interface OnDemandCandidate {
  readonly id: string
  readonly label: string
  readonly npxPackage: string
}

// The ACP adapter covers these external agents. Local CLIs that are not ACP adapters
// are marked unsupported so they are not launched with the wrong wire protocol.
const CANDIDATES: readonly Candidate[] = [
  { id: 'claude-acp', label: 'Claude (ACP)', command: 'claude-agent-acp', kind: 'acp' },
  { id: 'claude', label: 'Claude', command: 'claude', kind: 'acp' },
  { id: 'codex-acp', label: 'Codex (ACP)', command: 'codex-acp', kind: 'acp' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', kind: 'acp' },
  { id: 'gemini', label: 'Gemini', command: 'gemini', kind: 'acp' },
  { id: 'codex', label: 'Codex', command: 'codex', kind: 'unsupported', reason: 'Non-ACP CLI · 原生 CLI 暂无 ACP 适配器' },
  { id: 'cursor-agent', label: 'Cursor', command: 'cursor-agent', kind: 'unsupported', reason: 'No Cursor adapter registered yet · 暂无 Cursor 适配器' },
  { id: 'grok', label: 'Grok', command: 'grok', kind: 'unsupported', reason: 'Non-ACP CLI · 原生 CLI 暂无 ACP 适配器' },
]

const ON_DEMAND_CANDIDATES: readonly OnDemandCandidate[] = [
  { id: 'ondemand:claude', label: 'Claude (npx)', npxPackage: '@agentclientprotocol/claude-agent-acp' },
  { id: 'ondemand:codex', label: 'Codex (npx)', npxPackage: '@agentclientprotocol/codex-acp' },
  { id: 'ondemand:opencode', label: 'OpenCode (npx)', npxPackage: 'opencode' },
  { id: 'ondemand:gemini', label: 'Gemini (npx)', npxPackage: 'pi-gemini-acp' },
]

const trimOutput = (value: Buffer | string | null | undefined): string => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120)

const pathOf = (command: string): string | undefined => {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], { encoding: 'utf8', windowsHide: true, timeout: 2_000 })
  if (result.status !== 0) return undefined
  const lines = String(result.stdout ?? '').split(/\r?\n/gu).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return undefined
  if (process.platform === 'win32') {
    const win = lines.find(line => /\.(?:cmd|exe|bat)$/iu.test(line))
    if (win !== undefined) return win
  }
  return lines[0]
}

const versionOf = (path: string): string | undefined => {
  const isWinCmd = process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(path)
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 3_000,
    ...(isWinCmd ? { shell: true } : {}),
  })
  const text = trimOutput(result.stdout) || trimOutput(result.stderr)
  return text === '' ? undefined : text
}

export function discoverLocalAgents(): readonly LocalAgent[] {
  const localAgents: LocalAgent[] = CANDIDATES.flatMap(candidate => {
    const path = pathOf(candidate.command)
    if (path === undefined) return []
    const version = versionOf(path)
    return [{
      id: candidate.id,
      label: candidate.label,
      command: candidate.command,
      args: candidate.args ?? [],
      key: candidate.id,
      kind: candidate.kind,
      path,
      ...(version === undefined ? {} : { version }),
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
    }]
  })

  const hasNpx = pathOf('npx') !== undefined
  const onDemandAgents: readonly LocalAgent[] = hasNpx
    ? ON_DEMAND_CANDIDATES.map(candidate => ({
        id: candidate.id,
        label: candidate.label,
        command: 'npx',
        args: ['-y', candidate.npxPackage],
        key: candidate.id,
        kind: 'acp' as const,
        version: candidate.npxPackage,
        onDemand: true,
      }))
    : []

  return [...localAgents, ...onDemandAgents]
}

export interface EngineCatalog {
  list(): readonly LocalAgent[]
}

export const localEngineCatalog: EngineCatalog = { list: discoverLocalAgents }

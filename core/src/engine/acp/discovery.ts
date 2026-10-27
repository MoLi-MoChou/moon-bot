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
}

interface Candidate {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly kind: LocalAgent['kind']
  readonly args?: readonly string[]
  readonly reason?: string
}

// The ACP adapter currently covers these external agents. The other familiar CLIs are
// intentionally visible as unsupported instead of being launched with the wrong wire
// protocol; their provider adapters can be added independently later.
const CANDIDATES: readonly Candidate[] = [
  { id: 'claude', label: 'Claude', command: 'claude', kind: 'acp' },
  { id: 'gemini', label: 'Gemini', command: 'gemini', kind: 'acp' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', kind: 'acp' },
  { id: 'codex', label: 'Codex', command: 'codex', kind: 'unsupported', reason: 'No Codex adapter is registered yet' },
  { id: 'cursor-agent', label: 'Cursor', command: 'cursor-agent', kind: 'unsupported', reason: 'No Cursor adapter is registered yet' },
  { id: 'grok', label: 'Grok', command: 'grok', kind: 'unsupported', reason: 'No Grok adapter is registered yet' },
]

const trimOutput = (value: Buffer | string | null | undefined): string => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120)

const pathOf = (command: string): string | undefined => {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], { encoding: 'utf8', windowsHide: true, timeout: 2_000 })
  if (result.status !== 0) return undefined
  return String(result.stdout ?? '').split(/\r?\n/gu).map(line => line.trim()).find(Boolean)
}

const versionOf = (path: string): string | undefined => {
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 3_000,
    ...(process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(path) ? { shell: true } : {}),
  })
  const text = trimOutput(result.stdout) || trimOutput(result.stderr)
  return text === '' ? undefined : text
}

export function discoverLocalAgents(): readonly LocalAgent[] {
  return CANDIDATES.flatMap(candidate => {
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
}

export interface EngineCatalog {
  list(): readonly LocalAgent[]
}

export const localEngineCatalog: EngineCatalog = { list: discoverLocalAgents }

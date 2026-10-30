// The memory index sync (plan §阶段 4): Markdown files stay the source of truth; this
// mirrors them into the store's FTS index, scope by scope, only when their directory
// changed since the last pass (a stat of every file, not a reread). Metadata a line
// carries rides along: `confidence: 0…1`, `until: <epoch-ms or ISO date>`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseMemory } from '../host/memory/records.ts'
import type { Store } from '../store/db.ts'
import type { IndexEntry } from '../store/memory-index.ts'

/** One scope's directory: `team`, `groups/<id>`, `bots/<id>`. */
const scopeDir = (root: string, scope: string): string =>
  scope === 'team'
    ? join(root, 'team')
    : join(root, scope.startsWith('group:') ? 'groups' : 'bots', scope.slice(scope.indexOf(':') + 1))

const numberOrUndefined = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0)
    return asNumber > 1e12 ? asNumber : Date.parse(value) > 0 ? Date.parse(value) : asNumber
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** The entries of one scope's Markdown: MEMORY.md first, then the topics by name. */
const entriesOf = (dir: string): readonly IndexEntry[] => {
  if (!existsSync(dir)) return []
  const out: IndexEntry[] = []
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .sort((left, right) =>
      left.name === 'MEMORY.md' ? -1 : right.name === 'MEMORY.md' ? 1 : left.name.localeCompare(right.name),
    )
  for (const file of files) {
    const topic = file.name === 'MEMORY.md' ? undefined : file.name.replace(/\.md$/i, '')
    const parsed = parseMemory(readIfExists(join(dir, file.name)))
    for (const entry of parsed.entries) {
      out.push({
        entryKey: `${topic !== undefined ? `${topic}/` : ''}${entry.text.slice(0, 80)}`,
        ...(topic !== undefined ? { topic } : {}),
        text: entry.text,
        ...(numberOrUndefined(entry.meta.confidence) !== undefined
          ? { confidence: Math.min(1, Math.max(0, Number(entry.meta.confidence))) }
          : {}),
        ...(numberOrUndefined(entry.meta.until) !== undefined
          ? { validUntil: numberOrUndefined(entry.meta.until) }
          : {}),
        ...(entry.meta.from !== undefined ? { source: { from: entry.meta.from } } : {}),
      })
    }
  }
  return out
}

const readIfExists = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** A signature of when a scope's directory last changed, or undefined when absent. */
const stampOf = (dir: string): number | undefined => {
  if (!existsSync(dir)) return undefined
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs)
    } catch {
      /* raced away */
    }
  }
  return newest
}

export class MemorySync {
  private readonly stamps = new Map<string, number>()

  private readonly store: Store
  private readonly root: string

  constructor(store: Store, root: string) {
    this.store = store
    this.root = root
  }

  /** Reindexes the scopes whose files changed; returns how many scopes were rebuilt. */
  syncChanged(scopes: readonly string[]): number {
    let rebuilt = 0
    for (const scope of scopes) {
      const dir = scopeDir(this.root, scope)
      const stamp = stampOf(dir)
      const known = this.stamps.get(scope)
      if (stamp === undefined) {
        if (known !== undefined) {
          this.stamps.delete(scope)
          this.store.memory.replaceAll(scope, [])
          rebuilt += 1
        }
        continue
      }
      if (known === stamp) continue
      this.store.memory.replaceAll(scope, entriesOf(dir))
      this.stamps.set(scope, stamp)
      rebuilt += 1
    }
    return rebuilt
  }

  /** Reindexes every scope the memory tree holds (the startup pass). */
  syncAll(): number {
    const scopes: string[] = ['team']
    for (const [sub, prefix] of [
      ['bots', 'bot'],
      ['groups', 'group'],
    ] as const) {
      const dir = join(this.root, sub)
      if (existsSync(dir))
        for (const entry of readdirSync(dir, { withFileTypes: true }))
          if (entry.isDirectory()) scopes.push(`${prefix}:${entry.name}`)
    }
    return this.syncChanged(scopes)
  }
}

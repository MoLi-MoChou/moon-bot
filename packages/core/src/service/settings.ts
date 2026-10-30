// The standalone settings store (plan §阶段 3): the settings sections the providers
// module reads and writes, in their own JSON file under the team home. `describe`
// answers the section shape the host's settings served; `mutate` applies set/remove
// operations on a path. One revision counter per file keeps optimistic writes honest.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsOperation, SettingsSection, SettingsService } from '../host/host-types.js'

interface SettingsFile {
  readonly version: 1
  revision: number
  readonly sections: Record<string, Record<string, unknown>>
}

const emptyFile = (): SettingsFile => ({ version: 1, revision: 0, sections: {} })

const parseFile = (text: string): SettingsFile => {
  try {
    const value = JSON.parse(text) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyFile()
    const file = value as { version?: unknown; revision?: unknown; sections?: unknown }
    if (
      file.version !== 1 ||
      typeof file.sections !== 'object' ||
      file.sections === null ||
      Array.isArray(file.sections)
    )
      return emptyFile()
    return {
      version: 1,
      revision: typeof file.revision === 'number' ? file.revision : 0,
      sections: file.sections as Record<string, Record<string, unknown>>,
    }
  } catch {
    return emptyFile()
  }
}

const setAt = (value: Record<string, unknown>, path: readonly string[], next: unknown): void => {
  let current: Record<string, unknown> = value
  for (const key of path.slice(0, -1)) {
    const step = current[key]
    if (step === null || typeof step !== 'object' || Array.isArray(step)) current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  const last = path.at(-1)
  if (last !== undefined) current[last] = next
}

const removeAt = (value: Record<string, unknown>, path: readonly string[]): void => {
  let current: Record<string, unknown> = value
  for (const key of path.slice(0, -1)) {
    const step = current[key]
    if (step === null || typeof step !== 'object' || Array.isArray(step)) return
    current = step as Record<string, unknown>
  }
  const last = path.at(-1)
  if (last !== undefined) delete current[last]
}

export class FileSettings implements SettingsService {
  private file: SettingsFile | undefined
  private readonly path: string

  constructor(home: string) {
    this.path = join(home, 'settings.json')
  }

  private load(): SettingsFile {
    if (this.file === undefined)
      this.file = existsSync(this.path) ? parseFile(readFileSync(this.path, 'utf8')) : emptyFile()
    return this.file
  }

  private flush(): void {
    const file = this.load()
    writeFileSync(`${this.path}.tmp`, JSON.stringify(file, null, 2) + '\n')
    renameSync(`${this.path}.tmp`, this.path)
  }

  describe(): readonly SettingsSection[] {
    const file = this.load()
    // Everything in this file was written through the service, so the whole value is the
    // user's layer; there is no base layer that ships with a setup. The providers module
    // reads `user` to know which routes may be removed.
    return Object.entries(file.sections).map(([ns, value]) => ({ ns, revision: file.revision, value, user: value }))
  }

  async mutate(ns: string, operations: readonly SettingsOperation[], revision?: number): Promise<unknown> {
    const file = this.load()
    if (revision !== undefined && revision !== file.revision) {
      throw Object.assign(new Error('settings changed elsewhere; read again'), { code: 'bot/stale' })
    }
    const section = (file.sections[ns] ??= {})
    for (const operation of operations) {
      if (operation.op === 'set') setAt(section, operation.path, operation.value)
      // `unset` is the name the host modules use (the host's settings vocabulary).
      else if (operation.op === 'unset' || operation.op === 'remove') removeAt(section, operation.path)
    }
    file.revision += 1
    this.flush()
    return { revision: file.revision }
  }

  /** A section's value, for the engine's model source. */
  sectionOf(ns: string): Record<string, unknown> | undefined {
    return this.load().sections[ns]
  }

  get revision(): number {
    return this.load().revision
  }
}

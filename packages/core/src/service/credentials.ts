// The standalone credentials store (plan §阶段 3): API keys in their own file under the
// team home, mode 0600, never in state.json or the store. The host-shaped
// CredentialsService surface is what the providers and secrets modules already speak.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialsService } from '../host/host-types.js'

const parse = (text: string): Record<string, string> => {
  if (text === '') return {}
  try {
    const value = JSON.parse(text) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, string> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'string') out[key] = item
    }
    return out
  } catch {
    return {}
  }
}

/** Keys are held in memory after the first read; writes go through `withFile`. */
export class FileCredentials implements CredentialsService {
  private values: Record<string, string> | undefined
  private readonly file: string

  constructor(home: string) {
    this.file = join(home, 'credentials.json')
  }

  private load(): Record<string, string> {
    if (this.values === undefined) {
      this.values = existsSync(this.file) ? parse(readFileSync(this.file, 'utf8')) : {}
    }
    return this.values
  }

  private flush(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.load(), null, 2) + '\n', { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    chmodSync(this.file, 0o600)
  }

  async describe(ref: string): Promise<{ configured?: boolean; writable?: boolean }> {
    return { configured: this.load()[ref] !== undefined, writable: true }
  }

  async set(ref: string, value: string): Promise<void> {
    this.load()[ref] = value
    this.flush()
  }

  async unset(ref: string): Promise<void> {
    delete this.load()[ref]
    this.flush()
  }

  /** The key itself, for the engine's model source. Never logged, never in state. */
  key(ref: string): string | undefined {
    return this.load()[ref]
  }
}

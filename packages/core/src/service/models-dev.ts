// Dynamic sync with models.dev (the open model capability specifications repository).
// Falls back gracefully to built-in presets if unreachable, with local cache persistence.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerDynamicModelSpec, type ModelCapability } from 'moon-bot-contracts'

const MODELS_DEV_URL = 'https://models.dev/models.json'
const SYNC_TIMEOUT_MS = 3500

interface ModelsDevModel {
  readonly id?: string
  readonly name?: string
  readonly reasoning?: boolean
  readonly modalities?: { readonly input?: readonly string[] }
  readonly limit?: { readonly context?: number; readonly output?: number }
}

export class ModelsDevSync {
  private synced = false
  private readonly cachePath: string | undefined

  constructor(home?: string) {
    if (home) {
      this.cachePath = join(home, 'models-dev-cache.json')
      this.loadCache()
    }
  }

  private loadCache(): void {
    if (!this.cachePath || !existsSync(this.cachePath)) return
    try {
      const data = JSON.parse(readFileSync(this.cachePath, 'utf8')) as Record<string, ModelCapability>
      if (data && typeof data === 'object') {
        for (const spec of Object.values(data)) {
          if (spec && typeof spec.id === 'string') registerDynamicModelSpec(spec)
        }
      }
    } catch {
      // Ignore corrupted cache
    }
  }

  /**
   * Attempts to sync with models.dev. Never throws; falls back quietly on timeout/network failure.
   */
  async sync(options: { readonly force?: boolean } = {}): Promise<boolean> {
    if (this.synced && !options.force) return false
    this.synced = true

    try {
      const response = await fetch(MODELS_DEV_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      })
      if (!response.ok) return false
      const body = (await response.json()) as Record<string, ModelsDevModel>
      if (!body || typeof body !== 'object') return false

      const toSave: Record<string, ModelCapability> = {}
      for (const [key, item] of Object.entries(body)) {
        const id = item.id || key
        const inputs = Array.isArray(item.modalities?.input) ? item.modalities.input : []
        const hasImage = inputs.includes('image')
        const spec: ModelCapability = {
          id,
          name: item.name || id,
          contextWindow: typeof item.limit?.context === 'number' ? item.limit.context : undefined,
          maxTokens: typeof item.limit?.output === 'number' ? item.limit.output : undefined,
          inputModalities: hasImage ? ['text', 'image'] : ['text'],
          reasoning: item.reasoning === true,
          reasoningEfforts: item.reasoning === true ? ['low', 'medium', 'high'] : undefined,
        }
        registerDynamicModelSpec(spec)
        toSave[spec.id] = spec
      }

      if (this.cachePath) {
        try {
          writeFileSync(this.cachePath, JSON.stringify(toSave, null, 2))
        } catch {
          // Ignore cache write errors
        }
      }
      return true
    } catch {
      return false
    }
  }
}

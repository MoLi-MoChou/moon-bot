// The standalone llm service (plan §阶段 3): what the host modules ask of the host's adapter
// — providers, their models, reasoning info, the configurable directory, endpoint
// discovery — served from the service's own settings (the `llm-pi-ai` section the
// providers module writes) and credentials, over a small directory of well-known
// endpoints. Model discovery asks the endpoint itself, OpenAI- or Anthropic-shaped.
import type { ConfigurableProvider } from '../host/host-types.js'
import { resolveModelSpec } from 'moon-bot-contracts'
import type { FileCredentials } from './credentials.ts'
import type { FileSettings } from './settings.ts'

/** A known endpoint the service can name: factual connection data, nothing more. */
interface KnownProvider {
  readonly id: string
  readonly name: string
  readonly api: 'openai-completions' | 'anthropic-messages'
  readonly baseUrl: string
  readonly models: readonly {
    readonly id: string
    readonly name?: string
    readonly reasoning?: boolean
    readonly contextWindow?: number
    readonly maxTokens?: number
    readonly inputModalities?: readonly string[]
  }[]
}

const DIRECTORY: readonly KnownProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 128000, maxTokens: 8192, inputModalities: ['text'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 128000, maxTokens: 8192, reasoning: true, inputModalities: ['text'] },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, inputModalities: ['text', 'image'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000, maxTokens: 16384, inputModalities: ['text', 'image'] },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', contextWindow: 200000, maxTokens: 64000, reasoning: true, inputModalities: ['text', 'image'] },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000, maxTokens: 8192, inputModalities: ['text', 'image'] },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 16384, reasoning: true, inputModalities: ['text', 'image'] },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', contextWindow: 200000, maxTokens: 16384, reasoning: true, inputModalities: ['text', 'image'] },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2', name: 'Kimi K2', contextWindow: 128000, maxTokens: 8192, inputModalities: ['text'] },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', contextWindow: 128000, maxTokens: 4096, inputModalities: ['text'] },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
  },
  {
    id: 'groq',
    name: 'Groq',
    api: 'openai-completions',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
  },
]

export const PI_AI_NS = 'llm-pi-ai'
export const keyRefFor = (provider: string): string => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

interface RouteProfile {
  readonly api?: unknown
  readonly baseURL?: unknown
  readonly apiKeyEnv?: unknown
  readonly displayName?: unknown
  readonly models?: readonly unknown[]
}

/** One provider route as the engine calls it. */
export interface ResolvedRoute {
  readonly provider: string
  readonly api: 'openai-completions' | 'anthropic-messages'
  readonly baseUrl: string
  readonly apiKey?: string | undefined
  readonly models: readonly {
    readonly id: string
    readonly name?: string
    readonly contextWindow?: number
    readonly maxTokens?: number
    readonly input?: readonly string[]
    readonly reasoning?: boolean
  }[]
}

interface DiscoveredModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly inputModalities?: readonly string[]
  readonly reasoning?: boolean
}

export class StandaloneLlm {
  private readonly discovered = new Map<string, { at: number; models: readonly DiscoveredModel[] }>()
  private readonly settings: FileSettings
  private readonly credentials: FileCredentials
  private readonly discoveryTtlMs: number

  constructor(settings: FileSettings, credentials: FileCredentials, options: { readonly discoveryTtlMs?: number } = {}) {
    this.settings = settings
    this.credentials = credentials
    this.discoveryTtlMs = options.discoveryTtlMs ?? 10 * 60_000
  }

  private routes(): Map<string, RouteProfile> {
    const section = this.settings.sectionOf(PI_AI_NS)
    const providers = section?.providers
    const map = new Map<string, RouteProfile>()
    if (providers !== null && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const [id, profile] of Object.entries(providers as Record<string, unknown>)) {
        if (profile !== null && typeof profile === 'object' && !Array.isArray(profile)) map.set(id, profile as RouteProfile)
      }
    }
    return map
  }

  /** The route a provider resolves to, or undefined when it is not set up. */
  resolveRoute(provider: string): ResolvedRoute | undefined {
    const profile = this.routes().get(provider)
    if (profile === undefined) return undefined
    const known = DIRECTORY.find(entry => entry.id === provider)
    const api =
      typeof profile.api === 'string' && (profile.api === 'openai-completions' || profile.api === 'anthropic-messages')
        ? profile.api
        : (known?.api ?? 'openai-completions')
    const baseUrl = typeof profile.baseURL === 'string' && profile.baseURL !== '' ? profile.baseURL : known?.baseUrl
    if (baseUrl === undefined) return undefined
    const ref = typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== '' ? profile.apiKeyEnv : keyRefFor(provider)
    const custom = Array.isArray(profile.models)
      ? profile.models.flatMap(model => {
          const view = model as { id?: unknown; name?: unknown; contextWindow?: unknown; maxTokens?: unknown; input?: unknown }
          if (typeof view?.id !== 'string' || view.id === '') return []
          const spec = resolveModelSpec(view.id)
          return [
            {
              id: view.id,
              ...(typeof view.name === 'string' ? { name: view.name } : spec.name ? { name: spec.name } : {}),
              ...(typeof view.contextWindow === 'number'
                ? { contextWindow: view.contextWindow }
                : spec.contextWindow
                  ? { contextWindow: spec.contextWindow }
                  : {}),
              ...(typeof view.maxTokens === 'number' ? { maxTokens: view.maxTokens } : spec.maxTokens ? { maxTokens: spec.maxTokens } : {}),
              ...(Array.isArray(view.input) ? { input: view.input as string[] } : spec.inputModalities ? { input: [...spec.inputModalities] } : {}),
              ...(spec.reasoning ? { reasoning: true } : {}),
            },
          ]
        })
      : []
    const defaultModels = (known?.models ?? []).map(model => {
      const spec = resolveModelSpec(model.id)
      const contextWindow = model.contextWindow ?? spec.contextWindow
      const maxTokens = model.maxTokens ?? spec.maxTokens
      const input = model.inputModalities ?? (spec.inputModalities ? [...spec.inputModalities] : undefined)
      const reasoning = model.reasoning ?? spec.reasoning
      return {
        id: model.id,
        name: model.name ?? spec.name ?? model.id,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
      }
    })
    return {
      provider,
      api,
      baseUrl,
      apiKey: this.credentials.key(ref),
      models: custom.length > 0 ? custom : defaultModels,
    }
  }

  listProviders(): readonly { id: string; name: string }[] {
    return [...this.routes().keys()].flatMap(id => {
      const route = this.resolveRoute(id)
      const name =
        typeof this.routes().get(id)?.displayName === 'string'
          ? String(this.routes().get(id)?.displayName)
          : route && DIRECTORY.find(entry => entry.id === id)?.name
      return route !== undefined ? [{ id, name: name ?? id }] : []
    })
  }

  async listModels(provider: string): Promise<readonly DiscoveredModel[]> {
    const route = this.resolveRoute(provider)
    if (route === undefined) throw new Error(`${provider} is not set up`)
    if (route.models.length > 0) {
      return route.models.map(model => {
        const spec = resolveModelSpec(model.id)
        const isReasoning =
          DIRECTORY.find(entry => entry.id === provider)?.models.find(known => known.id === model.id)?.reasoning === true || spec.reasoning === true
        const contextWindow = model.contextWindow ?? spec.contextWindow
        const maxTokens = model.maxTokens ?? spec.maxTokens
        const inputModalities = model.input ?? (spec.inputModalities ? [...spec.inputModalities] : undefined)
        return {
          ...model,
          name: model.name ?? spec.name ?? model.id,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(inputModalities !== undefined ? { inputModalities } : {}),
          ...(isReasoning ? { reasoning: true } : {}),
        }
      })
    }
    // No declared models: ask the endpoint, within the discovery cache.
    const cached = this.discovered.get(provider)
    if (cached !== undefined && Date.now() - cached.at < this.discoveryTtlMs) return cached.models
    const models = await this.discover(provider, route.baseUrl, route.api, route.apiKey)
    this.discovered.set(provider, { at: Date.now(), models })
    return models
  }

  async resolveModelInfo(
    provider: string,
    model: string,
  ): Promise<{ reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string } } | undefined> {
    const known = DIRECTORY.find(entry => entry.id === provider)?.models.find(entry => entry.id === model)
    const spec = resolveModelSpec(model)
    if (known?.reasoning === true || spec.reasoning === true) {
      const efforts = spec.reasoningEfforts?.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) })) ?? [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]
      return { reasoning: { efforts, defaultEffort: 'medium' } }
    }
    return undefined
  }

  listConfigurableProviders(): readonly ConfigurableProvider[] {
    const routes = this.routes()
    const entries: ConfigurableProvider[] = DIRECTORY.map(known => ({
      provider: known.id,
      displayName: known.name,
      settingsNs: PI_AI_NS,
      settingsPath: ['providers', known.id],
      ...(routes.has(known.id) ? { declared: true } : {}),
    }))
    for (const id of routes.keys()) {
      if (DIRECTORY.some(known => known.id === id)) continue
      entries.push({ provider: id, displayName: id, settingsNs: PI_AI_NS, settingsPath: ['providers', id] })
    }
    return entries
  }

  /** Asks an endpoint for its models: OpenAI's /models, or Anthropic's. */
  async discoverModels(
    _adapter: string,
    request: { baseURL?: unknown; api?: unknown; key?: unknown; apiKey?: unknown; provider?: unknown },
  ): Promise<readonly DiscoveredModel[]> {
    if (typeof request.provider === 'string' && request.provider !== '') {
      const route = this.resolveRoute(request.provider)
      if (route === undefined) throw new Error(`${request.provider} is not set up`)
      return this.discover(request.provider, route.baseUrl, route.api, request.key !== undefined ? String(request.key) : route.apiKey)
    }
    const baseUrl =
      typeof request.baseURL === 'string'
        ? request.baseURL
            .trim()
            .replace(/\/chat\/completions\/?$/i, '')
            .replace(/\/+$/, '')
        : ''
    if (baseUrl === '') throw new Error('an endpoint address is required')
    const api = request.api === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions'
    const key =
      typeof request.key === 'string' && request.key !== ''
        ? request.key
        : typeof request.apiKey === 'string' && request.apiKey !== ''
          ? request.apiKey
          : undefined
    return this.discover(`${baseUrl}|${api}`, baseUrl, api, key)
  }

  private async discover(
    _cacheId: string,
    baseUrl: string,
    api: 'openai-completions' | 'anthropic-messages',
    key?: string,
  ): Promise<readonly DiscoveredModel[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (key !== undefined && key !== '') {
      if (api === 'anthropic-messages') {
        headers['x-api-key'] = key
        headers['anthropic-version'] = '2023-06-01'
      } else headers.authorization = `Bearer ${key}`
    }
    const url = api === 'anthropic-messages' ? `${baseUrl}/v1/models` : `${baseUrl}/models`
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`the endpoint answered HTTP ${response.status}`)
    const body = JSON.parse(await response.text()) as { data?: unknown } | { models?: unknown }
    const rows = Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: readonly unknown[] }).data
      : Array.isArray((body as { models?: unknown }).models)
        ? (body as { models: readonly unknown[] }).models
        : []
    return rows.flatMap(row => {
      const view = row as { id?: unknown; display_name?: unknown; name?: unknown; context_length?: unknown; max_tokens?: unknown }
      if (typeof view?.id !== 'string' || view.id === '') return []
      const id = view.id
      const spec = resolveModelSpec(id)
      const contextWindow = typeof view.context_length === 'number' ? view.context_length : spec.contextWindow
      const maxTokens = typeof view.max_tokens === 'number' ? view.max_tokens : spec.maxTokens
      const name = typeof (view.display_name ?? view.name) === 'string' ? String(view.display_name ?? view.name) : (spec.name ?? id)
      return [
        {
          id,
          name,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(spec.inputModalities ? { inputModalities: spec.inputModalities } : {}),
          ...(spec.reasoning ? { reasoning: spec.reasoning } : {}),
        },
      ]
    })
  }
}

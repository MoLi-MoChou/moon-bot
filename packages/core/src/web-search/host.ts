// Host wiring: read the asking Session's route through public the host services only.
import type { Route } from './native.ts'
import { createAutoSearchProvider, type AutoSearchProvider, type WebPage } from './provider.ts'
import { isRecord, str } from './source.ts'

/** The host plugin context, structurally: the services and seams this wiring reads. */
export interface HostContext {
  get(name: string): unknown
  readonly web: {
    registerSearchProvider(provider: AutoSearchProvider): void
    fetch(request: { readonly url: string }, signal?: AbortSignal): Promise<WebPage>
  }
}

/** Narrows an unknown service member to a callable, so an absent service reads as absent. */
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function'

const fieldOf = (record: unknown, key: string): unknown => (isRecord(record) ? record[key] : undefined)

// Routes whose profile leaves protocol, endpoint, or key name to the adapter: the host's DeepSeek
// adapters, and the pi-ai 0.87.1 catalog routes that sign in with an API key
// (models.generated.js, env-api-keys.js). The protocol is undefined where it differs per model.
type CatalogEntry = readonly [protocol: string | undefined, base: string, keyName: string | undefined]
const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'deepseek-official': ['anthropic-messages', 'https://api.deepseek.com/anthropic', 'DEEPSEEK_API_KEY'],
  'deepseek-account': ['anthropic-messages', 'https://api.deepseek.com/anthropic', undefined],
  'ant-ling': ['openai-completions', 'https://api.ant-ling.com/v1', 'ANT_LING_API_KEY'],
  anthropic: ['anthropic-messages', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY'],
  baseten: ['openai-completions', 'https://inference.baseten.co/v1', 'BASETEN_API_KEY'],
  cerebras: ['openai-completions', 'https://api.cerebras.ai/v1', 'CEREBRAS_API_KEY'],
  deepseek: ['openai-completions', 'https://api.deepseek.com', 'DEEPSEEK_API_KEY'],
  fireworks: [undefined, 'https://api.fireworks.ai/inference/v1', 'FIREWORKS_API_KEY'],
  google: ['google-generative-ai', 'https://generativelanguage.googleapis.com/v1beta', 'GEMINI_API_KEY'],
  groq: ['openai-completions', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY'],
  huggingface: ['openai-completions', 'https://router.huggingface.co/v1', 'HF_TOKEN'],
  'kimi-coding': ['anthropic-messages', 'https://api.kimi.com/coding', 'KIMI_API_KEY'],
  meta: ['openai-responses', 'https://api.meta.ai/v1', 'META_API_KEY'],
  minimax: ['anthropic-messages', 'https://api.minimax.io/anthropic', 'MINIMAX_API_KEY'],
  'minimax-cn': ['anthropic-messages', 'https://api.minimaxi.com/anthropic', 'MINIMAX_CN_API_KEY'],
  moonshotai: ['openai-completions', 'https://api.moonshot.ai/v1', 'MOONSHOT_API_KEY'],
  'moonshotai-cn': ['openai-completions', 'https://api.moonshot.cn/v1', 'MOONSHOT_API_KEY'],
  nvidia: ['openai-completions', 'https://integrate.api.nvidia.com/v1', 'NVIDIA_API_KEY'],
  openai: ['openai-responses', 'https://api.openai.com/v1', 'OPENAI_API_KEY'],
  opencode: [undefined, 'https://opencode.ai/zen/v1', 'OPENCODE_API_KEY'],
  'opencode-go': [undefined, 'https://opencode.ai/zen/go/v1', 'OPENCODE_API_KEY'],
  openrouter: [undefined, 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY'],
  'qwen-token-plan': [
    'openai-completions',
    'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    'QWEN_TOKEN_PLAN_API_KEY',
  ],
  'qwen-token-plan-cn': [
    'openai-completions',
    'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    'QWEN_TOKEN_PLAN_CN_API_KEY',
  ],
  'qwen-token-plan-individual': [
    'openai-completions',
    'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    'QWEN_TOKEN_PLAN_API_KEY',
  ],
  together: ['openai-completions', 'https://api.together.ai/v1', 'TOGETHER_API_KEY'],
  'vercel-ai-gateway': ['anthropic-messages', 'https://ai-gateway.vercel.sh', 'AI_GATEWAY_API_KEY'],
  xai: ['openai-responses', 'https://api.x.ai/v1', 'XAI_API_KEY'],
  xiaomi: ['openai-completions', 'https://api.xiaomimimo.com/v1', 'XIAOMI_API_KEY'],
  'xiaomi-token-plan-ams': [
    'openai-completions',
    'https://token-plan-ams.xiaomimimo.com/v1',
    'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  ],
  'xiaomi-token-plan-cn': [
    'openai-completions',
    'https://token-plan-cn.xiaomimimo.com/v1',
    'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  ],
  'xiaomi-token-plan-sgp': [
    'openai-completions',
    'https://token-plan-sgp.xiaomimimo.com/v1',
    'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  ],
  zai: ['openai-completions', 'https://api.z.ai/api/coding/paas/v4', 'ZAI_API_KEY'],
  'zai-coding-cn': ['openai-completions', 'https://open.bigmodel.cn/api/coding/paas/v4', 'ZAI_CODING_CN_API_KEY'],
}
const DEEPSEEK_ROUTES = new Set(['deepseek-official', 'deepseek-account'])

const stringRecord = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : {}

// OpenCode's gateways turn away a request that does not name its conversation. the host's
// adapter names it by the Session id, so a search for that Session does the same,
// unless the provider settings name one.
const OPENCODE_SESSION = 'x-opencode-session'
const OPENCODE_ROUTES = new Set(['opencode', 'opencode-go'])
const withConversation = (
  provider: string,
  headers: Readonly<Record<string, string>>,
  sessionId: string | undefined,
): Readonly<Record<string, string>> =>
  !OPENCODE_ROUTES.has(provider) ||
  sessionId === undefined ||
  Object.keys(headers).some(name => name.toLowerCase() === OPENCODE_SESSION)
    ? headers
    : { ...headers, [OPENCODE_SESSION]: sessionId }

/** The route of the Session that started the current tool call: protocol, endpoint, key name, and headers. */
export function routeOf(ctx: HostContext): Route | undefined {
  const agents = ctx.get('agents')
  const initiator = isRecord(agents) && isFunction(agents.currentInitiator) ? agents.currentInitiator() : undefined
  const session = isRecord(initiator) ? initiator.session : undefined
  const requestContext = isRecord(session) && isFunction(session.requestContext) ? session.requestContext : undefined
  const request = requestContext === undefined ? undefined : requestContext()
  const provider = str(fieldOf(request, 'provider'))
  if (provider === undefined) return undefined
  let section: unknown
  try {
    const llm = ctx.get('llm')
    if (isRecord(llm) && isFunction(llm.listConfigurableProviders)) {
      const entries = llm.listConfigurableProviders()
      const entry = Array.isArray(entries)
        ? entries.find(item => isRecord(item) && item.provider === provider)
        : undefined
      if (isRecord(entry)) {
        const settings = ctx.get('settings')
        const described = isRecord(settings) && isFunction(settings.describe) ? settings.describe() : undefined
        const descriptor = Array.isArray(described)
          ? described.find(item => isRecord(item) && item.ns === entry.settingsNs)
          : undefined
        const path = Array.isArray(entry.settingsPath) ? (entry.settingsPath as readonly (string | number)[]) : []
        section = path.reduce<unknown>(
          (value, key) => (isRecord(value) ? value[key] : undefined),
          fieldOf(descriptor, 'value'),
        )
      }
    }
  } catch {
    section = undefined
  }
  const [catalogApi, catalogBase, catalogKey] = CATALOG[provider] ?? []
  const account = provider === 'deepseek-account'
  return {
    provider,
    model: str(fieldOf(request, 'model')),
    api: str(fieldOf(section, 'api')) ?? catalogApi,
    baseURL:
      str(fieldOf(section, 'baseURL')) ??
      (DEEPSEEK_ROUTES.has(provider) ? str(envOf(ctx)('DEEPSEEK_BASE_URL')) : undefined) ??
      catalogBase,
    apiKeyEnv: account ? undefined : (str(fieldOf(section, 'apiKeyEnv')) ?? catalogKey),
    account,
    headers: withConversation(provider, stringRecord(fieldOf(section, 'headers')), str(fieldOf(session, 'id'))),
  }
}

const envOf = (ctx: HostContext): ((name: string) => string | undefined) => {
  const read = (name: string): string | undefined => {
    const service = ctx.get('launchEnvironment')
    const got = isRecord(service) && isFunction(service.get) ? service.get(name) : undefined
    const value = isRecord(got) ? got.value : undefined
    return (typeof value === 'string' ? value : undefined) ?? process.env[name]
  }
  return read
}

export function apply(ctx: HostContext, config: unknown = {}): void {
  const env = envOf(ctx)
  ctx.web.registerSearchProvider(
    createAutoSearchProvider(
      {
        route: () => routeOf(ctx),
        resolveKey: async ref => {
          const credentials = ctx.get('credentials')
          // Without the seam the environment is the whole credential plane, as in the host's own adapters.
          if (credentials === undefined) return env(ref)
          const resolved =
            isRecord(credentials) && isFunction(credentials.resolve) ? await credentials.resolve(ref) : undefined
          return isRecord(resolved) && typeof resolved.value === 'string' ? resolved.value : undefined
        },
        resolveAccountToken: async endpoint => {
          const service = ctx.get('deepseekAccount')
          return str(
            isRecord(service) && isFunction(service.resolveToken) ? await service.resolveToken(endpoint) : undefined,
          )
        },
        fetch: (url, init) => fetch(url, init),
        webFetch: (request, signal) => ctx.web.fetch(request, signal),
      },
      config,
    ),
  )
}

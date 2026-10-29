// Native search: what to try for one route. Nothing here names a vendor except SEARCH_APIS,
// which is data in the same shape as `searchApis` config.
import { clamp, httpUrl, isRecord, str, trimSlash } from './source.ts'
import { readDeclared, readGemini, readMessages, readResponses, type ReadOutcome } from './readers.ts'

/** The asking Session's model route, as the host wiring reads it and the provider plans around. */
export interface Route {
  readonly provider: string
  readonly model: string | undefined
  readonly api: string | undefined
  readonly baseURL: string | undefined
  readonly apiKeyEnv: string | undefined
  readonly account: boolean
  readonly headers: Readonly<Record<string, string>>
}

/** What one candidate needs to build its request for one query. */
export interface SearchCall {
  readonly model?: string
  readonly query: string
  /** From the search request; each candidate clamps it its own way. */
  readonly maxResults: number | undefined
}

/** One candidate's HTTP request: headers and a JSON-ready body. */
export interface PreparedRequest {
  readonly headers?: Record<string, string>
  readonly body: unknown
}

/** How a candidate reads the JSON body its endpoint answered with. */
export type BodyReader = (body: unknown) => ReadOutcome

const PROMPT = (query: string): string => `Perform a web search for the query: ${query}`

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` })
export type AuthStyle = 'bearer' | 'x-api-key' | 'api-key'
export const AUTH_STYLES: Readonly<Record<AuthStyle, (key: string) => Record<string, string>>> = {
  bearer,
  'x-api-key': key => ({ 'x-api-key': key }),
  'api-key': key => ({ 'api-key': key }),
}
// One trailing /v1 belongs to the root, as in the host's DeepSeek adapter and pi-ai's model listing.
const messagesRoot = (base: string): string =>
  (new URL(base).pathname.replace(/\/+$/, '').endsWith('/v1') ? trimSlash(base) : `${trimSlash(base)}/v1`)

// Bounds what an endpoint that ignores the search tool can cost, while leaving a thinking model
// room to reach the search: the host's own DeepSeek search uses the same cap.
const OUTPUT_CAP = 4096

/** The standard search tool of one wire protocol. */
export interface ProtocolSearch {
  readonly name: string
  readonly url: (base: string, model: string) => string
  readonly auth: (key: string) => Record<string, string>
  readonly request: (call: SearchCall) => PreparedRequest
  readonly read: BodyReader
}

/** The standard search tool of each wire protocol. */
export const PROTOCOL_SEARCHES = {
  messages: {
    name: 'Anthropic Messages web_search tool',
    url: base => `${messagesRoot(base)}/messages`,
    // Anthropic reads x-api-key; compatible gateways often read Bearer.
    auth: key => ({ 'x-api-key': key, ...bearer(key) }),
    request: ({ model, query }) => ({
      headers: { 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: OUTPUT_CAP,
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT(query) }] }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      },
    }),
    read: readMessages,
  },
  responses: {
    name: 'OpenAI Responses web_search tool',
    url: base => `${trimSlash(base)}/responses`,
    auth: bearer,
    request: ({ model, query }) => ({ body: { model, input: PROMPT(query), tools: [{ type: 'web_search' }], max_output_tokens: OUTPUT_CAP } }),
    read: readResponses,
  },
  gemini: {
    name: 'Gemini google_search tool',
    url: (base, model) => `${trimSlash(base)}/models/${encodeURIComponent(model)}:generateContent`,
    auth: key => ({ 'x-goog-api-key': key }),
    request: ({ query }) => ({
      body: { contents: [{ role: 'user', parts: [{ text: PROMPT(query) }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: OUTPUT_CAP } },
    }),
    read: readGemini,
  },
} satisfies Readonly<Record<string, ProtocolSearch>>
export type ProtocolId = keyof typeof PROTOCOL_SEARCHES

const BY_PROTOCOL: Readonly<Record<string, readonly ProtocolId[]>> = {
  'anthropic-messages': ['messages'],
  'openai-responses': ['responses'],
  // Many OpenAI-compatible servers also serve Responses and Messages under the same base.
  'openai-completions': ['responses', 'messages'],
  'google-generative-ai': ['gemini'],
}
const UNKNOWN_PROTOCOL: readonly ProtocolId[] = ['responses', 'messages']

/** A search API a host serves beside its model protocol, as `searchApis` config declares them. */
export interface SearchApi {
  readonly id: string
  readonly name?: string
  readonly hosts: readonly string[]
  readonly path: string
  readonly auth?: readonly AuthStyle[]
  readonly maxResults?: number
  readonly maxQueryChars?: number
  readonly body: Record<string, unknown>
}

/**
 * Search APIs a host serves beside its model protocol. No standard advertises these, so they
 * are declared; `searchApis` in config adds more in the same shape. `$query`, `$model`, and
 * `$maxResults` in a body are replaced per call. Each path is joined to the route's own origin.
 */
export const SEARCH_APIS: readonly SearchApi[] = Object.freeze([
  // docs.ollama.com/capabilities/web-search
  { id: 'ollama', name: 'Ollama web search API', hosts: ['ollama.com'], path: '/api/web_search', maxResults: 10, body: { query: '$query', max_results: '$maxResults' } },
  // platform.kimi.ai; an empty result is not billed.
  { id: 'kimi', name: 'Kimi search API', hosts: ['api.moonshot.ai', 'api.moonshot.cn'], path: '/v1/tools/search', maxResults: 20, body: { text_query: '$query', limit: '$maxResults', timeout_seconds: 30 } },
  // docs.bigmodel.cn; the API rejects queries over 70 characters.
  { id: 'zhipu', name: 'Zhipu web search API', hosts: ['open.bigmodel.cn', 'api.z.ai'], path: '/api/paas/v4/web_search', maxResults: 50, maxQueryChars: 70, body: { search_query: '$query', search_engine: 'search_std', count: '$maxResults' } },
  // MiMo searches only through this Chat Completions plugin tool, once the Web Search plugin is
  // enabled for the key. Each keyword is one billed search, so one keyword per query; the answer
  // text is discarded, so it stays short and without thinking.
  {
    id: 'mimo', name: 'MiMo web_search plugin', hosts: ['xiaomimimo.com', '*.xiaomimimo.com'], path: '/v1/chat/completions', auth: ['bearer', 'api-key'], maxResults: 5,
    body: {
      model: '$model',
      messages: [{ role: 'user', content: '$query' }],
      tools: [{ type: 'web_search', force_search: true, max_keyword: 1, limit: '$maxResults' }],
      max_completion_tokens: 256,
      thinking: { type: 'disabled' },
      stream: false,
    },
  },
])

const hostMatches = (patterns: readonly string[], host: string): boolean =>
  patterns.some(pattern => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern.toLowerCase()))
const fill = (template: unknown, values: Readonly<Record<string, unknown>>): unknown => {
  if (Array.isArray(template)) return template.map(item => fill(item, values))
  if (isRecord(template)) return Object.fromEntries(Object.entries(template).map(([key, value]): [string, unknown] => [key, fill(value, values)]))
  return typeof template === 'string' && Object.hasOwn(values, template) ? values[template] : template
}

const usesModel = (api: SearchApi): boolean => JSON.stringify(api.body).includes('"$model"')

/** One thing worth trying for one query: how to call it, and how to read the answer. */
export interface Candidate {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly model?: string
  /** A protocol's standard tool on a host that declares none: a guess, with a short budget. */
  readonly guessed?: boolean
  readonly auth: (key: string) => Record<string, string>
  readonly request: (call: Omit<SearchCall, 'model'>) => PreparedRequest
  readonly read: BodyReader
}

function declaredCandidate(api: SearchApi, origin: string, model: string | undefined): Candidate | undefined {
  const url = `${origin}${api.path}`
  // A path such as `//other.example` must not move the key to another origin.
  if (new URL(url).origin !== origin) return undefined
  const styles = (api.auth ?? ['bearer']).map(style => AUTH_STYLES[style])
  return {
    id: api.id,
    name: api.name ?? `${api.id} search API`,
    url,
    ...(usesModel(api) && model !== undefined ? { model } : {}),
    auth: key => Object.assign({}, ...styles.map(style => style(key))),
    request: ({ query, maxResults }) => ({
      body: fill(api.body, {
        $query: api.maxQueryChars === undefined ? query : [...query].slice(0, api.maxQueryChars).join(''),
        $model: model,
        $maxResults: clamp(maxResults ?? 8, 1, api.maxResults ?? 10),
      }),
    }),
    read: readDeclared,
  }
}

function protocolCandidate(id: ProtocolId, base: string, model: string): Candidate {
  const shape = PROTOCOL_SEARCHES[id]
  return { id, guessed: true, name: shape.name, url: shape.url(base, model), model, auth: shape.auth, request: call => shape.request({ ...call, model }), read: shape.read }
}

/**
 * Everything worth trying for one route, cheapest first: search APIs declared for its host
 * (no model call), then the standard search tool of its protocol.
 * @returns `{ candidates }`, with `reason` when there is nothing to try.
 */
export function planNative(route: Route, searchApis: readonly SearchApi[] = SEARCH_APIS): { readonly candidates: readonly Candidate[]; readonly reason?: string } {
  const base = httpUrl(route.baseURL)
  if (base === undefined) return { candidates: [], reason: `route "${route.provider}" has no known endpoint` }
  const url = new URL(base)
  const model = str(route.model)
  const candidates: Candidate[] = []
  for (const api of searchApis) {
    if (!hostMatches(api.hosts, url.hostname)) continue
    if (model === undefined && usesModel(api)) continue
    const candidate = declaredCandidate(api, url.origin, model)
    if (candidate !== undefined) candidates.push(candidate)
  }
  const shapes = route.api === undefined ? UNKNOWN_PROTOCOL : BY_PROTOCOL[route.api] ?? []
  if (model !== undefined) for (const id of shapes) candidates.push(protocolCandidate(id, base, model))
  if (candidates.length > 0) return { candidates }
  return {
    candidates,
    reason: model === undefined && shapes.length > 0
      ? `route "${route.provider}" has no current model to search with`
      : `route "${route.provider}" speaks ${route.api}, which has no standard search tool, and ${url.host} declares no search API`,
  }
}

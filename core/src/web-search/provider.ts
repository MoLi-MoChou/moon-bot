import { resolveConfig } from './config.ts'
import { ENGINES, type Engine } from './engines.ts'
import { planNative, type Candidate, type Route } from './native.ts'
import { clip, isRecord, reasonOf, seconds, str, type Source } from './source.ts'

// The `auto` search provider over injected effects, so tests run it without a host.

/** The web seam's error, as the callers read it: a name and a code. */
export class WebError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'WebError'
    this.code = code
  }
}

export const AUTO_PROVIDER_ID = 'auto'

const USER_AGENT = 'moon-bot/0.1.0'

const MINUTE = 60_000
/** What one native attempt concluded about its endpoint, driving how long to skip it. */
type SkipOutcome = 'absent' | 'rejected' | 'denied' | 'ignored' | 'slow'
// How long one outcome keeps a candidate from being tried again.
const SKIP_FOR: Readonly<Record<SkipOutcome, number>> = {
  absent: 24 * 60 * MINUTE,
  // The query itself may be what was refused (length, content moderation).
  rejected: 30 * MINUTE,
  // The user may enable search for the key right away.
  denied: 30 * MINUTE,
  // Each retry of an endpoint that answers without searching costs a model call.
  ignored: 6 * 60 * MINUTE,
  // A guessed endpoint that hung: likely it does not search, so the fallback goes first.
  slow: 60 * MINUTE,
}
const STATUS_OUTCOMES: Readonly<Record<number, SkipOutcome>> = { 404: 'absent', 405: 'absent', 501: 'absent', 400: 'rejected', 415: 'rejected', 422: 'rejected', 401: 'denied', 402: 'denied', 403: 'denied' }

const aborted = (signal: AbortSignal | undefined): WebError => new WebError('web search aborted', 'WEB_ABORTED', { cause: signal?.reason })

// AbortSignal.timeout's wait is unref'd, so under Node 22's test runner a pending subtest
// is cancelled as soon as nothing ref'd holds the loop — and a mocked fetch holds nothing.
// A plain setTimeout keeps the loop honest; the abort reason stays a TimeoutError.
const timeoutAfter = (ms: number): { timeout: AbortController; timer: ReturnType<typeof setTimeout> } => {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
  return { timeout, timer }
}

const errorDetail = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text)
    const error = isRecord(parsed) ? parsed.error : undefined
    if (typeof error === 'string') return str(error) ?? ''
    return str(isRecord(error) ? error.message : undefined)
      ?? str(isRecord(parsed) ? parsed.message : undefined)
      ?? str(isRecord(parsed) ? parsed.msg : undefined)
      ?? ''
  } catch { return '' }
}

/** One page as `ctx.web.fetch` answers it, structurally. */
export interface WebPage {
  readonly statusCode: number
  readonly body?: { readonly content?: string }
}

/** What a search asks for; `maxResults` is a wish every path clamps its own way. */
export interface SearchRequest {
  readonly query: string
  readonly maxResults?: number
}

/** What every path answers: sources, and a note the model can cite. */
export interface SearchResult {
  readonly content: string
  readonly sources: readonly Source[]
  readonly truncated: boolean
}

/** The provider this module registers over the web seam. */
export interface AutoSearchProvider {
  readonly id: string
  available(): boolean
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>
}

/**
 * The effects `createAutoSearchProvider` runs on.
 * @property route - the asking Session's route: `{ provider, model, api, baseURL, apiKeyEnv, account, headers }`.
 * @property resolveKey - credential reference → key, or undefined.
 * @property resolveAccountToken - endpoint → DeepSeek account token, or undefined.
 * @property fetch - the HTTP client for native searches.
 * @property webFetch - `ctx.web.fetch`.
 */
export interface ProviderDeps {
  route(): Route | undefined
  resolveKey(ref: string): Promise<string | undefined>
  resolveAccountToken?(endpoint: string): Promise<string | undefined>
  fetch(url: string, init: RequestInit): Promise<Response>
  webFetch(request: { readonly url: string }, signal?: AbortSignal): Promise<WebPage>
  now?(): number
}

/** How a native attempt proves itself: a header builder and its label, or why it cannot. */
interface Credential {
  readonly headers?: (candidate: Candidate) => Record<string, string>
  readonly via?: string
  readonly reason?: string
}

/** What this process remembers about one endpoint on one route. */
interface EndpointMemory {
  readonly works?: boolean
  readonly until?: number
  readonly reason?: string
}

/** One native attempt: its sources, or why it answered nothing. */
type AttemptOutcome = { readonly sources: readonly Source[] } | {
  readonly reason: string
  readonly skip: SkipOutcome | undefined
  readonly timedOut: boolean
  readonly final: boolean
}

/** Native search over the asking route: a result, or why it could not run. */
type NativeRun = { readonly reason: string } | { readonly result: SearchResult }

/** The keyless fallback: a result, or one note per engine attempt. */
type FallbackRun = { readonly attempts: readonly string[] } | { readonly result: { readonly engine: Engine; readonly at: string; readonly sources: readonly Source[] } }

export function createAutoSearchProvider(deps: ProviderDeps, config: unknown = {}): AutoSearchProvider {
  const options = resolveConfig(config)
  const now = deps.now ?? Date.now
  // route + endpoint + model → `{ works: true }` or `{ until, reason }`, for this process.
  const memory = new Map<string, EndpointMemory>()

  async function credentialFor(route: Route, endpoint: string): Promise<Credential> {
    if (route.account) {
      let token: string | undefined
      try { token = str(await deps.resolveAccountToken?.(endpoint)) } catch (error) { return { reason: `the DeepSeek account token could not be read: ${reasonOf(error)}` } }
      if (token === undefined) return { reason: 'it is not signed in to a DeepSeek account' }
      const authToken = token
      return { headers: () => ({ 'x-dsh-auth-token': authToken }), via: 'the DeepSeek account sign-in' }
    }
    if (route.apiKeyEnv === undefined) return { reason: 'it names no API key' }
    const apiKeyEnv = route.apiKeyEnv
    let key: string | undefined
    try { key = str(await deps.resolveKey(apiKeyEnv)) } catch (error) { return { reason: `the key ${apiKeyEnv} could not be read: ${reasonOf(error)}` } }
    if (key === undefined) return { reason: `no API key is stored for ${apiKeyEnv}` }
    const stored = key
    return { headers: candidate => candidate.auth(stored), via: `the API key ${apiKeyEnv}` }
  }

  async function attempt(candidate: Candidate, route: Route, credential: Credential, request: SearchRequest, signal: AbortSignal | undefined, budget: number, known: boolean): Promise<AttemptOutcome> {
    const call = candidate.request({ query: request.query, maxResults: request.maxResults })
    const { timeout, timer } = timeoutAfter(budget)
    let response: Response
    let text: string
    try {
      response = await deps.fetch(candidate.url, {
        method: 'POST',
        // Credential-bearing requests never follow redirects.
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT, ...route.headers, ...call.headers, ...credential.headers?.(candidate) },
        body: JSON.stringify(call.body),
        signal: signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]),
      })
      text = await response.text()
    } catch (error) {
      if (signal?.aborted) throw aborted(signal)
      return timeout.signal.aborted
        ? { reason: `timed out after ${seconds(budget)}`, skip: undefined, timedOut: true, final: false }
        : { reason: `request failed: ${reasonOf(error)}`, skip: undefined, timedOut: false, final: false }
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const detail = errorDetail(text)
      return { reason: `HTTP ${response.status}${detail !== '' ? `: ${clip(detail, 200)}` : ''}`, skip: STATUS_OUTCOMES[response.status], timedOut: false, final: false }
    }
    let body: unknown
    try { body = JSON.parse(text) } catch { return { reason: 'answered with a body that is not JSON', skip: 'ignored', timedOut: false, final: false } }
    const read = candidate.read(body)
    if (read.sources.length > 0) return { sources: read.sources }
    if (read.error !== undefined) return { reason: read.error, skip: undefined, timedOut: false, final: true }
    if (read.ran || known) return { reason: 'returned no results', skip: undefined, timedOut: false, final: true }
    // The cap says nothing about support, so a cut-off answer is not remembered.
    if (read.cut) return { reason: 'stopped at the output cap before searching', skip: undefined, timedOut: false, final: false }
    return { reason: 'answered without running a search, so it does not seem to support this one', skip: 'ignored', timedOut: false, final: false }
  }

  async function runNative(request: SearchRequest, signal: AbortSignal | undefined): Promise<NativeRun> {
    if (!options.native) return { reason: 'native search is turned off (web-search-auto native: false)' }
    let read: Route | undefined
    try { read = deps.route() } catch (error) { return { reason: `the conversation's model route could not be read: ${reasonOf(error)}` } }
    if (read === undefined) return { reason: 'no conversation model route is known for this search' }
    const route = read
    const plan = planNative(route, options.searchApis)
    if (plan.candidates.length === 0) return { reason: plan.reason ?? '' }
    const keyOf = (candidate: Candidate): string => [route.provider, candidate.url, candidate.model ?? ''].join('\n')
    const works = (candidate: Candidate): boolean => memory.get(keyOf(candidate))?.works === true
    const ordered = [...plan.candidates.filter(works), ...plan.candidates.filter(candidate => !works(candidate))]
    let deadline = now() + options.nativeTimeoutMs
    const notes: string[] = []
    let credential: Credential | undefined
    for (const candidate of ordered) {
      const where = `${candidate.name} (${new URL(candidate.url).host}${new URL(candidate.url).pathname})`
      const memo = memory.get(keyOf(candidate))
      if (memo?.until !== undefined && memo.until > now()) {
        notes.push(`${where}: ${memo.reason}; not retried for ${Math.ceil((memo.until - now()) / MINUTE)} min`)
        continue
      }
      credential ??= await credentialFor(route, candidate.url)
      if (signal?.aborted) throw aborted(signal)
      if (credential.reason !== undefined) return { reason: `route "${route.provider}" could not search natively: ${credential.reason}` }
      const left = deadline - now()
      if (left <= 0) { notes.push(`${where}: skipped, out of time`); continue }
      const guess = candidate.guessed === true && memo?.works !== true
      const remaining = guess ? Math.min(left, options.guessTimeoutMs) : left
      const outcome = await attempt(candidate, route, credential, request, signal, remaining, memo?.works === true)
      if ('sources' in outcome) {
        memory.set(keyOf(candidate), { works: true })
        return {
          result: {
            content: `Search backend: native search of this conversation's model route "${route.provider}": ${where}, billed to ${credential.via}.`,
            sources: outcome.sources,
            truncated: false,
          },
        }
      }
      notes.push(`${where}: ${outcome.reason}`)
      if (outcome.skip !== undefined) memory.set(keyOf(candidate), { until: now() + SKIP_FOR[outcome.skip], reason: outcome.reason })
      if (outcome.final) break
      if (outcome.timedOut && guess) { memory.set(keyOf(candidate), { until: now() + SKIP_FOR.slow, reason: outcome.reason }); continue }
      // A timed-out attempt had all the time that was left, but the timer and now() use
      // different clocks, so now() can still read a millisecond before the deadline.
      if (outcome.timedOut) deadline = now()
    }
    return { reason: `route "${route.provider}": ${notes.join('; ')}` }
  }

  async function fetchPage(engine: Engine, url: string, signal: AbortSignal | undefined): Promise<{ page: WebPage; url: string }> {
    try {
      return { page: await deps.webFetch({ url }, signal), url }
    } catch (error) {
      // The fetch provider refuses cross-origin redirects and names the target; follow one hop
      // when it is the engine's own regional host.
      const code = isRecord(error) ? error.code : undefined
      const message = isRecord(error) ? error.message : undefined
      const origin = code === 'WEB_REDIRECT_BLOCKED' ? /https?:\/\/[a-z0-9.-]+(:\d+)?/i.exec(String(message ?? ''))?.[0] : undefined
      if (origin === undefined || engine.regional?.test(origin) !== true || origin === new URL(url).origin) throw error
      const { pathname, search } = new URL(url)
      const regional = `${origin}${pathname}${search}`
      return { page: await deps.webFetch({ url: regional }, signal), url: regional }
    }
  }

  async function runFallback(request: SearchRequest, signal: AbortSignal | undefined): Promise<FallbackRun> {
    const attempts: string[] = []
    let empty: { engine: Engine; at: string } | undefined
    const deadline = now() + options.fallbackTimeoutMs
    for (const [index, id] of options.engines.entries()) {
      const engine = ENGINES[id]
      const url = engine.url(request.query)
      const host = new URL(url).host
      const remaining = deadline - now()
      if (remaining <= 0) { attempts.push(`${host}: skipped, out of time`); continue }
      // Leave later engines a share of the budget when an earlier one hangs.
      const { timeout, timer } = timeoutAfter(index === options.engines.length - 1 ? remaining : Math.min(remaining, Math.ceil(options.fallbackTimeoutMs / 2)))
      let fetched: { page: WebPage; url: string }
      try {
        fetched = await fetchPage(engine, url, signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]))
      } catch (error) {
        if (signal?.aborted) throw aborted(signal)
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
        attempts.push(`${host}: ${timeout.signal.aborted ? 'timed out' : `${code !== undefined && code !== '' ? `${code} ` : ''}${reasonOf(error)}`}`)
        continue
      } finally {
        clearTimeout(timer)
      }
      const at = new URL(fetched.url).host
      if (fetched.page.statusCode !== 200) { attempts.push(`${at}: HTTP ${fetched.page.statusCode}`); continue }
      const parsed = engine.parse(fetched.page.body?.content ?? '')
      if (parsed.error !== undefined) { attempts.push(`${at}: ${parsed.error}`); continue }
      const sources = parsed.sources ?? []
      if (sources.length === 0) { empty ??= { engine, at }; attempts.push(`${at}: no results`); continue }
      return { result: { engine, at, sources } }
    }
    return empty === undefined ? { attempts } : { result: { ...empty, sources: [] } }
  }

  return {
    id: AUTO_PROVIDER_ID,
    available: () => options.native || options.fallback,
    async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
      if (signal?.aborted) throw aborted(signal)
      const native = await runNative(request, signal)
      if ('result' in native) return native.result
      let fallbackReason = 'turned off (web-search-auto fallback: false)'
      if (options.fallback) {
        const fallback = await runFallback(request, signal)
        if ('result' in fallback) {
          return {
            content: `Search backend: keyless fallback, parsed from the public ${fallback.result.engine.name} results page at ${fallback.result.at} (no API key, no charge; less reliable than an API search). Native search was not used: ${native.reason}.`,
            sources: fallback.result.sources,
            truncated: false,
          }
        }
        fallbackReason = fallback.attempts.join('; ')
      }
      throw new WebError([
        'Web search is unavailable for this query.',
        `Native search: ${native.reason}.`,
        `Keyless fallback: ${fallbackReason}.`,
        'Do not guess URLs or present pages you remember as search results. If you have a browser tool, open a search engine in it; otherwise tell the user that web search is unavailable and why.',
      ].join('\n'), 'WEB_SEARCH_UNAVAILABLE')
    },
  }
}

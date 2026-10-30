import { type Engine } from './engines.ts'
import { type Candidate, type Route } from './native.ts'
import { isRecord, str, type Source } from './source.ts'

export const USER_AGENT = 'moon-bot/0.1.0'

export const MINUTE = 60_000
/** What one native attempt concluded about its endpoint, driving how long to skip it. */
export type SkipOutcome = 'absent' | 'rejected' | 'denied' | 'ignored' | 'slow'
// How long one outcome keeps a candidate from being tried again.
export const SKIP_FOR: Readonly<Record<SkipOutcome, number>> = {
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
export const STATUS_OUTCOMES: Readonly<Record<number, SkipOutcome>> = {
  404: 'absent',
  405: 'absent',
  501: 'absent',
  400: 'rejected',
  415: 'rejected',
  422: 'rejected',
  401: 'denied',
  402: 'denied',
  403: 'denied',
}

// AbortSignal.timeout's wait is unref'd, so under Node 22's test runner a pending subtest
// is cancelled as soon as nothing ref'd holds the loop — and a mocked fetch holds nothing.
// A plain setTimeout keeps the loop honest; the abort reason stays a TimeoutError.
export const timeoutAfter = (ms: number): { timeout: AbortController; timer: ReturnType<typeof setTimeout> } => {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
  return { timeout, timer }
}

export const errorDetail = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text)
    const error = isRecord(parsed) ? parsed.error : undefined
    if (typeof error === 'string') return str(error) ?? ''
    return (
      str(isRecord(error) ? error.message : undefined) ??
      str(isRecord(parsed) ? parsed.message : undefined) ??
      str(isRecord(parsed) ? parsed.msg : undefined) ??
      ''
    )
  } catch {
    return ''
  }
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
export interface Credential {
  readonly headers?: (candidate: Candidate) => Record<string, string>
  readonly via?: string
  readonly reason?: string
}

/** What this process remembers about one endpoint on one route. */
export interface EndpointMemory {
  readonly works?: boolean
  readonly until?: number
  readonly reason?: string
}

/** One native attempt: its sources, or why it answered nothing. */
export type AttemptOutcome =
  | { readonly sources: readonly Source[] }
  | {
      readonly reason: string
      readonly skip: SkipOutcome | undefined
      readonly timedOut: boolean
      readonly final: boolean
    }

/** Native search over the asking route: a result, or why it could not run. */
export type NativeRun = { readonly reason: string } | { readonly result: SearchResult }

/** The keyless fallback: a result, or one note per engine attempt. */
export type FallbackRun =
  | { readonly attempts: readonly string[] }
  | { readonly result: { readonly engine: Engine; readonly at: string; readonly sources: readonly Source[] } }

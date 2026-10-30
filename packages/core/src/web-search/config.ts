// Plugin config for the `auto` search provider: defaults, validation, and normalization.
// Invalid entries fail loud at load rather than silently searching less.
import { ENGINES, type EngineId } from './engines.ts'
import { AUTH_STYLES, SEARCH_APIS, type SearchApi } from './native.ts'
import { isRecord, str } from './source.ts'

export const DEFAULTS = Object.freeze({
  native: true,
  fallback: true,
  engines: ['bing', 'duckduckgo'],
  searchApis: [],
  nativeTimeoutMs: 40_000,
  // A protocol's standard search tool on a host that declares none is a guess: it gets a
  // short budget, and a guess that times out is not retried for a while.
  guessTimeoutMs: 12_000,
  fallbackTimeoutMs: 15_000,
})

function checkSearchApi(api: unknown, index: number): void {
  const where = `web-search-auto: searchApis[${index}]`
  if (!isRecord(api)) throw new Error(`${where} must be an object`)
  if (str(api.id) === undefined) throw new Error(`${where} needs an id`)
  if (!Array.isArray(api.hosts) || api.hosts.length === 0 || !api.hosts.every(host => typeof host === 'string' && /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host))) {
    throw new Error(`${where}.hosts must be a list of host names; a leading *. matches subdomains`)
  }
  if (typeof api.path !== 'string' || !/^\/[^/]/.test(api.path)) throw new Error(`${where}.path must be a path on the route's host, starting with one /`)
  if (!isRecord(api.body)) throw new Error(`${where}.body must be an object`)
  if (api.auth !== undefined && (!Array.isArray(api.auth) || api.auth.length === 0 || !api.auth.every(style => typeof style === 'string' && Object.hasOwn(AUTH_STYLES, style)))) {
    throw new Error(`${where}.auth must be a list of ${Object.keys(AUTH_STYLES).join(', ')}`)
  }
  for (const key of ['maxResults', 'maxQueryChars'] as const) {
    const value = api[key]
    if (value !== undefined && !(typeof value === 'number' && Number.isInteger(value) && value >= 1)) throw new Error(`${where}.${key} must be a positive integer`)
  }
  if (api.name !== undefined && str(api.name) === undefined) throw new Error(`${where}.name must be text`)
}

/** Plugin config, normalized: `resolveConfig` validated every field. */
export interface ResolvedConfig {
  readonly native: boolean
  readonly fallback: boolean
  readonly engines: readonly EngineId[]
  readonly searchApis: readonly SearchApi[]
  readonly nativeTimeoutMs: number
  readonly guessTimeoutMs: number
  readonly fallbackTimeoutMs: number
}

const isEngineId = (value: unknown): value is EngineId => typeof value === 'string' && Object.hasOwn(ENGINES, value)
const timeoutOf = (merged: Readonly<Record<string, unknown>>, key: 'nativeTimeoutMs' | 'guessTimeoutMs' | 'fallbackTimeoutMs'): number => {
  const value = merged[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1000) throw new Error(`web-search-auto: ${key} must be at least 1000`)
  return value
}

/**
 * Normalize plugin config. Invalid entries fail loud at load rather than silently searching less.
 * Declared `searchApis` come before the built-in SEARCH_APIS, so a user entry wins on its host.
 */
export function resolveConfig(config: unknown = {}): ResolvedConfig {
  const merged: Record<string, unknown> = {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(isRecord(config) ? config : {}).filter(([, value]) => value !== undefined)),
  }
  const rawEngines = merged.engines
  if (!Array.isArray(rawEngines) || !rawEngines.every(isEngineId)) {
    throw new Error(`web-search-auto: engines must be a list of ${Object.keys(ENGINES).join(', ')}`)
  }
  const engines = rawEngines as readonly EngineId[]
  const nativeTimeoutMs = timeoutOf(merged, 'nativeTimeoutMs')
  const guessTimeoutMs = timeoutOf(merged, 'guessTimeoutMs')
  const fallbackTimeoutMs = timeoutOf(merged, 'fallbackTimeoutMs')
  const rawApis = merged.searchApis
  if (!Array.isArray(rawApis)) throw new Error('web-search-auto: searchApis must be a list')
  rawApis.forEach(checkSearchApi)
  return {
    ...merged,
    native: merged.native !== false,
    fallback: merged.fallback !== false,
    engines,
    searchApis: [...(rawApis as unknown as readonly SearchApi[]), ...SEARCH_APIS],
    nativeTimeoutMs,
    guessTimeoutMs,
    fallbackTimeoutMs,
  }
}

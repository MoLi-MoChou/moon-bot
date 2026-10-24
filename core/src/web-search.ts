// Search provider `auto` for dsh's web seam (`ctx.web`). Each query first tries native search
// behind the asking Session's own model route, with that route's own key, on that route's own
// origin. Native search is found by protocol, not by vendor: the route's wire protocol defines a
// standard search tool (Anthropic Messages, OpenAI Responses, Gemini), and a host may also serve
// a separate search API, declared as data (SEARCH_APIS, or `searchApis` in config). Whether an
// endpoint supports either is only knowable by trying, so every outcome is remembered. It never
// borrows another route's key: every key bills its own account. When native search is
// unavailable, a keyless fallback parses a public results page fetched through ctx.web.fetch.
// Every result says which path answered it; when both fail, the error tells the model not to
// guess. Independent of the Bot team code in index.ts.
//
// One import surface over focused modules: source (shared text and Source building), readers
// (native response readers), native (what to try for one route), engines (the keyless
// fallback's results pages), config (plugin config), provider (the provider itself), host
// (the dsh wiring).
export const name = 'web-search-auto'
export const inject = ['web']

export { decodeEntities, textOf } from './web-search/source.ts'
export { findSources, readDeclared, readGemini, readMessages, readResponses, showsSearch } from './web-search/readers.ts'
export { AUTH_STYLES, planNative, PROTOCOL_SEARCHES, SEARCH_APIS } from './web-search/native.ts'
export { decodeBingUrl, ENGINES, parseBing, parseDuckDuckGo } from './web-search/engines.ts'
export { DEFAULTS, resolveConfig } from './web-search/config.ts'
export { AUTO_PROVIDER_ID, createAutoSearchProvider } from './web-search/provider.ts'
export { apply, routeOf } from './web-search/host.ts'

export type { Source } from './web-search/source.ts'
export type { ReadOutcome } from './web-search/readers.ts'
export type { AuthStyle, BodyReader, Candidate, PreparedRequest, ProtocolId, ProtocolSearch, Route, SearchApi, SearchCall } from './web-search/native.ts'
export type { Engine, EngineId, PageOutcome } from './web-search/engines.ts'
export type { ResolvedConfig } from './web-search/config.ts'
export type { AutoSearchProvider, ProviderDeps, SearchRequest, SearchResult, WebPage } from './web-search/provider.ts'
export type { HostContext } from './web-search/host.ts'

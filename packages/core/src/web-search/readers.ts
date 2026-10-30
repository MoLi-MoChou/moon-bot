// Native search: response readers. Each returns `{ ran, cut?, sources, error? }`: whether the
// endpoint actually ran a search, and only the structured sources it reported (URL, title,
// excerpt, date), never the answer text a model wrote around them.
import { arrayOf, dedupe, httpUrl, isRecord, isText, sourceOf, type Source } from './source.ts'

/** What one reader says about one response body. */
export interface ReadOutcome {
  /** The endpoint ran a search (or showed one), whatever it found. */
  readonly ran: boolean
  /** The answer was cut off before it finished; that says nothing about search support. */
  readonly cut?: boolean
  readonly sources: readonly Source[]
  readonly error?: string
}

/** Anthropic Messages with the `web_search_20250305` server tool. */
export function readMessages(body: unknown): ReadOutcome {
  const root = isRecord(body) ? body : undefined
  const blocks = arrayOf(root?.content) ?? []
  const results = blocks.filter(
    (block): block is Record<string, unknown> => isRecord(block) && block.type === 'web_search_tool_result',
  )
  const excerpts = new Map<string, string>()
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== 'text' || !Array.isArray(block.citations)) continue
    for (const cite of block.citations) {
      // The cited text is kept as written; only blank excerpts are skipped.
      if (isRecord(cite) && typeof cite.url === 'string' && isText(cite.cited_text) && !excerpts.has(cite.url))
        excerpts.set(cite.url, cite.cited_text)
    }
  }
  const sources = dedupe(
    results
      .flatMap(block => arrayOf(block.content) ?? [])
      .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === 'web_search_result')
      .map(item =>
        sourceOf(
          item.url,
          item.title,
          (typeof item.url === 'string' ? excerpts.get(item.url) : undefined) ??
            (typeof item.content === 'string' ? item.content : undefined),
          item.page_age,
        ),
      ),
  )
  const failed = results
    .map(block => block.content)
    .find(
      (content): content is Record<string, unknown> =>
        isRecord(content) && content.type === 'web_search_tool_result_error',
    )
  return {
    ran: results.length > 0 || blocks.some(block => isRecord(block) && block.type === 'server_tool_use'),
    cut: root?.stop_reason === 'max_tokens',
    sources,
    ...(sources.length === 0 && failed !== undefined
      ? { error: `web search failed: ${String(failed.error_code ?? 'unknown error')}` }
      : {}),
  }
}

/** OpenAI Responses with the `web_search` tool. */
export function readResponses(body: unknown): ReadOutcome {
  const root = isRecord(body) ? body : undefined
  const output = arrayOf(root?.output) ?? []
  const calls = output.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.type === 'web_search_call',
  )
  const found: (Source | undefined)[] = []
  for (const call of calls) {
    const action = isRecord(call.action) ? call.action : undefined
    for (const source of arrayOf(action?.sources) ?? []) {
      if (isRecord(source)) found.push(sourceOf(source.url, source.title))
    }
  }
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part)) continue
      for (const note of arrayOf(part.annotations) ?? []) {
        if (isRecord(note) && note.type === 'url_citation') found.push(sourceOf(note.url, note.title))
      }
    }
  }
  for (const cite of arrayOf(root?.citations) ?? []) {
    found.push(typeof cite === 'string' ? sourceOf(cite) : isRecord(cite) ? sourceOf(cite.url, cite.title) : undefined)
  }
  const sources = dedupe(found)
  return { ran: calls.length > 0 || sources.length > 0, cut: root?.status === 'incomplete', sources }
}

/** Gemini `generateContent` with the `google_search` tool. */
export function readGemini(body: unknown): ReadOutcome {
  const candidates = arrayOf(isRecord(body) ? body.candidates : undefined) ?? []
  const chunksOf = (candidate: unknown): unknown[] => {
    if (!isRecord(candidate) || !isRecord(candidate.groundingMetadata)) return []
    return arrayOf(candidate.groundingMetadata.groundingChunks) ?? []
  }
  return {
    ran: candidates.some(candidate => isRecord(candidate) && isRecord(candidate.groundingMetadata)),
    cut: candidates.some(candidate => isRecord(candidate) && candidate.finishReason === 'MAX_TOKENS'),
    sources: dedupe(
      candidates
        .flatMap(chunksOf)
        .map(chunk => (isRecord(chunk) && isRecord(chunk.web) ? sourceOf(chunk.web.uri, chunk.web.title) : undefined)),
    ),
  }
}

const URL_KEYS = ['url', 'uri', 'link']
const TITLE_KEYS = ['title', 'name', 'site_name']
const SNIPPET_KEYS = ['snippet', 'summary', 'content', 'description', 'cited_text', 'text']
const DATE_KEYS = ['published_date', 'publish_date', 'publish_time', 'page_age', 'date', 'last_updated']
// Media links are not results, and a response that echoes the request's tools is not a search.
const NOT_SOURCES = new Set([
  'image_url',
  'images',
  'image',
  'icon',
  'favicon',
  'logo',
  'logo_url',
  'thumbnail',
  'tools',
])
const SEARCH_MARK = /search|grounding|citation/i
const firstText = (record: Record<string, unknown>, keys: readonly string[]): unknown =>
  keys.map(key => record[key]).find(value => isText(value))

/** Every object in a JSON body that carries an http(s) URL, as sources: the shape of any search API. */
export function findSources(body: unknown): readonly Source[] {
  const found: (Source | undefined)[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 16) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (!isRecord(value)) return
    const url = URL_KEYS.map(key => httpUrl(value[key])).find(Boolean)
    if (url !== undefined)
      found.push(
        sourceOf(url, firstText(value, TITLE_KEYS), firstText(value, SNIPPET_KEYS), firstText(value, DATE_KEYS)),
      )
    for (const [key, child] of Object.entries(value)) if (!NOT_SOURCES.has(key)) visit(child, depth + 1)
  }
  visit(body, 0)
  return dedupe(found)
}

/** Whether a JSON body shows a search ran, read from its keys and `type` tags, never from prose. */
export function showsSearch(body: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 16) return false
    if (Array.isArray(value)) return value.some(item => visit(item, depth + 1))
    if (!isRecord(value)) return false
    return Object.entries(value).some(
      ([key, child]) =>
        !NOT_SOURCES.has(key) &&
        (SEARCH_MARK.test(key) ||
          key === 'results' ||
          (key === 'type' && typeof child === 'string' && SEARCH_MARK.test(child)) ||
          visit(child, depth + 1)),
    )
  }
  return visit(body, 0)
}

/** A declared search API's response: any structured sources, wherever they sit. */
export function readDeclared(body: unknown): ReadOutcome {
  const sources = findSources(body)
  return { ran: sources.length > 0 || showsSearch(body), sources }
}

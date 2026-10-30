// Keyless fallback: public results pages, parsed into sources.
import { attrOf, dedupe, httpUrl, sourceOf, textOf, type Source } from './source.ts'

/** One engine's verdict on a fetched page: results, or why the page is not a results page. */
export interface PageOutcome {
  readonly sources?: readonly Source[]
  readonly error?: string
}

/** One public results page the fallback knows how to fetch and parse. */
export interface Engine {
  readonly name: string
  readonly url: (query: string) => string
  readonly parse: (html: string) => PageOutcome
  /** The origins a redirect to this engine's own regional host may take (mainland Bing). */
  readonly regional?: RegExp
}

/** Bing wraps result links in `bing.com/ck/a?…&u=a1<base64url>`; recover the target. */
export function decodeBingUrl(href: unknown): string | undefined {
  const url = httpUrl(href)
  if (url === undefined) return undefined
  const parsed = new URL(url)
  if (!/(^|\.)bing\.com$/i.test(parsed.hostname)) return url
  const target = parsed.searchParams.get('u')
  if (parsed.pathname !== '/ck/a' || target === null || !target.startsWith('a1')) return undefined
  try {
    return httpUrl(Buffer.from(target.slice(2), 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

/** Bing results page → `{ sources }`, or `{ error }` when the page is not a results page. */
export function parseBing(html: string): PageOutcome {
  const starts = [...html.matchAll(/<li\b[^>]*\bclass\s*=\s*"[^"]*\bb_algo\b[^"]*"[^>]*>/gi)].map(
    match => match.index ?? 0,
  )
  const sources: (Source | undefined)[] = []
  starts.forEach((start, index) => {
    const block = html.slice(start, starts[index + 1] ?? start + 12_000)
    const heading = /<h2\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block)
    if (heading === null) return
    const href = attrOf(heading[1] ?? '', 'href')
    const caption = block.slice(Math.max(0, block.search(/<div\b[^>]*\bclass\s*=\s*"[^"]*\bb_caption\b/i)))
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(caption)
    sources.push(
      sourceOf(
        decodeBingUrl(href),
        textOf(heading[2] ?? ''),
        paragraph === null ? undefined : textOf(paragraph[1] ?? ''),
      ),
    )
  })
  const parsed = dedupe(sources)
  if (parsed.length > 0) return { sources: parsed }
  if (/\bclass\s*=\s*"[^"]*\bb_no\b/i.test(html)) return { sources: [] }
  return {
    error: /id\s*=\s*"b_results"/i.test(html)
      ? 'results page had no parsable results'
      : 'not a results page (bot check or changed layout)',
  }
}

/** DuckDuckGo HTML results page → `{ sources }`, or `{ error }`. */
export function parseDuckDuckGo(html: string): PageOutcome {
  if (/anomaly-modal|bots use DuckDuckGo too|challenge-form/i.test(html)) return { error: 'bot check page' }
  const links = [...html.matchAll(/<a\b([^>]*\bclass\s*=\s*"[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)]
  const sources = links.map((link, index) => {
    const href = attrOf(link[1] ?? '', 'href') ?? ''
    let target: string | undefined
    try {
      const parsed = new URL(href, 'https://duckduckgo.com')
      // `/y.js` links are ads.
      if (/(^|\.)duckduckgo\.com$/i.test(parsed.hostname))
        target = parsed.pathname === '/l/' ? (parsed.searchParams.get('uddg') ?? undefined) : undefined
      else target = parsed.href
    } catch {
      target = undefined
    }
    const rest = html.slice((link.index ?? 0) + link[0].length, links[index + 1]?.index ?? (link.index ?? 0) + 6000)
    const snippet =
      /<(?:a|div|td)\b[^>]*\bclass\s*=\s*"[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(rest)
    return sourceOf(target, textOf(link[2] ?? ''), snippet === null ? undefined : textOf(snippet[1] ?? ''))
  })
  const parsed = dedupe(sources)
  if (parsed.length > 0) return { sources: parsed }
  if (/\bresult--no-results\b|\bno-results\b/i.test(html)) return { sources: [] }
  return { error: 'not a results page (bot check or changed layout)' }
}

export const ENGINES: Readonly<Record<'bing' | 'duckduckgo', Engine>> = {
  // No market or language parameter: Bing picks them from the network, as it does for a browser.
  // `regional` is the hosts Bing itself may redirect to (mainland networks go to cn.bing.com).
  bing: {
    name: 'Bing',
    url: query => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    parse: parseBing,
    regional: /^https:\/\/([a-z0-9-]+\.)*bing\.com$/i,
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    url: query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGo,
  },
}
export type EngineId = keyof typeof ENGINES

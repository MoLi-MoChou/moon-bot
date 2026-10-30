// Shared base of the `auto` web-search provider: unknown-value narrowing, text and HTML
// helpers, and the one portable `Source` shape every path answers in — an http(s) URL plus
// what the page or API said about it, never the answer text a model wrote around it.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Whether `value` is a non-blank string, untrimmed. */
export const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A non-blank string, trimmed; undefined for anything else. */
export const str = (value: unknown): string | undefined => (isText(value) ? value.trim() : undefined)

/** An array value read as `unknown[]`; undefined when the field is not one. */
export const arrayOf = (value: unknown): unknown[] | undefined => (Array.isArray(value) ? value : undefined)

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Math.floor(value)))

export const httpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** An error's own reason, with undici's `fetch failed` wrapper opened to its cause. */
export const reasonOf = (error: unknown): string => {
  const record = isRecord(error) ? error : undefined
  const cause = isRecord(record?.cause) ? record.cause : undefined
  const causeMessage = isText(cause?.message) ? cause.message : undefined
  if (causeMessage !== undefined && record?.message === 'fetch failed') return causeMessage
  const message = record?.message
  return message === undefined || message === null ? String(error) : String(message)
}

export const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`

export const trimSlash = (url: string): string => url.replace(/\/+$/, '')

export const SNIPPET_CHARS = 500

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  zwj: '',
  zwnj: '',
}
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
// Inline tags vanish so "<strong>deep</strong>seek" stays one word; block ends become spaces.
export const textOf = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/td|\/tr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
export const attrOf = (attrs: string, attr: string): string | undefined => {
  const match = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return match === null ? undefined : decodeEntities(match[2] ?? match[3] ?? '')
}

const plain = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** One result of any search path: an http(s) URL plus optional title, snippet, date. */
export interface Source {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** One portable source from plain-text fields; empty optional fields are omitted rather than invented. */
export const sourceOf = (
  url: unknown,
  title?: unknown,
  snippet?: unknown,
  publishedAt?: unknown,
): Source | undefined => {
  const href = httpUrl(url)
  if (href === undefined) return undefined
  const cleanTitle = plain(title)
  const cleanSnippet = plain(snippet)
  const date = str(publishedAt)
  return {
    url: href,
    ...(cleanTitle ? { title: clip(cleanTitle, 300) } : {}),
    ...(cleanSnippet ? { snippet: clip(cleanSnippet, SNIPPET_CHARS) } : {}),
    ...(date ? { publishedAt: date } : {}),
  }
}

/** Collapses to one source per URL; the first mention's fields win, later ones fill gaps. */
export const dedupe = (sources: readonly (Source | undefined)[]): readonly Source[] => {
  const seen = new Map<string, Source>()
  for (const source of sources) {
    if (source === undefined) continue
    const known = seen.get(source.url)
    if (known === undefined) seen.set(source.url, source)
    else seen.set(source.url, { ...source, ...known })
  }
  return [...seen.values()]
}

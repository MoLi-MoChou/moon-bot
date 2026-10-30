// Redaction and naming for the keys a user types into a card for a Bot. A value lives
// only in secrets.json (mode 600) and in this process; Bots use it as $MOON_BOT_SECRET_<NAME>
// (the DSH-era $DSH_SECRET_<NAME> keeps working).
// in their shell, tool results lose it before they are saved, and every model request
// has it replaced by [secret:<NAME>] before it leaves.

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
export const ENV_PREFIX = 'MOON_BOT_SECRET_'
/** The prefix a Bot used before the rename; both resolve. */
export const LEGACY_ENV_PREFIX = 'DSH_SECRET_'
// A short value (a PIN, a short password) would also hit ordinary words if it were
// replaced wherever it appears, so below WHOLE_VALUE it is replaced only where it
// stands alone: no letter or digit right before or after it.
export const MIN_VALUE = 4
export const WHOLE_VALUE = 8
export const MAX_VALUE = 16384

/** The Bots a secret is offered to: every Bot, or an explicit list of Bot ids. */
export type SecretScope = 'all' | string[]

/** What `canUse` reads: a stored secret, or a bare `{ scope }` in a test. */
export interface SecretScopeHolder {
  readonly scope: SecretScope
}

/** A replacement function: every known value in a string becomes `[secret:<NAME>]`. */
export type Redact = (text: string) => string

/** One `{ name, value }` pair `redactor` masks. */
export interface RedactableSecret {
  readonly name: string
  readonly value: unknown
}

export const envName = (name: string): string => `${ENV_PREFIX}${name}`

const isWellFormed = (value: string): boolean => (value as string & { isWellFormed(): boolean }).isWellFormed()

export const canUse = (secret: SecretScopeHolder | undefined, botId: string | undefined): boolean => {
  if (secret === undefined || botId === undefined) return false
  const scope = secret.scope
  return scope === 'all' || (Array.isArray(scope) && scope.includes(botId))
}

export function normalizeName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^\$(env:)?/i, '')
    .replace(/^(?:MOON_BOT|DSH)_SECRET_/i, '')
    .replace(/[\s-]+/g, '_')
    .toUpperCase()
}

// encodeURIComponent leaves ' as is, but new URL() turns it into %27 in a query, so the
// URL sent out would hold a form the redactor does not know. Encoding these characters
// too keeps the sent URL equal to the text the redactor looks for.
export const encodeUrlComponent = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

// One function that replaces every known value in a string, longest first so a value
// that contains another is replaced whole. JSON-escaped and URL-encoded forms are covered too.
export function redactor(entries: Iterable<RedactableSecret>): Redact {
  const pairs: [string, string, boolean][] = []
  for (const { name, value } of entries) {
    if (typeof value !== 'string' || value.length < MIN_VALUE) continue
    const label = `[secret:${name}]`
    const short = value.length < WHOLE_VALUE
    pairs.push([value, label, short])
    const escaped = JSON.stringify(value).slice(1, -1)
    if (escaped !== value) pairs.push([escaped, label, short])
    // encodeURIComponent throws on a lone surrogate; such a value cannot sit in a URL anyway.
    // Node has this ES2024 method; the type library here stops at ES2022.
    const encoded = isWellFormed(value) ? encodeUrlComponent(value) : value
    if (encoded !== value && encoded !== escaped) pairs.push([encoded, label, short])
  }
  pairs.sort((a, b) => b[0].length - a[0].length)
  if (pairs.length === 0) return (text: string): string => text
  // One pass, so a label already written is never matched again.
  const labels = new Map<string, string>()
  for (const [value, label] of pairs) if (!labels.has(value)) labels.set(value, label)
  const quote = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    pairs
      .map(([value, , short]) => (short ? `(?<![\\p{L}\\p{N}])${quote(value)}(?![\\p{L}\\p{N}])` : quote(value)))
      .join('|'),
    'gu',
  )
  return (text: string): string => {
    if (typeof text !== 'string' || !pairs.some(([value]) => text.includes(value))) return text
    return text.replace(pattern, match => labels.get(match) ?? match)
  }
}

// Returns the same reference when nothing changed, so callers can tell cheaply.
export function redactDeep<T>(value: T, redact: Redact): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) {
    let changed = false
    const next = (value as readonly unknown[]).map(item => {
      const replaced = redactDeep(item, redact)
      if (replaced !== item) changed = true
      return replaced
    })
    return (changed ? next : value) as T
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const replaced = redactDeep(item, redact)
      if (replaced !== item) changed = true
      next[key] = replaced
    }
    return (changed ? next : value) as T
  }
  return value
}

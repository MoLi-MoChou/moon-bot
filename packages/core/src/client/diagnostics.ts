// What went wrong in this browser, for Settings → Feedback and the report it builds.
// Calls whose failures the interface swallows (polls, previews) still land here.
import { t, language } from './i18n.ts'

const MAX = 30
// The same failure again within this window bumps a count instead of a new line.
const REPEAT_MS = 5 * 60 * 1000
interface ClientErrorEntry {
  time: number
  level: 'error'
  text: string
  code?: string
  count?: number
}
const entries: ClientErrorEntry[] = []
// An API failure is noted where it happens; the menu or form that shows it must not add it again.
const noted = new WeakSet<object>()
export const markNoted = <T>(error: T): T => {
  if (error !== null && typeof error === 'object') noted.add(error)
  return error
}

export function noteClientError(where: string, error: unknown): void {
  const failure = error as { message?: unknown; code?: unknown } | null
  if (error !== null && typeof error === 'object') {
    if (noted.has(error)) return
    noted.add(error)
  }
  const message = String(failure?.message ?? error ?? 'error').slice(0, 300)
  const code = typeof failure?.code === 'string' ? failure.code : undefined
  const text = `${where}: ${message}`
  const now = Date.now()
  const last = entries.at(-1)
  if (last !== undefined && last.text === text && now - last.time < REPEAT_MS) {
    last.time = now
    last.count = (last.count ?? 1) + 1
    return
  }
  const entry: ClientErrorEntry = { time: now, level: 'error', text, ...(code !== undefined ? { code } : {}) }
  entries.push(entry)
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
}

// A catch handler that keeps the failure without bothering the user.
export const quietly =
  (where: string) =>
  (error: unknown): void =>
    noteClientError(where, error)

export const clearClientErrors = (): void => {
  entries.length = 0
}

export const clientErrors = (): ClientErrorEntry[] =>
  entries.map(entry =>
    entry.count !== undefined && entry.count > 1 ? { ...entry, text: `${entry.text} (×${entry.count})` } : { ...entry },
  )

export function clientFacts(): Record<string, string> {
  return {
    surface: window.dshDesktop ? 'Desktop' : 'Web',
    language: language(),
    userAgent: navigator.userAgent,
  }
}

// Short words for the provider-neutral failure codes of the host's LLM layer.
const FAILURES: Record<string, string> = {
  AUTH: 'The API key was rejected',
  QUOTA: 'The account is out of quota',
  ACCOUNT_QUOTA: 'The account is out of quota',
  RATE_LIMIT: 'Too many requests to the model',
  CONTEXT_WINDOW_EXCEEDED: 'The conversation is too long for the model',
  INVALID_REQUEST: 'The model service refused the request',
  SERVER: 'The model service failed',
  TIMEOUT: 'The model took too long to answer',
  TRANSPORT: 'Could not reach the model service',
  SESSION: 'Its group conversation could not open',
  SESSION_RESET: 'Its group conversation could not open, so it starts a new one next time',
  // The engine's own code: the Bot names no model, or its route is not set up.
  'NO-MODEL': 'No model is set for this Bot',
}

export function failureLabel(code: string, message?: string): string {
  const known = FAILURES[code]
  if (known !== undefined) return t(known)
  return message ?? code ?? t('Unknown error')
}

// GitHub refuses very long addresses; past this the diagnostics go by the clipboard.
const URL_LIMIT = 7000
export const WHAT_MAX = 2000
const PASTE_NOTE = 'Moon Bot copied the diagnostics to the clipboard. Paste them here.'
const REST_NOTE =
  'The recent errors do not fit in the link. Moon Bot copied the diagnostics to the clipboard: paste them below this line.'

export function issueUrl(
  base: string,
  { what = '', diagnostics }: { what?: string; diagnostics: string },
): { url: string; inline: boolean } {
  const text = what.trim().slice(0, WHAT_MAX)
  const title = text.split('\n')[0]?.slice(0, 80) ?? ''
  const build = (body: string): string =>
    `${base}?${new URLSearchParams({ template: 'bug.yml', ...(title ? { title } : {}), ...(text ? { what: text } : {}), diagnostics: body })}`
  const full = build(diagnostics)
  if (full.length <= URL_LIMIT) return { url: full, inline: true }
  // The versions table leads the report and stays short; only the errors make it
  // long, and a report that lost the versions is hard to act on.
  const facts = build(`${diagnostics.split('\n\n')[0]}\n\n${REST_NOTE}`)
  return { url: facts.length <= URL_LIMIT ? facts : build(PASTE_NOTE), inline: false }
}

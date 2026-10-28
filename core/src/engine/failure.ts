// A model call that failed, as the engine reports it and as the chat reads it back: the
// wire's own words plus a code. A provider's message is not the reason a person reads —
// it can carry part of the key, and "401 {...}" says nothing — so `turn/end` carries the
// code, the chat's words come from it, and the message is only what the code cannot say.

/** A failed model call, the shape `turn/end`'s `error` reason carries. */
export interface CallFailure {
  readonly code?: string | undefined
  readonly message?: string | undefined
  readonly status?: number | undefined
}

// The key shapes a provider may echo back in an error body. The engine stores the
// message for the chat to fall back on, so a key in it would be stored and shown.
const KEY_SHAPES: readonly (readonly [RegExp, string])[] = [
  [/\bsk-[A-Za-z0-9_*.-]{6,}/g, 'sk-[hidden]'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi, '$1 [hidden]'],
  [/(["']?(?:api[_-]?key|x-api-key|authorization|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, '$1[hidden]'],
]

/** `text` with anything shaped like a key masked. */
const maskSecrets = (text: string): string => KEY_SHAPES.reduce((out, [shape, replace]) => out.replace(shape, replace), text)

// A failure's words on the wire decide its code. A provider that answers 401 in a body,
// a URL that refuses the connection and a 429 all say it differently, so each shape is
// matched here once, for the chat, the logs and the diagnostics alike.
const CODES: readonly (readonly [RegExp, string])[] = [
  [/\b40[13]\b|unauthori[sz]ed|authentication|invalid[ _-]?(?:api[ _-]?key|x-api-key|token|credential)|incorrect api key|permission denied|forbidden/i, 'AUTH'],
  [/\b429\b|rate.?limit|too many requests/i, 'RATE_LIMIT'],
  [/\b408\b|timed? ?out|timeout/i, 'TIMEOUT'],
  [/context (?:length|window)|too long|maximum.{0,24}tokens|prompt is too long|overflow/i, 'CONTEXT_WINDOW_EXCEEDED'],
  [/\b50[0234]\b|internal server error|bad gateway|service unavailable|overloaded/i, 'SERVER'],
  [/\b400\b|invalid_request|bad request|unsupported/i, 'INVALID_REQUEST'],
  [/connection error|fetch failed|econnrefused|econnreset|enotfound|eai_again|etimedout|socket hang up|network|unreachable|offline|closed/i, 'TRANSPORT'],
]

/** The code a failure's own message names, or undefined when it names none. */
export function failureCodeOf(message: string | undefined): string | undefined {
  if (message === undefined || message === '') return undefined
  for (const [shape, code] of CODES) if (shape.test(message)) return code
  return undefined
}

/**
 * A failure as the engine reports it. An auth failure loses its message: the provider's
 * text may hold part of the key, and the chat says "it refused the key" anyway.
 */
export function callFailureOf(error: unknown): CallFailure {
  const view = error !== null && typeof error === 'object' ? error as { code?: unknown; message?: unknown; status?: unknown } : {}
  const raw = typeof error === 'string' ? error : typeof view.message === 'string' ? view.message : ''
  const named = typeof view.code === 'string' && view.code !== '' ? view.code : undefined
  const code = named ?? failureCodeOf(raw) ?? 'UNKNOWN'
  const safe = code === 'AUTH' ? '' : maskSecrets(raw).trim().slice(0, 500)
  return {
    code,
    ...(safe !== '' ? { message: safe } : {}),
    ...(typeof view.status === 'number' ? { status: view.status } : {}),
  }
}

/**
 * A failure from a kernel's own report (pi keeps only the text, so the code is read from
 * it). `fallback` names the reason when the text says nothing.
 */
export function failureOfMessage(message: string | undefined, fallback = 'the model call failed'): CallFailure {
  const raw = message === undefined || message.trim() === '' ? fallback : message
  return callFailureOf(raw)
}

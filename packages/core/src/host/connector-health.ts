// The lifecycle of one connector instance: which of the seven states it is in, why, and
// when it was last known good. A connector is not only connected or broken — a token that
// GitHub rejected needs the user, a server this build cannot reach needs nothing from them,
// and a capability waiting for approval is not an error at all. The view carries those
// apart so the settings row can offer the right next step instead of one generic failure.

/** Every state a connector instance can be in. */
export type ConnectorState = 'off' | 'connecting' | 'ready' | 'needs-auth' | 'needs-approval' | 'error' | 'unavailable'

/** What the settings row needs to explain a connector and what to do next. */
export interface ConnectorHealth {
  readonly state: ConnectorState
  /** A stable id for the configuration this health was measured for. */
  readonly fingerprint?: string | undefined
  /** When the connection last worked, in ms since the epoch. */
  readonly lastOkAt?: number | undefined
  /** The last failure as the user should read it (already redacted). */
  readonly lastError?: string | undefined
  readonly lastErrorAt?: number | undefined
  /** When the user may usefully try again, for the states that clear on their own. */
  readonly retryAt?: number | undefined
}

/** A failure's reading: its state, whether trying again can help, and the user-facing text. */
export interface ConnectorFailure {
  readonly state: ConnectorState
  readonly retryable: boolean
  readonly message: string
}

// Backoff between automatic retries of a transport failure. A rejected token is not in
// this list: waiting does not fix it, only the user does.
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const

/**
 * A stable fingerprint of a connector's configuration. Two runs over the same settings give
 * the same id, and any change to the address, protocol, server name, headers or required
 * secret gives another one, so a mount made for the old values is not reused.
 */
export function fingerprintOf(config: {
  readonly id?: string | undefined
  readonly transport?: string | undefined
  readonly url?: string | undefined
  readonly command?: string | undefined
  readonly args?: readonly string[] | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly secret?: string | undefined
}): string {
  const parts = [
    config.id ?? '',
    config.transport ?? '',
    config.url ?? '',
    config.command ?? '',
    (config.args ?? []).join('\u0000'),
    Object.entries(config.headers ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}=${value}`)
      .join('\u0000'),
    config.secret ?? '',
  ]
  // FNV-1a over the joined parts: short, stable, and no dependency. It is an identity, not
  // a security boundary; nothing secret goes in and the value is safe to show in a view.
  let hash = 0x811c9dc5
  for (const text of parts) {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** When a transport failure may be retried automatically, or undefined when it may not. */
export function backoffFor(failures: number, now: number): number | undefined {
  if (failures <= 0) return undefined
  const step = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]
  return step === undefined ? undefined : now + step
}

// The shapes the host and the MCP client already report failures in: a status code, a
// message, or a nested cause. Everything here is read from data, not from an error class.
interface FailureShape {
  readonly status?: unknown
  readonly statusCode?: unknown
  readonly code?: unknown
  readonly message?: unknown
  readonly cause?: unknown
}

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String((value as FailureShape)?.message ?? value)

/** The status code a failure carries, from the error or its cause. */
function statusOf(error: unknown): number | undefined {
  const shape = error as FailureShape | null
  for (const candidate of [shape?.status, shape?.statusCode]) {
    const value = typeof candidate === 'string' ? Number(candidate) : candidate
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Reads a failed connection. A rejected credential needs the user; a missing server or a
 * command this build cannot run is unavailable; a timeout, a 5xx and a dropped socket are
 * worth another try; anything else is an ordinary error and is not retried blindly.
 */
export function classifyFailure(error: unknown): ConnectorFailure {
  const shape = error as FailureShape | null
  const message = [error, shape?.cause].filter(Boolean).map(textOf).join(': ')
  const text = message.trim() === '' ? 'the connector failed' : message.trim()
  const status = statusOf(error) ?? statusOf(shape?.cause)
  const code = typeof shape?.code === 'string' ? shape.code : undefined
  if (status === 401 || status === 403) return { state: 'needs-auth', retryable: false, message: text }
  if (status === 404) return { state: 'unavailable', retryable: false, message: text }
  if (code === 'ENOENT' || /\bENOENT\b|command not found|not recognized as an internal/iu.test(text))
    return { state: 'unavailable', retryable: false, message: text }
  if (status !== undefined && status >= 500) return { state: 'error', retryable: true, message: text }
  if (status === 408 || status === 429) return { state: 'error', retryable: true, message: text }
  // A dropped or refused socket may clear on its own, whatever text came with it.
  if (
    code !== undefined &&
    /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_)/u.test(code)
  )
    return { state: 'error', retryable: true, message: text }
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network/iu.test(text))
    return { state: 'error', retryable: true, message: text }
  if (/not accept|unauthor|forbidden|invalid token|bad credentials/iu.test(text))
    return { state: 'needs-auth', retryable: false, message: text }
  return { state: 'error', retryable: false, message: text }
}

/** Whether a failure can be retried without any user action, given its reading. */
export function retryableByItself(failure: ConnectorFailure): boolean {
  return failure.retryable && failure.state === 'error'
}

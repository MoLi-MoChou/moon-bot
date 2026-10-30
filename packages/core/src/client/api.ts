import { errorCopy } from './i18n.ts'
import { markNoted, noteClientError } from './diagnostics.ts'

const ROUTE = 'api/bot'
// Refusals carry a message meant for the user, who sees it where they acted.
const REFUSALS = new Set<string>(['bot/refused', 'bot/invalid', 'bot/read-only', 'bot/not-found', 'bot/browser-off'])

interface RpcErrorBody { code?: string; message?: string }
interface RpcAnswer<T> { ok?: boolean; value?: T; error?: RpcErrorBody }

export async function call<T = unknown>(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    // Document-relative so the Web UI keeps working under a mounted base path.
    response = await fetch(ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? null }),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    const failure = error as { name?: string; message?: string }
    if (failure.name === 'AbortError') throw error
    noteClientError(endpoint, Object.assign(new Error(`network error: ${failure.message ?? String(error)}`), { code: 'NETWORK' }))
    // The browser's own text ("Failed to fetch", "Load failed") does not say what failed.
    throw markNoted(Object.assign(new Error(errorCopy('NETWORK')), { code: 'NETWORK', cause: error }))
  }
  if (!response.ok) {
    const error = Object.assign(new Error(errorCopy(`HTTP_${response.status}`, `HTTP ${response.status}`)), { code: `HTTP_${response.status}` })
    noteClientError(endpoint, error)
    throw error
  }
  const result = await response.json() as RpcAnswer<T>
  if (result.ok !== true) {
    const code = result.error?.code ?? 'bot/error'
    const message = errorCopy(code, result.error?.message ?? 'Request failed')
    const error = Object.assign(new Error(message), { code })
    if (!REFUSALS.has(code)) {
      noteClientError(endpoint, Object.assign(new Error(result.error?.message ?? 'Request failed'), { code }))
      markNoted(error)
    }
    throw error
  }
  return result.value as T
}

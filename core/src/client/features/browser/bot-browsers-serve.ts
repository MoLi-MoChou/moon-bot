// Host channel: answer browser-read requests from the Bot's active tab.
import type { BotBrowsers, BrowserReadAnswer, BrowserReadRequest } from './bot-browsers-types.ts'

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export interface ServeBrowserReadsOptions {
  browsers: BotBrowsers
  post: <T>(endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<T>
  clientId?: string | undefined
  retryMs?: number | undefined
}

/**
 * Answers `read_browser` for this window: a long poll (`browser-wait`) reports which Bots
 * have a page open here and brings back read requests, each answered with
 * `browser-result`. A change in the open pages ends the poll so the host learns at once.
 * Returns the stop function.
 */
export function serveBrowserReads({ browsers, post, clientId = globalThis.crypto.randomUUID(), retryMs = 1000 }: ServeBrowserReadsOptions): () => void {
  let stopped = false
  let poll: AbortController | undefined
  let reported = ''
  // The host hands a request out again until the result lands; the job is cached
  // the moment it starts, so a resend during a slow read shares it, and a resend
  // after a failed submit posts the cached answer again.
  const answered = new Map<string, Promise<BrowserReadAnswer>>()
  const answer = async ({ id, botId }: BrowserReadRequest): Promise<void> => {
    let job = answered.get(id)
    if (job === undefined) {
      job = (async (): Promise<BrowserReadAnswer> => {
        try {
          const result: BrowserReadAnswer = { id, ok: true, page: await browsers.read(botId) }
          browsers.noteRead(botId)
          return result
        } catch (error) {
          return { id, ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      })()
      answered.set(id, job)
      if (answered.size > 200) {
        const oldest = answered.keys().next().value
        if (oldest !== undefined) answered.delete(oldest)
      }
    }
    await post('browser-result', await job).catch(error => console.warn('[ds-bot] browser result', error))
  }
  const loop = async (): Promise<void> => {
    let failures = 0
    while (!stopped) {
      const controller = new AbortController()
      poll = controller
      const open = browsers.openPages()
      reported = JSON.stringify(open)
      try {
        const requests = await post<readonly BrowserReadRequest[]>('browser-wait', { clientId, open }, controller.signal)
        failures = 0
        for (const request of Array.isArray(requests) ? requests : []) void answer(request)
      } catch {
        if (stopped) return
        if (controller.signal.aborted) continue
        failures += 1
        await sleep(Math.min(30_000, retryMs * 2 ** Math.min(failures, 5)))
      }
    }
  }
  const offPages = browsers.pages.subscribe(() => {
    if (JSON.stringify(browsers.openPages()) !== reported) poll?.abort()
  })
  void loop()
  return () => {
    stopped = true
    offPages()
    poll?.abort()
  }
}

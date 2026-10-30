// The window talks only to Moon Bot's own channel: POST api/bot for reads and actions
// (the Bot views' own `call`), and the live feed api/bot/feed for what changes.
const RETRY_MS: readonly number[] = [500, 1000, 2000, 5000]

export interface FeedEvent {
  readonly event: string
  readonly data: Record<string, unknown>
}

export type FeedListener = (event: string, data: Record<string, unknown>) => void

interface ParsedEvent {
  readonly event: string
  readonly data: unknown
}

const parseEvent = (block: string): ParsedEvent | undefined => {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7)
    else if (line.startsWith('data: ')) data.push(line.slice(6))
  }
  if (data.length === 0) return undefined
  try {
    return { event, data: JSON.parse(data.join('\n')) as unknown }
  } catch {
    return undefined
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

// Read over fetch: EventSource does not load from the window's own scheme. After a
// break the feed reconnects, and its first event (`hello`) tells the window to catch up.
export function openFeed(onEvent: FeedListener): () => void {
  let stopped = false
  let controller: AbortController | undefined
  const run = async (): Promise<void> => {
    let failures = 0
    while (!stopped) {
      controller = new AbortController()
      try {
        const response = await fetch('api/bot/feed', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok || response.body === null) throw new Error(`HTTP ${String(response.status)}`)
        failures = 0
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const parsed = parseEvent(buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
            if (parsed !== undefined) onEvent(parsed.event, asRecord(parsed.data))
          }
        }
        buffer += decoder.decode()
        if (buffer.length > 0) {
          const parsed = parseEvent(buffer)
          if (parsed !== undefined) onEvent(parsed.event, asRecord(parsed.data))
        }
      } catch {
        // The service restarted or the window is going away; the loop decides.
      }
      if (stopped) return
      onEvent('lost', {})
      await new Promise(resolve => setTimeout(resolve, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 5000))
      failures += 1
    }
  }
  void run()
  return () => {
    stopped = true
    controller?.abort()
  }
}

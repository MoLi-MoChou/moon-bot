// The stdio <-> WebSocket bridge (plan §接入 CLI, "帧即行"): one JSON-RPC message
// per line on the agent side, one text frame per message on the relay side. The
// bridge never parses the traffic — the relay is blind, and so is this pipe.

/** Splits a stream into trimmed non-empty lines; a torn tail stays buffered. */
export class LineSplitter {
  private buffer = ''

  feed(chunk: string): readonly string[] {
    this.buffer += chunk
    const lines: string[] = []
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (line !== '') lines.push(line)
    }
    return lines
  }
}

/** The relay URL with the invite token as its "token" query parameter. */
export function buildRelayUrl(url: string, token: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(url)
  } catch {
    throw new Error(`--url is not a valid URL: ${url}`)
  }
  if (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') {
    throw new Error(`--url must be a ws:// or wss:// endpoint, got "${endpoint.protocol}"`)
  }
  endpoint.searchParams.set('token', token)
  return endpoint.toString()
}

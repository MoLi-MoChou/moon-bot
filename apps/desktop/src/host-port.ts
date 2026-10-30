// The window's origin is the Host's loopback address, and the page keeps its storage (unread
// marks, layout, preferences) per origin, so the Host listens on the same port at every start.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'

const free = (port: number): Promise<number | undefined> =>
  new Promise(resolve => {
    const server = createServer()
    server.once('error', () => {
      resolve(undefined)
    })
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : undefined
      server.close(() => {
        resolve(bound)
      })
    })
  })

const saved = (file: string): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const port =
      typeof parsed === 'object' && parsed !== null ? (parsed as { readonly port?: unknown }).port : undefined
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
  } catch {
    return undefined
  }
}

/**
 * The port saved in `file` while it is free, otherwise a new free one, which is saved.
 */
export async function hostPort(file: string): Promise<number> {
  const kept = saved(file)
  const port = (kept === undefined ? undefined : await free(kept)) ?? (await free(0))
  if (port === undefined) throw new Error('Moon Bot: no free port on 127.0.0.1')
  if (port !== kept) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ port })}\n`)
  }
  return port
}

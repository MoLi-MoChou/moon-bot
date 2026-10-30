// Moon Bot web mode: the same service and UI, served to a normal browser without Electron.
//
//   MOON_BOT_PASSWORD=… node src/web.ts     (pnpm run web)
//
// The service listens on a loopback port and serves the window's UI and the Bot channel from
// one origin. This process listens on MOON_BOT_WEB_HOST:MOON_BOT_WEB_PORT (default
// 127.0.0.1:8290) and puts a password page in front of it: the password is exchanged for the
// service's signed cookie, which authenticates every later request. Without a password the
// page is skipped on loopback only; on any other address the app refuses to start.
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startService } from 'moon-bot-core/service'
import { loginPage } from './web-login.ts'

const here = dirname(fileURLToPath(import.meta.url))
const env = process.env
// MOON_BOT_* settings; the MOCHOU_* and DSH_BOT_* names from before the renames still work.
const setting = (name: string): string | undefined => env[`MOON_BOT_${name}`] ?? env[`MOCHOU_${name}`] ?? env[`DSH_BOT_${name}`]
// New installs keep their data in ~/.moon-bot; one made before a rename keeps its
// ~/.mochou or ~/.dsh-bot.
const defaultData = (): string => {
  const fresh = join(homedir(), '.moon-bot')
  if (existsSync(fresh)) return fresh
  return [join(homedir(), '.mochou'), join(homedir(), '.dsh-bot')].find(dir => existsSync(dir)) ?? fresh
}
const dataDir = setting('DATA') ?? defaultData()
const bind = setting('WEB_HOST') ?? '127.0.0.1'
const port = Number(setting('WEB_PORT') ?? 8290)
const password = setting('PASSWORD') ?? ''
const loopback = ['127.0.0.1', '::1', 'localhost'].includes(bind)
if (!password && !loopback) {
  console.error('moon-bot web: set MOON_BOT_PASSWORD to listen on a non-loopback address.')
  process.exit(1)
}

const digest = (value: string): Buffer => createHash('sha256').update(String(value)).digest()
const passwordOk = (value: string): boolean => password !== '' && timingSafeEqual(digest(value), digest(password))

// Slow down guessing: per client address, at most 5 wrong tries per 10 minutes.
const failures = new Map<string, number[]>()
const blocked = (ip: string): boolean => {
  const now = Date.now()
  const recent = (failures.get(ip) ?? []).filter(at => now - at < 10 * 60_000)
  failures.set(ip, recent)
  return recent.length >= 5
}

async function main(): Promise<void> {
  const uiDir = setting('UI') ?? join(here, '..', 'ui', 'dist')
  // The service checks its own cookie; this page only hands that cookie out after the password.
  const service = await startService({
    home: dataDir,
    ...(password !== '' ? { password } : {}),
    ...(existsSync(uiDir) ? { uiDir } : {}),
    host: '127.0.0.1',
    port: 0,
  })
  const target = new URL(service.url)
  const local = `${target.hostname}:${target.port}`

  // The service accepts requests from its own loopback origin. A request from this page (its
  // Origin is the address the browser used) is passed on as from the service's origin; any
  // other origin is refused here, so the service's cross-site protection still holds.
  const upstreamHeaders = (req: IncomingMessage): Record<string, string | string[] | undefined> | undefined => {
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return undefined
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: local }
    if (origin !== undefined) headers.origin = target.origin
    if (typeof req.headers.referer === 'string' && /^https?:\/\//.test(req.headers.referer)) {
      const ref = new URL(req.headers.referer)
      headers.referer = `${target.origin}${ref.pathname}${ref.search}`
    }
    return headers
  }

  const forward = (req: IncomingMessage, res: ServerResponse): void => {
    const headers = upstreamHeaders(req)
    if (headers === undefined) { res.writeHead(403).end('Cross-origin request refused'); return }
    const upstream = httpRequest({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, (answer) => {
      // An unauthenticated page load gets the password page instead of the service's bare 401.
      if (answer.statusCode === 401 && req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
        answer.resume()
        res.writeHead(302, { location: '/login' }).end()
        return
      }
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end('Host unavailable') })
    req.pipe(upstream)
  }

  // Sign in through the service, so that the browser gets the cookie the service itself checks.
  const exchange = (given: string): Promise<{ cookie?: string[] | undefined; wait: boolean }> => new Promise((resolve) => {
    const body = JSON.stringify({ password: given })
    const call = httpRequest({
      hostname: target.hostname, port: target.port, method: 'POST', path: '/login',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (answer) => {
      answer.resume()
      resolve({ cookie: answer.headers['set-cookie'], wait: answer.statusCode === 429 })
    })
    call.on('error', () => resolve({ wait: false }))
    call.end(body)
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/login' && req.method === 'GET') {
      if (!password) { res.writeHead(302, { location: '/' }).end(); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(loginPage({ error: url.searchParams.has('wrong'), wait: url.searchParams.has('wait') }))
      return
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress ?? '?'
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk; if (body.length > 4096) req.destroy() })
      req.on('end', () => {
        if (blocked(ip)) { res.writeHead(303, { location: '/login?wait' }).end(); return }
        const given = new URLSearchParams(body).get('password') ?? ''
        if (!passwordOk(given)) { failures.get(ip)?.push(Date.now()); res.writeHead(303, { location: '/login?wrong' }).end(); return }
        failures.delete(ip)
        void exchange(given).then(({ cookie, wait }) => {
          if (cookie === undefined) { res.writeHead(303, { location: wait ? '/login?wait' : '/login?wrong' }).end(); return }
          res.writeHead(303, { location: '/', 'set-cookie': cookie }).end()
        })
      })
      return
    }
    forward(req, res)
  })
  server.listen(port, bind, () => {
    console.log(`moon-bot web: http://${bind.includes(':') ? `[${bind}]` : bind}:${String(port)}/${password ? 'login' : ''}`)
  })
  const stop = async (): Promise<void> => { server.close(); await service.close().catch(() => {}); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

void main().catch((error: unknown) => { console.error(error); process.exit(1) })

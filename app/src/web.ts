// Moon Bot web mode: the same Host and UI, served to a normal browser without Electron.
//
//   MOON_BOT_PASSWORD=… node src/web.mjs     (npm run web)
//
// The Host listens on loopback only. This process listens on MOON_BOT_WEB_HOST:MOON_BOT_WEB_PORT
// (default 127.0.0.1:8290) and puts a password page in front of it: the right password is
// exchanged for the Host's launch token, which makes DSH mint its own signed session cookie;
// from then on DSH authenticates every request itself. Without a password set, the page
// is skipped only on loopback (a local `npm run web`); on any other address it refuses to start.
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash, timingSafeEqual } from 'node:crypto'
import { HostProcess } from './host-process.mjs'
import { PROFILE } from './profile.mjs'
import { loginPage } from './web-login.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const env = process.env
// MOON_BOT_* settings; the MOCHOU_* and DSH_BOT_* names from before the renames still work.
const setting = name => env[`MOON_BOT_${name}`] ?? env[`MOCHOU_${name}`] ?? env[`DSH_BOT_${name}`]
// New installs keep their data in ~/.moon-bot; one made before a rename keeps its
// ~/.mochou or ~/.dsh-bot.
const defaultData = () => {
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

const digest = value => createHash('sha256').update(String(value)).digest()
const passwordOk = value => password !== '' && timingSafeEqual(digest(value), digest(password))

// Slow down guessing: per client address, at most 5 wrong tries per 10 minutes.
const failures = new Map()
const blocked = (ip) => {
  const now = Date.now()
  const recent = (failures.get(ip) ?? []).filter(at => now - at < 10 * 60_000)
  failures.set(ip, recent)
  return recent.length >= 5
}

async function main() {
  const profileDir = join(dataDir, 'profiles', PROFILE)
  mkdirSync(profileDir, { recursive: true })
  const pnpm = join(here, '..', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  const host = new HostProcess({
    entry: join(here, 'host.mjs'), cwd: profileDir, pnpm,
    // The access password stays in this process; the Host never sees it.
    env: { ...Object.fromEntries(Object.entries(env).filter(([name]) => !['MOON_BOT_PASSWORD', 'MOCHOU_PASSWORD', 'DSH_BOT_PASSWORD'].includes(name))), DSH_HOME: dataDir, DS_BOT_PORT: setting('HOST_PORT') ?? '0', DS_BOT_WEB: '1', ...(setting('WORKSPACE') ? { DS_BOT_WORKSPACE: setting('WORKSPACE') } : {}) },
    onFailure: (error) => { console.error(`moon-bot web: the Host stopped: ${error.message}`); process.exit(1) },
  })
  const ready = await host.start()
  const launch = new URL(ready.url)
  const token = launch.searchParams.get('token')
  const target = { host: launch.hostname, port: Number(launch.port) }

  // DSH accepts only its own loopback origin. A request from this page (its Origin is the
  // address the browser used) is passed on as from DSH's origin; any other origin is refused
  // here, so DSH's cross-site protection still holds.
  const local = `${target.host.includes(':') ? `[${target.host}]` : target.host}:${String(target.port)}`
  const upstreamHeaders = (req) => {
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return undefined
    const headers = { ...req.headers, host: local }
    if (origin !== undefined) headers.origin = `http://${local}`
    if (typeof req.headers.referer === 'string' && req.headers.host && /^https?:\/\//.test(req.headers.referer)) {
      const ref = new URL(req.headers.referer)
      if (ref.host === req.headers.host) headers.referer = `http://${local}${ref.pathname}${ref.search}`
    }
    return headers
  }

  const forward = (req, res) => {
    const headers = upstreamHeaders(req)
    if (headers === undefined) { res.writeHead(403).end('Cross-origin request refused'); return }
    const upstream = httpRequest({ ...target, method: req.method, path: req.url, headers }, (answer) => {
      // An unauthenticated page load gets the password page instead of DSH's bare 401.
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/login' && req.method === 'GET') {
      if (!password) { res.writeHead(302, { location: `/?token=${token}` }).end(); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(loginPage({ error: url.searchParams.has('wrong'), wait: url.searchParams.has('wait') }))
      return
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress ?? '?'
      let body = ''
      req.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy() })
      req.on('end', () => {
        if (blocked(ip)) { res.writeHead(303, { location: '/login?wait' }).end(); return }
        const given = new URLSearchParams(body).get('password') ?? ''
        if (!passwordOk(given)) { failures.get(ip).push(Date.now()); res.writeHead(303, { location: '/login?wrong' }).end(); return }
        failures.delete(ip)
        // DSH exchanges the launch token for its signed cookie and redirects to a clean URL.
        res.writeHead(303, { location: `/?token=${token}` }).end()
      })
      return
    }
    // The token is only handed out after the password; a guessed ?token= still has to match.
    forward(req, res)
  })
  // WebSockets (DSH's live connection) go straight through; DSH checks the cookie.
  server.on('upgrade', (req, socket, head) => {
    const headers = upstreamHeaders(req)
    if (headers === undefined) { socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n'); return }
    const upstream = connect(target.port, target.host, () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(item => `${k}: ${item}`)).join('\r\n')}\r\n\r\n`)
      if (head?.length) upstream.write(head)
      upstream.pipe(socket).pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  server.listen(port, bind, () => {
    console.log(`moon-bot web: http://${bind.includes(':') ? `[${bind}]` : bind}:${port}/${password ? 'login' : `login (no password: loopback only)`}`)
  })
  const stop = async () => { server.close(); await host.stop().catch(() => {}); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((error) => { console.error(error); process.exit(1) })

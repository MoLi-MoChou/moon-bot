// The standalone service (plan §阶段 3): Fastify serving what the desktop window and a
// browser both speak — POST api/bot (the RPC channel) and GET api/bot/feed (the live
// SSE feed), both captured from the host modules — with the password gate the old web
// proxy had (timing-safe compare, per-address throttling, loopback may skip it), and
// the built UI assets from a directory when one is given.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { wireService } from './engine.ts'
import { FileCredentials } from './credentials.ts'
import { FileSettings } from './settings.ts'
import { StandaloneLlm } from './llm.ts'
import { ModelsDevSync } from './models-dev.ts'
import { RELAY_CLOSE_UNAUTHORIZED } from './relay.ts'
import type { FetchRoute } from './context.ts'

/** The relay's WebSocket endpoint; remote agents dial in here with an invite token. */
const RELAY_PATH = '/api/bot/relay'

export interface ServiceOptions {
  /** The team home directory (state.json, store.sqlite3 live under it). */
  readonly home: string
  /** The access password; empty means loopback-only, as the old web mode ruled. */
  readonly password?: string | undefined
  /** A directory of built UI assets to serve at / (the app's vite output). */
  readonly uiDir?: string | undefined
  /** Bind address and port; defaults match the old web mode. */
  readonly host?: string | undefined
  readonly port?: number | undefined
  readonly logger?: boolean | undefined
}

/** The cookie's signed session token: `id.mac`, both hex. */
const sign = (secret: Buffer, id: string): string =>
  `${id}.${createHash('sha256')
    .update(`${id}:${secret.toString('hex')}`)
    .digest('hex')
    .slice(0, 32)}`

const verify = (secret: Buffer, cookie: string | undefined): boolean => {
  if (cookie === undefined) return false
  const [id, mac] = cookie.split('.')
  if (id === undefined || mac === undefined) return false
  const expected = createHash('sha256')
    .update(`${id}:${secret.toString('hex')}`)
    .digest('hex')
    .slice(0, 32)
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
}

const passwordMatches = (given: string, password: string): boolean => {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(password).digest()
  return timingSafeEqual(a, b)
}

export interface StandaloneService {
  readonly url: string
  close(): Promise<void>
}

/** Builds and boots the standalone service. The host modules run in-process. */
export async function startService(options: ServiceOptions): Promise<StandaloneService> {
  const password = options.password ?? ''
  const host = options.host ?? '127.0.0.1'
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host)
  if (password === '' && !loopback) throw new Error('a non-loopback bind needs a password')

  // The full stack: host runtime + SQLite store + engine + bridge, with the
  // standalone settings, credentials and provider routes under it.
  const settings = new FileSettings(options.home)
  const credentials = new FileCredentials(options.home)
  const llm = new StandaloneLlm(settings, credentials)
  const devSync = new ModelsDevSync(options.home)
  void devSync.sync()
  const wired = wireService({
    home: options.home,
    llm,
    services: { settings, credentials },
  })
  const context = wired.context

  const app = Fastify({ logger: options.logger === true })
  await app.register((await import('@fastify/cookie')).default)
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(typeof body === 'string' ? body : String(body))
      done(null, Object.fromEntries(params.entries()))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  const secret = randomBytes(32)

  // Throttled password guessing, per client address, as the old proxy had it.
  const failures = new Map<string, number[]>()
  const blocked = (ip: string): boolean => {
    const now = Date.now()
    const recent = (failures.get(ip) ?? []).filter(at => now - at < 10 * 60_000)
    failures.set(ip, recent)
    return recent.length >= 5
  }

  const authenticated = (request: FastifyRequest): boolean => {
    if (password === '') return true
    const cookie = request.headers?.cookie
    const value = Array.isArray(cookie) ? cookie.join('; ') : cookie
    const token = value
      ?.split(';')
      .map(part => part.trim())
      .find(part => part.startsWith('mb-session='))
    return verify(secret, token?.slice('mb-session='.length))
  }

  const route = (path: string): FetchRoute | undefined => context.routeOf(path)
  const apiRoute = route('/api/bot')
  const feedRoute = route('/api/bot/feed')

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url
    // The relay authenticates with its own invite token, not the UI cookie.
    if (path === '/login' || path === '/login/check' || path === '/healthz' || path === RELAY_PATH) return
    if (!authenticated(request)) {
      const accept = String(request.headers.accept ?? '')
      if (request.method === 'GET' && accept.includes('text/html')) {
        await reply.redirect('/login')
        return
      }
      await reply.code(401).send({ ok: false, error: { code: 'bot/unavailable', message: 'authentication required' } })
    }
  })

  // The commit this build came from, when the image or the caller names one: a deploy can
  // prove what is running without opening a shell (plan 阶段 A).
  // The image's own file wins over the environment: a container recreated from another
  // one inherits its env, and an inherited MOON_BOT_REVISION then reports the old commit
  // for the new code. The file is written by the build that produced this image.
  const revision = (): string | undefined => {
    try {
      const built = readFileSync('/opt/moon-bot/REVISION', 'utf8').trim()
      if (built !== '') return built
    } catch {
      /* not an image build: fall through to the environment */
    }
    const named = process.env.MOON_BOT_REVISION?.trim()
    return named === undefined || named === '' ? undefined : named
  }
  app.get('/healthz', async () => ({ ok: true, ...(revision() === undefined ? {} : { revision: revision() }) }))

  // The remote-agent relay (2026-10-27 remote-agents): one WebSocket per connected
  // agent, carrying the ACP wire as text frames. Token in the query string; an invalid
  // or revoked token closes the socket with 4401 before anything is carried.
  await app.register((await import('@fastify/websocket')).default)
  app.get(RELAY_PATH, { websocket: true }, (socket, request) => {
    const query = request.query as Record<string, unknown>
    const token = String(query['token'] ?? '')
    if (wired.relay.admit(socket, token) === undefined) {
      socket.close(RELAY_CLOSE_UNAUTHORIZED, 'unknown or revoked invite')
      return
    }
  })

  // Password page for browsers (the desktop web.ts wrapper also has one; Docker runs this service directly).
  const loginHtml = (
    note: string,
  ): string => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moon Bot · 登录</title><style>
:root{color-scheme:light dark;--bg:#fcfafd;--glow:#efe6fa;--card:#fff;--ink:#2a2233;--ink2:rgba(42,34,51,.6);--line:rgba(70,45,110,.12);--accent:#8a6bd1;--btn:#8a6bd1;--btn-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#17131d;--glow:#2a2138;--card:#221c2b;--ink:#f1ecf7;--ink2:rgba(241,236,247,.6);--line:rgba(210,190,255,.14);--accent:#b9a3f5;--btn:#b9a3f5;--btn-ink:#1a1422}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 600px at 50% 20%,var(--glow),var(--bg));color:var(--ink);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
form{width:min(360px,92vw);background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:0 18px 48px -20px rgba(90,60,150,.35)}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:var(--ink2);font-size:13px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:999px;background:var(--btn);color:var(--btn-ink);font:inherit;font-weight:600;cursor:pointer}
.err{color:#e5484d;font-size:13px;margin-top:10px;min-height:1em}
</style></head><body><form method="post" action="/login">
<h1>Moon Bot</h1><p>输入访问密码 · Enter the access password</p>
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="访问密码">
<button type="submit">登录</button><div class="err" role="alert">${note}</div></form></body></html>`

  app.get('/login', async (request, reply) => {
    if (password === '') return await reply.redirect('/')
    const q = (request.query ?? {}) as { wrong?: string; wait?: string }
    const note =
      'wait' in q
        ? '尝试次数过多，请 10 分钟后再试。 Too many tries, wait 10 minutes.'
        : 'wrong' in q
          ? '密码不对。 Wrong password.'
          : ''
    return await reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(loginHtml(note))
  })

  // POST the password (JSON from the UI client, or form fields from this page), get the session cookie.
  app.post('/login', async (request: FastifyRequest<{ Body: { password?: unknown } }>, reply: FastifyReply) => {
    const ip = request.socket.remoteAddress ?? '?'
    const wantsHtml =
      String(request.headers.accept ?? '').includes('text/html') ||
      String(request.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')
    if (blocked(ip)) {
      if (wantsHtml) return await reply.redirect('/login?wait')
      return await reply
        .code(429)
        .send({ ok: false, error: { code: 'bot/refused', message: 'too many attempts; wait ten minutes' } })
    }
    const body = request.body as { password?: unknown } | undefined
    const given = String(body?.password ?? '')
    if (password === '' || !passwordMatches(given, password)) {
      failures.set(ip, [...(failures.get(ip) ?? []), Date.now()])
      if (wantsHtml) return await reply.redirect('/login?wrong')
      return await reply.code(403).send({ ok: false, error: { code: 'bot/refused', message: 'wrong password' } })
    }
    failures.delete(ip)
    const id = randomBytes(16).toString('hex')
    void reply.setCookie('mb-session', sign(secret, id), { httpOnly: true, sameSite: 'lax', path: '/' })
    if (wantsHtml) return await reply.redirect('/')
    return await reply.send({ ok: true })
  })

  if (apiRoute !== undefined) {
    app.post('/api/bot', async (request, reply) => {
      const response = await apiRoute.fetch(
        new Request(`http://service${request.url}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
        }),
      )
      return await reply
        .code(response.status)
        .type('application/json')
        .send(await response.text())
    })
  }

  // Open feed sockets, closed when the service stops so close() cannot hang on them.
  const feedSockets = new Set<{ destroy(): void }>()
  if (feedRoute !== undefined) {
    app.get('/api/bot/feed', (request, reply) => {
      feedSockets.add(request.raw)
      request.raw.on('close', () => {
        feedSockets.delete(request.raw)
      })
      void feedRoute
        .fetch(new Request('http://service/api/bot/feed'))
        .then(async response => {
          reply.raw.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          })
          if (response.body === null) {
            reply.raw.end()
            return
          }
          const reader = response.body.getReader()
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            reply.raw.write(value)
          }
          reply.raw.end()
        })
        .catch(() => {
          if (!reply.raw.headersSent) reply.raw.writeHead(502).end()
        })
      return reply
    })
  }

  if (options.uiDir !== undefined && existsSync(options.uiDir)) {
    const { default: fastifyStatic } = await import('@fastify/static')
    await app.register(fastifyStatic, {
      root: isAbsolute(options.uiDir) ? options.uiDir : resolve(options.uiDir),
      prefix: '/',
    })
  }

  const address = await app.listen({ host, port: options.port ?? 0 })
  return {
    url: address,
    close: async () => {
      for (const socket of feedSockets) socket.destroy()
      await app.close()
      await wired.close()
    },
  }
}

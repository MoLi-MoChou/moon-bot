// The standalone service (plan §阶段 3): Fastify serving what the desktop window and a
// browser both speak — POST api/bot (the RPC channel) and GET api/bot/feed (the live
// SSE feed), both captured from the host modules — with the password gate the old web
// proxy had (timing-safe compare, per-address throttling, loopback may skip it), and
// the built UI assets from a directory when one is given.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { wireService } from './engine.ts'
import { FileCredentials } from './credentials.ts'
import { FileSettings } from './settings.ts'
import { StandaloneLlm } from './llm.ts'
import type { FetchRoute } from './context.ts'

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
const sign = (secret: Buffer, id: string): string => `${id}.${createHash('sha256').update(`${id}:${secret.toString('hex')}`).digest('hex').slice(0, 32)}`

const verify = (secret: Buffer, cookie: string | undefined): boolean => {
  if (cookie === undefined) return false
  const [id, mac] = cookie.split('.')
  if (id === undefined || mac === undefined) return false
  const expected = createHash('sha256').update(`${id}:${secret.toString('hex')}`).digest('hex').slice(0, 32)
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
  const wired = wireService({
    home: options.home,
    llm,
    services: { settings, credentials },
  })
  const context = wired.context

  const app = Fastify({ logger: options.logger === true })
  await app.register((await import('@fastify/cookie')).default)
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
    const token = value?.split(';').map(part => part.trim()).find(part => part.startsWith('mb-session='))
    return verify(secret, token?.slice('mb-session='.length))
  }

  const route = (path: string): FetchRoute | undefined => context.routeOf(path)
  const apiRoute = route('/api/bot')
  const feedRoute = route('/api/bot/feed')

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url
    if (path === '/login' || path === '/login/check' || path === '/healthz') return
    if (!authenticated(request)) {
      await reply.code(401).send({ ok: false, error: { code: 'bot/unavailable', message: 'authentication required' } })
    }
  })

  app.get('/healthz', async () => ({ ok: true }))

  // The password page the old web mode had: POST the password, get the session cookie.
  app.post('/login', async (request: FastifyRequest<{ Body: { password?: unknown } }>, reply: FastifyReply) => {
    const ip = request.socket.remoteAddress ?? '?'
    if (blocked(ip)) return await reply.code(429).send({ ok: false, error: { code: 'bot/refused', message: 'too many attempts; wait ten minutes' } })
    const given = String((request.body as { password?: unknown } | undefined)?.password ?? '')
    if (password === '' || !passwordMatches(given, password)) {
      failures.set(ip, [...(failures.get(ip) ?? []), Date.now()])
      return await reply.code(403).send({ ok: false, error: { code: 'bot/refused', message: 'wrong password' } })
    }
    failures.delete(ip)
    const id = randomBytes(16).toString('hex')
    return await reply.setCookie('mb-session', sign(secret, id), { httpOnly: true, sameSite: 'lax', path: '/' }).send({ ok: true })
  })

  if (apiRoute !== undefined) {
    app.post('/api/bot', async (request, reply) => {
      const response = await apiRoute.fetch(new Request(`http://service${request.url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body ?? {}),
      }))
      return await reply.code(response.status).type('application/json').send(await response.text())
    })
  }

  // Open feed sockets, closed when the service stops so close() cannot hang on them.
  const feedSockets = new Set<{ destroy(): void }>()
  if (feedRoute !== undefined) {
    app.get('/api/bot/feed', (request, reply) => {
      feedSockets.add(request.raw)
      request.raw.on('close', () => { feedSockets.delete(request.raw) })
      void feedRoute.fetch(new Request('http://service/api/bot/feed'))
        .then(async response => {
          reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
          if (response.body === null) { reply.raw.end(); return }
          const reader = response.body.getReader()
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            reply.raw.write(value)
          }
            reply.raw.end()
        })
        .catch(() => { if (!reply.raw.headersSent) reply.raw.writeHead(502).end() })
      return reply
    })
  }

  if (options.uiDir !== undefined && existsSync(options.uiDir)) {
    const { default: fastifyStatic } = await import('@fastify/static')
    await app.register(fastifyStatic, { root: isAbsolute(options.uiDir) ? options.uiDir : resolve(options.uiDir), prefix: '/' })
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

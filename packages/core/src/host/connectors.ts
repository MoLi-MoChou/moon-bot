import type { HostRuntime } from './runtime.js'
import { createStandaloneMounts } from './capabilities-standalone.ts'
import {
  backoffFor,
  classifyFailure,
  fingerprintOf,
  retryableByItself,
  type ConnectorHealth,
  type ConnectorState,
} from './connector-health.ts'

interface ConnectorMount {
  readonly token: string | undefined
  readonly fingerprint: string
}

interface SignInOptions {
  readonly api?: string
  readonly fetch?: typeof fetch
}

interface ConnectorBody {
  readonly id?: unknown
  readonly token?: unknown
}

type ConnectorEndpoint = (body: ConnectorBody) => Promise<unknown>

// Connectors: outside services every Bot can use. GitHub is the first one. Its tools come
// from GitHub's MCP server through the host's own MCP client, mounted on the plugin context,
// so every Bot and Session gets them as mcp__github__<tool>.
//
// The token is the GITHUB_TOKEN secret (secrets.js keeps it, redacts it, and offers it to
// the shell). It reaches GitHub only in the MCP request headers, built here in memory,
// never written to the host profile. A new token is shared with no Bot's shell: the tools
// do not need it there, and a Bot that reads a planted instruction in an issue could
// send it anywhere. The Secrets page can still share it. Signing in is `signIn` alone, so a browser login can
// take its place later without touching the mount.

export const GITHUB = 'github'
export const GITHUB_SECRET = 'GITHUB_TOKEN'
const DEFAULTS = {
  url: 'https://api.githubcopilot.com/mcp/',
  api: 'https://api.github.com',
  toolsets: 'context,repos,issues,pull_requests',
}
const CHECK_TIMEOUT_MS = 15_000
const INSECURE = 'GitHub addresses must start with https://'

// Asks GitHub who the token belongs to. Any token GitHub accepts passes.
export async function signIn(
  token: string,
  { api = DEFAULTS.api, fetch: request = fetch }: SignInOptions = {},
): Promise<{ readonly login: string }> {
  let response
  try {
    response = await request(`${api.replace(/\/$/, '')}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'moon-bot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Could not reach GitHub')
  }
  if (response.status === 401) throw new Error('GitHub did not accept this token')
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const user = (await response.json().catch(() => ({}))) as { readonly login?: unknown } | null
  if (typeof user?.login !== 'string') throw new Error('GitHub did not say who this token belongs to')
  return { login: user.login }
}

export function install(rt: HostRuntime): void {
  const { ctx, state } = rt
  const options = rt.config.github === false ? null : { ...DEFAULTS, ...rt.config.github }
  const insecure = options !== null && [options.url, options.api].some(address => !/^https:\/\//i.test(String(address)))
  // `token` is what the current mount was made with, so a changed secret mounts again.
  let mount: ConnectorMount | null = null
  // A connector starts off, with no failure to explain; the fingerprint arrives with the
  // first reconcile and must not itself count as a change the window has to redraw.
  let health: ConnectorHealth = { state: 'off' }
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const setHealth = (next: ConnectorHealth): void => {
    // Every field the view shows takes part in "unchanged"; a retry time or an error time
    // that moved is a change even when the state name stayed the same.
    const same = (Object.keys(next) as (keyof ConnectorHealth)[]).every(key => health[key] === next[key])
    if (same) return
    health = { ...health, ...next }
    rt.liveChanged?.()
  }
  // Nothing is left to explain when a connector is off, so the failure fields go with it.
  // It still counts as a change only when something actually differed.
  const offHealth = (fingerprint: string | undefined): void => {
    const wasOff = health.state === 'off' && health.lastError === undefined
    // A connector that is already off, with nothing to explain, only learns its fingerprint
    // here; that is bookkeeping, not a state the window has to redraw.
    if (wasOff) {
      health = { state: 'off', ...(fingerprint === undefined ? {} : { fingerprint }) }
      return
    }
    health = { state: 'off', ...(fingerprint === undefined ? {} : { fingerprint }) }
    rt.liveChanged?.()
  }
  let queue: Promise<unknown> = Promise.resolve()
  let stopped = false

  let githubUnmount: (() => void) | undefined
  const unmount = async (): Promise<void> => {
    githubUnmount?.()
    githubUnmount = undefined
    mount = null
  }

  function clearRetry(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = undefined
  }

  // A transport failure may clear on its own; a rejected token may not. Only the first gets
  // a retry time, and the timer never runs after the connector was stopped or the token
  // changed.
  function retryAtFor(failure: ReturnType<typeof classifyFailure>): number | undefined {
    if (stopped || !retryableByItself(failure)) {
      failures = 0
      return undefined
    }
    failures += 1
    return backoffFor(failures, Date.now())
  }

  function scheduleRetry(at: number | undefined): void {
    clearRetry()
    if (at === undefined) return
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined
        void sync(true)
      },
      Math.max(0, at - Date.now()),
    )
    // A retry timer must not hold the service open on its own.
    retryTimer.unref?.()
  }

  async function reconcile(force: boolean): Promise<void> {
    const token = options !== null && !stopped ? rt.secretValue(GITHUB_SECRET) : undefined
    const fingerprint = fingerprintOf({ id: GITHUB, transport: 'streamable-http', url: options?.url, secret: 'set' })
    // The same token and the same configuration means the mount is still the right one.
    if (!force && mount !== null && mount.token === token && mount.fingerprint === fingerprint) return
    clearRetry()
    await unmount()
    if (token === undefined) {
      // Off means nothing is left to explain: a disconnect must not keep the previous
      // failure's text, times or retry promise on screen.
      failures = 0
      offHealth(fingerprint)
      return
    }
    if (options === null) {
      failures = 0
      offHealth(fingerprint)
      return
    }
    if (insecure) {
      mount = { token, fingerprint }
      setHealth({ state: 'error', lastError: INSECURE, lastErrorAt: Date.now(), fingerprint })
      return
    }
    setHealth({ state: 'connecting', fingerprint })
    // GitHub's MCP server becomes one of our connectors: its tools join the tool
    // registry like every connector's, and the policy sees them L3. The token rides
    // the request headers only — never a file, never a Bot's shell.
    try {
      const unmountGithub = await createStandaloneMounts(rt.toolRegistry).mount(GITHUB, {
        transport: 'streamable-http',
        serverName: GITHUB,
        url: options.url,
        headers: { Authorization: `Bearer ${token}`, 'X-MCP-Toolsets': options.toolsets },
      })
      mount = { token, fingerprint }
      githubUnmount = unmountGithub
      failures = 0
      setHealth({ state: 'ready', lastOkAt: Date.now(), fingerprint })
    } catch (error) {
      githubUnmount?.()
      githubUnmount = undefined
      mount = { token, fingerprint }
      const failure = classifyFailure(error)
      const message = rt.redactSecrets(failure.message).slice(0, 300)
      // The retry time is part of the same change as the failure, so the window is told
      // once: a second notification for the same failure would read as a second failure.
      const retry = retryAtFor(failure)
      setHealth({
        state: failure.state as ConnectorState,
        lastError: message,
        lastErrorAt: Date.now(),
        fingerprint,
        ...(retry === undefined ? {} : { retryAt: retry }),
      })
      rt.warn('moon-bot: GitHub connector failed: %s', message)
      scheduleRetry(retry)
    }
  }

  // One change at a time; `force` connects again even when the token is the same.
  const sync = (force = false): Promise<unknown> => {
    queue = queue
      .then(() => reconcile(force))
      .catch((error: unknown) => {
        rt.warn('moon-bot: connectors: %s', rt.redactSecrets(classifyFailure(error).message).slice(0, 300))
      })
    return queue
  }

  const connectorsView = (): readonly Record<string, unknown>[] =>
    options === null
      ? []
      : [
          {
            id: GITHUB,
            name: 'GitHub',
            state: health.state,
            ...(health.lastError !== undefined ? { error: health.lastError } : {}),
            ...(health.lastErrorAt !== undefined ? { lastErrorAt: health.lastErrorAt } : {}),
            ...(health.lastOkAt !== undefined ? { lastOkAt: health.lastOkAt } : {}),
            ...(health.retryAt !== undefined ? { retryAt: health.retryAt } : {}),
            ...(health.fingerprint !== undefined ? { fingerprint: health.fingerprint } : {}),
            account: rt.secretValue(GITHUB_SECRET) !== undefined ? (state.connectors?.[GITHUB]?.login ?? null) : null,
          },
        ]

  const known = (id: unknown): void => {
    if (options === null || id !== GITHUB) throw new Error('No such connector')
  }

  const endpoints: Record<string, ConnectorEndpoint> = {
    async 'connector-connect'(body: ConnectorBody): Promise<unknown> {
      known(body.id)
      const settings = options
      if (settings === null) throw new Error('No such connector')
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (token === '') throw new Error('Paste a token first')
      if (insecure) throw new Error(INSECURE)
      await rt.loadSecrets()
      const kept = rt.secretValue(GITHUB_SECRET) !== undefined
      const { login } = await signIn(token, { api: settings.api })
      await rt.secretEndpoint('secret-set', {
        name: GITHUB_SECRET,
        value: token,
        purpose: 'GitHub connector',
        ...(kept ? {} : { scope: [] }),
      })
      state.connectors = { ...state.connectors, [GITHUB]: { login, connectedAt: Date.now() } }
      await rt.save()
      await sync()
      return connectorsView()
    },
    async 'connector-disconnect'(body: ConnectorBody): Promise<unknown> {
      known(body.id)
      await rt.loadSecrets()
      if (rt.secretValue(GITHUB_SECRET) !== undefined) await rt.secretEndpoint('secret-delete', { name: GITHUB_SECRET })
      if (state.connectors?.[GITHUB] !== undefined) {
        delete state.connectors[GITHUB]
        await rt.save()
      }
      await sync()
      return connectorsView()
    },
    async 'connector-retry'(body: ConnectorBody): Promise<unknown> {
      known(body.id)
      await rt.loadSecrets()
      await sync(true)
      return connectorsView()
    },
  }

  const connectorEndpoint = (endpoint: string, body: ConnectorBody | undefined): Promise<unknown> => {
    const handler = endpoints[endpoint]
    if (handler === undefined) throw new Error()
    return handler(body ?? {})
  }

  ctx.effect(() => {
    stopped = false
    void rt.loadSecrets().then(() => sync())
    return () => {
      stopped = true
      clearRetry()
      void unmount()
    }
  }, 'moon-bot: connectors')

  Object.assign(rt, {
    connectorsView,
    connectorEndpoint,
    secretsChanged: () => {
      void sync()
    },
  })
}

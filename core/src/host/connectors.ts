import type { HostRuntime } from './runtime.js'
import { createStandaloneMounts } from './capabilities-standalone.ts'

type ConnectorStatus =
  | { readonly state: 'off' }
  | { readonly state: 'connecting' }
  | { readonly state: 'ready' }
  | { readonly state: 'error'; readonly error: string }

interface ConnectorMount {
  readonly token: string | undefined
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
export async function signIn(token: string, { api = DEFAULTS.api, fetch: request = fetch }: SignInOptions = {}): Promise<{ readonly login: string }> {
  let response
  try {
    response = await request(`${api.replace(/\/$/, '')}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'moon-bot', 'X-GitHub-Api-Version': '2022-11-28' },
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
  let status: ConnectorStatus = { state: 'off' }
  const setStatus = (next: ConnectorStatus): void => {
    const sameError = status.state === 'error' && next.state === 'error' && status.error === next.error
    const sameNonError = status.state !== 'error' && next.state === status.state
    if (sameError || sameNonError) return
    status = next
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

  // The MCP client wraps the server's answer (a 401, say) as the cause.
  const reason = (error: unknown): string => {
    const text = [error, (error as { readonly cause?: unknown } | undefined)?.cause].filter(Boolean).map(part => String((part as { readonly message?: unknown } | undefined)?.message ?? part)).join(': ')
    return rt.redactSecrets(text || 'error').slice(0, 300)
  }

  async function reconcile(force: boolean): Promise<void> {
    const token = options !== null && !stopped ? rt.secretValue(GITHUB_SECRET) : undefined
    if (!force && mount !== null && mount.token === token) return
    await unmount()
    if (token === undefined) {
      setStatus({ state: 'off' })
      return
    }
    if (options === null) {
      setStatus({ state: 'off' })
      return
    }
    if (insecure) {
      mount = { token }
      setStatus({ state: 'error', error: INSECURE })
      return
    }
    setStatus({ state: 'connecting' })
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
      mount = { token }
      githubUnmount = unmountGithub
      setStatus({ state: 'ready' })
    } catch (error) {
      githubUnmount?.()
      githubUnmount = undefined
      mount = { token }
      const message = reason(error)
      setStatus({ state: 'error', error: message })
      rt.warn('moon-bot: GitHub connector failed: %s', message)
    }
  }

  // One change at a time; `force` connects again even when the token is the same.
  const sync = (force = false): Promise<unknown> => {
    queue = queue.then(() => reconcile(force)).catch((error: unknown) => { rt.warn('moon-bot: connectors: %s', reason(error)) })
    return queue
  }

  const connectorsView = (): readonly Record<string, unknown>[] => options === null ? [] : [{
    id: GITHUB,
    name: 'GitHub',
    state: status.state,
    ...(status.state === 'error' ? { error: status.error } : {}),
    account: rt.secretValue(GITHUB_SECRET) !== undefined ? state.connectors?.[GITHUB]?.login ?? null : null,
  }]

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
      await rt.secretEndpoint('secret-set', { name: GITHUB_SECRET, value: token, purpose: 'GitHub connector', ...(kept ? {} : { scope: [] }) })
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
      void unmount()
    }
  }, 'moon-bot: connectors')

  Object.assign(rt, { connectorsView, connectorEndpoint, secretsChanged: () => { void sync() } })
}

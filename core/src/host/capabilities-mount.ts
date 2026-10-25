// Mounting capabilities into a Session: an MCP server or a skill becomes a fiber on the
// Agent's own context, so it lives as long as that Session does and goes away with it.
// One reconcile chain per Agent: a slow MCP server holds up only its own Agent.
import { createHash } from 'node:crypto'
import type { Agent, DshContext, LoaderService, PluginFiber } from './dsh-types.js'
import { configFor } from './capabilities-config.ts'
import { createStandaloneMounts } from './capabilities-standalone.ts'
import { HostMounts } from './capabilities-host.ts'
import type { CapabilityItem, HostRuntime, StoredBot, StoredState } from './runtime.js'

const ENSURE_TIMEOUT_MS = 15_000

export type CapabilityState = 'error' | 'needs-approval' | 'connecting' | 'ready'

export interface CapabilityStatus {
  readonly state: CapabilityState
  readonly error?: string
}

interface MountRecord {
  readonly key: string
  readonly fiber: PluginFiber | undefined
  /** The standalone mount's own teardown (no DSH fiber involved). */
  readonly drop?: (() => void) | undefined
}

interface MountOptions {
  readonly ctx: DshContext
  readonly rt: HostRuntime
  readonly state: StoredState
  library(): Record<string, CapabilityItem>
  expand(names: readonly string[] | undefined): Set<string>
}

export interface CapabilityMounts {
  reconcile(): Promise<void>
  scheduleReconcile(): Promise<unknown>
  ensureCapabilities(sessionId: string): Promise<void>
  prepare(agent: Agent, sessionId: string): Promise<void>
  trackAgent(agent: Agent | undefined): void
  trackBotAgents(bot: StoredBot): Promise<void>
  statusFor(botId: string, name: string): CapabilityStatus | undefined
  statusesView(): Record<string, Record<string, CapabilityStatus>>
  /** The `rt.secretsChanged` hook: a secret changed, so re-out everything. */
  wrapSecretsChanged(previous: (() => void) | undefined): () => void
  dispose(): Promise<void>
}

type StatusMap = Map<string, Map<string, Map<string, CapabilityStatus>>>

export function createCapabilityMounts({ ctx, rt, state, library, expand }: MountOptions): CapabilityMounts {
  const agents = new Map<string, WeakRef<Agent>>()
  // Mounted fibers live in each Agent's own context, so they outlive this plugin unless
  // its cleanup disposes them; a strong map keeps them reachable for that.
  const mounts = new Map<Agent, Map<string, MountRecord>>()
  const chains = new WeakMap<Agent, Promise<void>>()
  const queued = new WeakSet<Agent>()
  const sessionStatuses: StatusMap = new Map()
  let scheduled: Promise<unknown> | null = null
  let loadingSecrets = 0
  let stopped = false

  const statusSet = (botId: string, itemName: string, sessionId: string, status: CapabilityStatus): void => {
    let byItem = sessionStatuses.get(botId)
    if (!byItem) sessionStatuses.set(botId, byItem = new Map())
    let bySession = byItem.get(itemName)
    if (!bySession) byItem.set(itemName, bySession = new Map())
    bySession.set(sessionId, status)
  }
  const clearStatus = (botId: string, itemName: string, sessionId: string): void => {
    const byItem = sessionStatuses.get(botId)
    const bySession = byItem?.get(itemName)
    bySession?.delete(sessionId)
    if (bySession?.size === 0) byItem?.delete(itemName)
    if (byItem?.size === 0) sessionStatuses.delete(botId)
  }
  const clearSession = (sessionId: string): void => {
    for (const [botId, byItem] of sessionStatuses) {
      for (const [name, bySession] of byItem) {
        bySession.delete(sessionId)
        if (bySession.size === 0) byItem.delete(name)
      }
      if (byItem.size === 0) sessionStatuses.delete(botId)
    }
  }
  const statusFor = (botId: string, name: string): CapabilityStatus | undefined => {
    const values = [...(sessionStatuses.get(botId)?.get(name)?.values() ?? [])]
    if (values.some(status => status.state === 'error')) return values.find(status => status.state === 'error')
    if (values.some(status => status.state === 'needs-approval')) return { state: 'needs-approval' }
    if (values.some(status => status.state === 'connecting')) return { state: 'connecting' }
    return values.length > 0 ? { state: 'ready' } : undefined
  }
  const statusesView = (): Record<string, Record<string, CapabilityStatus>> => {
    const result: Record<string, Record<string, CapabilityStatus>> = {}
    for (const bot of Object.values(state.bots)) {
      const statuses: Record<string, CapabilityStatus> = {}
      for (const name of bot.capabilities ?? []) {
        const item = library()[name]
        if (item === undefined) continue
        if (item.kind !== 'pack') {
          const status = statusFor(bot.id, name)
          if (status) statuses[name] = status
          continue
        }
        const children = (item.items ?? []).map(child => statusFor(bot.id, child)).filter((status): status is CapabilityStatus => status !== undefined)
        const status = children.find(item => item.state === 'error')
          ?? children.find(item => item.state === 'needs-approval')
          ?? children.find(item => item.state === 'connecting')
          ?? children[0]
        if (status) statuses[name] = status
      }
      result[bot.id] = statuses
    }
    return result
  }

  const disposeMount = async (mount: MountRecord | undefined): Promise<void> => {
    mount?.drop?.()
    const fiber = mount?.fiber
    if (fiber !== undefined) await Promise.resolve().then(() => fiber.dispose()).catch(() => {})
  }
  const mountOne = async (agent: Agent, bot: StoredBot | undefined, agentMounts: Map<string, MountRecord>, name: string): Promise<void> => {
    const botId = bot?.id ?? ''
    const sessionId = agent.session.id
    const item = library()[name]
    if (item === undefined) return
    const drop = async (): Promise<void> => {
      await disposeMount(agentMounts.get(name))
      agentMounts.delete(name)
    }
    if (item.kind === 'mcp' && item.transport === 'stdio' && item.approved !== true) {
      await drop()
      statusSet(botId, name, sessionId, { state: 'needs-approval' })
      return
    }
    let config: Record<string, unknown>
    try {
      config = configFor(rt, item, botId)
    } catch (error) {
      await drop()
      statusSet(botId, name, sessionId, { state: 'error', error: rt.redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300) })
      return
    }
    const key = `${name}:${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`
    if (agentMounts.get(name)?.key === key) return
    await drop()
    statusSet(botId, name, sessionId, { state: 'connecting' })
    try {
      // Standalone: no DSH plugin host, so an MCP server mounts through our own
      // connector into the tool registry the engine serves.
      if (agent.ctx?.plugin === undefined) {
        if (item.kind !== 'mcp') throw new Error('Skills need a DSH plugin host.')
        const drop = await standalone.mount(name, config)
        agentMounts.set(name, { key, fiber: undefined, drop })
        statusSet(botId, name, sessionId, { state: 'ready' })
        return
      }
      // Hosted: the capability becomes a fiber on the Agent's own context.
      const { fiber } = item.kind === 'skill' ? await hostMounts.skillMount(agent, name, config) : await hostMounts.mcpMount(agent, name, config)
      agentMounts.set(name, { key, fiber })
      if (stopped || agents.get(sessionId)?.deref() !== agent) return
      statusSet(botId, name, sessionId, { state: 'ready' })
    } catch (error) {
      await drop()
      const parts = [error, (error as { readonly cause?: unknown } | undefined)?.cause].filter(Boolean)
      const message = rt.redactSecrets(parts.map(part => String((part as { readonly message?: unknown } | undefined)?.message ?? part)).join(': ') || 'Connection failed').slice(0, 300)
      statusSet(botId, name, sessionId, { state: 'error', error: message })
    }
  }
  // The two mounts: a DSH-hosted fiber, or (standalone) our own connector.
  const standalone = createStandaloneMounts(rt.toolRegistry)
  const hostMounts = new HostMounts({ ctx })
  const hosted = (): boolean => typeof ctx.get<LoaderService>('loader')?.import === 'function'

  const reconcileAgent = async (agent: Agent, bot: StoredBot | undefined): Promise<void> => {
    const sessionId = agent.session.id
    const desired = bot ? expand(bot.capabilities) : new Set<string>()
    let agentMounts = mounts.get(agent)
    if (agentMounts === undefined) {
      agentMounts = new Map()
      if (desired.size > 0) mounts.set(agent, agentMounts)
    }
    if (bot) {
      for (const name of sessionStatuses.get(bot.id)?.keys() ?? []) {
        if (!desired.has(name)) clearStatus(bot.id, name, sessionId)
      }
    } else {
      clearSession(sessionId)
    }
    for (const [name, mount] of agentMounts) {
      if (desired.has(name)) continue
      await disposeMount(mount)
      agentMounts.delete(name)
    }
    await Promise.all([...desired].map(name => mountOne(agent, bot, agentMounts, name)))
    if (agentMounts.size === 0 && mounts.get(agent) === agentMounts) mounts.delete(agent)
  }
  const botOfSession = (sessionId: string): StoredBot | undefined => (rt.isBotSession(sessionId) ? rt.botOf(rt.selfOf(sessionId)) : undefined)
  // At most one run waits behind the running one; it reads the latest state when it starts.
  const reconcileOne = (agent: Agent): Promise<void> => {
    const running = chains.get(agent)
    if (queued.has(agent)) return running ?? Promise.resolve()
    queued.add(agent)
    const run: Promise<void> = (running ?? Promise.resolve()).then(async () => {
      queued.delete(agent)
      const sessionId = agent.session.id
      if (stopped || agents.get(sessionId)?.deref() !== agent) return
      await reconcileAgent(agent, botOfSession(sessionId))
    }).catch((error: unknown) => rt.warn('ds-bot: capability reconcile for %s failed: %s', agent.session?.id, error))
    chains.set(agent, run)
    return run
  }
  const loadInputs = async (): Promise<void> => {
    await rt.load()
    loadingSecrets += 1
    try {
      await rt.loadSecrets()
    } finally {
      loadingSecrets -= 1
    }
  }
  async function reconcile(): Promise<void> {
    if (stopped) return
    await loadInputs()
    const runs: Promise<void>[] = []
    for (const [sessionId, reference] of agents) {
      const agent = reference.deref()
      if (agent) {
        runs.push(reconcileOne(agent))
        continue
      }
      agents.delete(sessionId)
      clearSession(sessionId)
    }
    await Promise.all(runs)
  }
  const scheduleReconcile = (): Promise<unknown> => {
    if (!scheduled) {
      scheduled = new Promise<void>(resolve => queueMicrotask(() => {
        scheduled = null
        resolve(reconcile().catch(error => rt.warn('ds-bot: capability reconcile failed: %s', error)))
      }))
    }
    return scheduled
  }
  // A run that outlasts the limit goes on in the background, and later requests for the
  // same Agent do not wait for it again.
  const stalled = new WeakSet<Agent>()
  const prepare = async (agent: Agent, sessionId: string): Promise<void> => {
    const run = loadInputs().then(() => reconcileOne(agent)).then(() => true, (error: unknown) => {
      rt.warn('ds-bot: capability mount for %s failed: %s', sessionId, error)
      return true
    })
    if (stalled.has(agent)) return
    const timeoutMs = rt.capabilityEnsureTimeoutMs ?? ENSURE_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = await Promise.race([run, new Promise<boolean>(resolve => { timer = setTimeout(resolve, timeoutMs, false) })])
    if (timer !== undefined) clearTimeout(timer)
    if (completed) return
    stalled.add(agent)
    void run.then(() => stalled.delete(agent))
    rt.warn('ds-bot: capability mount for %s did not finish within %dms; continuing', sessionId, timeoutMs)
  }
  async function ensureCapabilities(sessionId: string): Promise<void> {
    await rt.load()
    const bot = botOfSession(sessionId)
    if (!bot) return
    const reference = agents.get(sessionId)
    if ((bot.capabilities ?? []).length === 0 && !(mounts.get(reference?.deref() as Agent)?.size)) return
    let agent: Agent
    try {
      agent = await rt.resolveAgent(sessionId)
    } catch (error) {
      rt.warn('ds-bot: capability Agent for %s could not be resolved: %s', sessionId, rt.redactSecrets(String(error)))
      return
    }
    trackAgent(agent)
    await prepare(agent, sessionId)
  }
  // Whether a DSH plugin host serves this process: standalone (no loader service), an
  // agent has no context at all and its capabilities mount through our connector.
  const trackAgent = (agent: Agent | undefined): void => {
    const sessionId = agent?.session?.id
    if (agent === undefined || typeof sessionId !== 'string') return
    // Hosted: an agent without a context is a placeholder the tests and the pre-DSH
    // path hand in; only a real one carries its own capabilities' lifetime.
    if (agent.ctx === undefined && hosted()) return
    if (agents.get(sessionId)?.deref() === agent) return
    agents.set(sessionId, new WeakRef(agent))
    agent.ctx?.effect?.(() => () => {
      if (agents.get(sessionId)?.deref() === agent) agents.delete(sessionId)
      clearSession(sessionId)
      for (const mount of mounts.get(agent)?.values() ?? []) void disposeMount(mount)
      mounts.delete(agent)
    }, `ds-bot: capabilities ${sessionId}`)
  }
  const trackBotAgents = async (bot: StoredBot): Promise<void> => {
    const sessionIds = new Set<string>()
    try {
      const sessionId = rt.chatOf(bot.id)
      if (typeof sessionId === 'string') sessionIds.add(sessionId)
    } catch (error) {
      rt.warn('ds-bot: capability chat session for %s could not be read: %s', bot.id, error)
    }
    try {
      for (const sessionId of rt.groupSessionsOf(bot.id) ?? []) {
        if (typeof sessionId === 'string') sessionIds.add(sessionId)
      }
    } catch (error) {
      rt.warn('ds-bot: capability group sessions for %s could not be read: %s', bot.id, error)
    }
    for (const sessionId of sessionIds) {
      try {
        trackAgent(await rt.resolveAgent(sessionId))
      } catch (error) {
        rt.warn('ds-bot: capability Agent for %s could not be resolved: %s', sessionId, error)
      }
    }
  }
  const wrapSecretsChanged = (previous: (() => void) | undefined): (() => void) => () => {
    previous?.()
    if (loadingSecrets === 0) void scheduleReconcile()
  }
  const dispose = async (): Promise<void> => {
    stopped = true
    standalone.dispose()
    const live = [...mounts.values()]
    mounts.clear()
    agents.clear()
    sessionStatuses.clear()
    await Promise.all(live.flatMap(agentMounts => [...agentMounts.values()].map(mount => disposeMount(mount))))
  }

  return {
    reconcile, scheduleReconcile, ensureCapabilities, prepare, trackAgent, trackBotAgents,
    statusFor, statusesView, wrapSecretsChanged, dispose,
  }
}

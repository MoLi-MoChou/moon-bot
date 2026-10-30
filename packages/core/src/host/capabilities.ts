// Capabilities: MCP servers, skills and packs a Main Bot saves once and attaches to Bots.
// The library and its editing rules live here; mounting them into a Session's Agent is
// capabilities-mount.ts.
import { createCapabilityMounts } from './capabilities-mount.ts'
import { configForTest } from './capabilities-config.ts'
import { createStandaloneMounts } from './capabilities-standalone.ts'
import { ToolRegistry } from '../engine/registry.ts'
import { own } from './store.ts'
import type { CapabilityItem, HostRuntime, StoredBot } from './runtime.js'

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const TEST_TIMEOUT_MS = 15_000

export function validateCapabilityName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (name.length > 32 || !NAME.test(name) || name === 'github') {
    throw new Error('Use a capability name with lowercase letters, digits, and single hyphens; "github" is reserved.')
  }
  return name
}

/** Every capability a Bot runs: what it has attached, with packs expanded. */
export function expandCapabilityNames(capabilities: readonly string[] | undefined, library: Readonly<Record<string, CapabilityItem>>): Set<string> {
  const expanded = new Set<string>()
  for (const name of capabilities ?? []) {
    const item = own(library, name)
    if (!item) throw new Error(`No capability named ${name}.`)
    if (item.kind === 'pack') {
      for (const childName of item.items ?? []) {
        const child = own(library, childName)
        if (!child || (child.kind !== 'mcp' && child.kind !== 'skill')) throw new Error(`Pack ${name} refers to an unavailable capability ${childName}.`)
        expanded.add(childName)
      }
    } else if (item.kind === 'mcp' || item.kind === 'skill') {
      expanded.add(name)
    } else {
      throw new Error(`Capability ${name} has an unknown kind.`)
    }
  }
  return expanded
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const strings = (value: unknown): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Arguments must be a list of text values.')
  return [...value] as string[]
}
const stringMap = (value: unknown, label: string): Record<string, string> => {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.values(value as Record<string, unknown>).some(item => typeof item !== 'string'))
    throw new Error(`${label} must contain text values.`)
  return Object.fromEntries(Object.entries(value as Record<string, string>))
}

interface EditOptions {
  readonly botId: string | undefined
  readonly ui: boolean
}

export function install(rt: HostRuntime): void {
  const { ctx, state } = rt

  const library = (): Record<string, CapabilityItem> => state.capabilities.items
  const ensureLibrary = (): Record<string, CapabilityItem> => {
    state.capabilities ??= { items: {} }
    state.capabilities.items ??= {}
    return library()
  }
  const writeCheck = (): void => {
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw new Error(readOnly)
  }
  const allowedToEdit = (item: CapabilityItem, botId: string | undefined): boolean => rt.isMain(botId) || item.createdBy === botId
  const usedByOthers = (name: string, botId: string | undefined): boolean =>
    Object.values(state.bots).some(
      bot =>
        bot.id !== botId &&
        (bot.capabilities ?? []).some(attached => {
          const item = own(library(), attached)
          return attached === name || (item?.kind === 'pack' && (item.items ?? []).includes(name))
        }),
    )
  // A creator that is not a Main Bot could otherwise rewrite what a Main Bot runs.
  const editCheck = (item: CapabilityItem, botId: string | undefined, verb: string): void => {
    if (!allowedToEdit(item, botId)) throw new Error(`Only ${item.createdBy ? 'its creator or a Main Bot' : 'a Main Bot'} can ${verb} ${item.name}.`)
    if (!rt.isMain(botId) && usedByOthers(item.name, botId)) throw new Error(`Another Bot uses ${item.name}, so only a Main Bot can ${verb} it.`)
  }
  const itemInput = (body: Readonly<Record<string, unknown>>, { botId, ui }: EditOptions): CapabilityItem => {
    const name = validateCapabilityName(body.name)
    const kind = body.kind
    if (kind !== 'mcp' && kind !== 'skill' && kind !== 'pack') throw new Error('Choose an MCP server, skill, or pack.')
    const items = ensureLibrary()
    const previous = own(items, name)
    if (previous && !ui) editCheck(previous, botId, 'change')
    if (previous && previous.kind !== kind) throw new Error('A capability cannot change its kind. Delete it and save a new one.')
    const now = Date.now()
    const item: CapabilityItem = {
      name,
      kind,
      description: String(body.description ?? '')
        .trim()
        .slice(0, 2000),
      createdBy: previous?.createdBy ?? (ui ? null : botId),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (kind === 'mcp') {
      const transport = body.transport === undefined ? 'stdio' : body.transport
      if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') throw new Error('Choose a local command, an HTTP URL, or an SSE endpoint.')
      if (transport === 'stdio') {
        const command = String(body.command ?? '').trim()
        if (command === '') throw new Error('Enter a command for the MCP server.')
        const args = strings(body.args)
        const env = stringMap(body.env, 'Environment variables')
        const changed = !previous || previous.kind !== 'mcp' || previous.transport !== 'stdio' || previous.command !== command || !same(previous.args ?? [], args) || !same(previous.env ?? {}, env)
        Object.assign(item, { transport, command, args, env, approved: ui ? true : changed ? false : previous.approved === true })
      } else {
        const url = String(body.url ?? '').trim()
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
        } catch {
          throw new Error('Enter a valid HTTP or HTTPS URL.')
        }
        Object.assign(item, { transport, url, headers: stringMap(body.headers, 'Headers'), approved: true })
      }
    } else if (kind === 'skill') {
      item.content = String(body.content ?? '').trim()
    } else {
      const names = [...new Set(strings(body.items))]
      for (const childName of names) {
        const child = own(items, childName)
        if (!child || (child.kind !== 'mcp' && child.kind !== 'skill')) throw new Error(`Packs can include only saved MCP servers and skills. ${childName} is not one.`)
      }
      item.items = names
    }
    items[name] = item
    return item
  }
  const capabilitySave = async (body: Readonly<Record<string, unknown>>, options: EditOptions = { botId: undefined, ui: false }): Promise<CapabilityItem> => {
    await rt.load()
    writeCheck()
    const item = itemInput(body, options)
    await rt.save()
    return item
  }
  // The same fields as a save, built in memory: `capability-test` must not add the item.
  const itemForTest = (body: Readonly<Record<string, unknown>>): CapabilityItem => {
    const name = String(body.name ?? '').trim()
    const item: CapabilityItem = {
      name: name === '' ? 'test-connection' : validateCapabilityName(name),
      kind: 'mcp',
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const transport = body.transport === undefined ? 'stdio' : body.transport
    if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') throw new Error('Choose a local command, an HTTP URL, or an SSE endpoint.')
    if (transport === 'stdio') {
      const command = String(body.command ?? '').trim()
      if (command === '') throw new Error('Enter a command for the MCP server.')
      Object.assign(item, { transport, command, args: strings(body.args), env: stringMap(body.env, 'Environment variables') })
      return item
    }
    const url = String(body.url ?? '').trim()
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    } catch {
      throw new Error('Enter a valid HTTP or HTTPS URL.')
    }
    Object.assign(item, { transport, url, headers: stringMap(body.headers, 'Headers') })
    return item
  }
  const capabilityTest = async (body: Readonly<Record<string, unknown>>): Promise<{ readonly tools: readonly string[]; readonly ms: number }> => {
    await rt.load()
    await rt.loadSecrets()
    const item = itemForTest(body)
    const config = configForTest(rt, item)
    // A throwaway registry: the test never adds tools to the running team.
    const registry = new ToolRegistry()
    const mounts = createStandaloneMounts(registry)
    const started = Date.now()
    try {
      await withTimeout(mounts.mount(item.name, config))
      return { tools: registry.names(), ms: Date.now() - started }
    } finally {
      mounts.dispose()
    }
  }
  const withTimeout = <T>(work: Promise<T>, ms = TEST_TIMEOUT_MS): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The MCP server did not answer in time.')), ms)
      void work.then(
        value => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  const capabilityDelete = async (name: unknown, { botId, ui }: EditOptions = { botId: undefined, ui: false }): Promise<boolean> => {
    await rt.load()
    writeCheck()
    const items = ensureLibrary()
    const item = own(items, String(name ?? ''))
    if (!item) throw new Error(`No capability named ${String(name)}.`)
    if (!ui) editCheck(item, botId, 'delete')
    delete items[item.name]
    for (const pack of Object.values(items)) if (pack.kind === 'pack') pack.items = (pack.items ?? []).filter(child => child !== item.name)
    for (const bot of Object.values(state.bots)) bot.capabilities = (bot.capabilities ?? []).filter(attached => attached !== item.name)
    await rt.save()
    return true
  }
  const changeAttachment = async (
    endpoint: string,
    { name, bot: targetRef }: { readonly name?: unknown; readonly bot?: string },
    callerId: string | undefined,
  ): Promise<{ bot: string; attached: boolean }> => {
    await rt.load()
    writeCheck()
    const caller = rt.botOf(callerId)
    if (!caller) throw new Error('Only Bots on the team can change capabilities.')
    const target = targetRef ? rt.findBot(targetRef) : caller
    if (!target) throw new Error(`No Bot named ${targetRef}.`)
    if (target.id !== caller.id && !rt.isMain(callerId)) throw new Error('Only a Main Bot can change another Bot’s capabilities.')
    const item = own(ensureLibrary(), String(name ?? ''))
    if (!item) throw new Error(`No capability named ${String(name)}.`)
    await setAttached(target, item.name, endpoint === 'attach')
    return { bot: target.name, attached: endpoint === 'attach' }
  }
  // Changes one name against the saved list, so two quick changes both land.
  const setAttached = async (bot: StoredBot, name: string, attached: boolean): Promise<readonly string[]> => {
    bot.capabilities ??= []
    const wasEmpty = bot.capabilities.length === 0
    if (attached && !bot.capabilities.includes(name)) bot.capabilities.push(name)
    if (!attached) bot.capabilities = bot.capabilities.filter(entry => entry !== name)
    await rt.save()
    if (wasEmpty && bot.capabilities.length > 0) {
      await mounts.trackBotAgents(bot)
      void mounts.scheduleReconcile()
    }
    return bot.capabilities
  }

  const libraryView = (): Record<string, unknown>[] =>
    Object.values(library()).map(item => ({
      ...item,
      ...(item.env ? { env: { ...item.env } } : {}),
      ...(item.headers ? { headers: { ...item.headers } } : {}),
      ...(item.items ? { items: [...item.items] } : {}),
    }))

  const mounts = createCapabilityMounts({
    ctx,
    rt,
    state,
    library,
    expand: names => expandCapabilityNames(names, library()),
  })

  async function capabilityEndpoint(endpoint: string, body: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    if (endpoint === 'capability-save') return capabilitySave(body, { botId: undefined, ui: true })
    if (endpoint === 'capability-delete') return capabilityDelete(body.name, { botId: undefined, ui: true })
    if (endpoint === 'capability-test') return capabilityTest(body)
    if (endpoint === 'capability-retry') {
      await rt.load()
      const name = String(body.name ?? '')
      if (!own(library(), name)) throw new Error(`No capability named ${name}.`)
      await mounts.reconcile()
      return { retried: true }
    }
    if (endpoint === 'capability-approve') {
      await rt.load()
      writeCheck()
      const item = own(library(), String(body.name ?? ''))
      if (!item || item.kind !== 'mcp' || item.transport !== 'stdio') throw new Error(`No unapproved stdio MCP named ${String(body.name)}.`)
      item.approved = true
      item.updatedAt = Date.now()
      await rt.save()
      return item
    }
    if (endpoint === 'bot-capability') {
      await rt.load()
      writeCheck()
      const bot = rt.botOf(String(body.botId ?? ''))
      if (!bot) throw new Error('Unknown Bot')
      const name = String(body.name ?? '')
      if (!own(library(), name)) throw new Error(`No capability named ${name}.`)
      return setAttached(bot, name, body.attached === true)
    }
    throw new Error('Unknown capability operation.')
  }
  const previousSecretsChanged = rt.secretsChanged
  rt.secretsChanged = mounts.wrapSecretsChanged(previousSecretsChanged)
  rt.capabilitiesStateSaved = () => {
    void mounts.scheduleReconcile()
  }
  // Creation waits for these listeners, so a new Agent's first request already has its
  // tools and skill catalog. agent/pre-step is too late: a step assembles its tools first.
  ctx.on<{ readonly agent: { readonly session: { readonly id: string } } & Parameters<typeof mounts.trackAgent>[0] }>('agent/created', async function prepareCapabilities({ agent }) {
    mounts.trackAgent(agent)
    try {
      await rt.load()
      const bot = rt.botOf(rt.selfOf(agent.session.id))
      const sessionBot = rt.isBotSession(agent.session.id) ? bot : undefined
      if ((sessionBot?.capabilities ?? []).length > 0) await mounts.prepare(agent, agent.session.id)
    } catch (error) {
      rt.warn('moon-bot: capability load failed: %s', error)
    }
  })
  ctx.effect(() => {
    void rt
      .load()
      .then(async () => {
        for (const bot of Object.values(state.bots)) {
          if ((bot.capabilities ?? []).length > 0) await mounts.trackBotAgents(bot)
        }
        await mounts.scheduleReconcile()
      })
      .catch(error => rt.warn('moon-bot: capability startup failed: %s', error))
    return async () => {
      await mounts.dispose()
    }
  }, 'moon-bot: capabilities')
  Object.assign(rt, {
    capabilitySave,
    capabilityDelete,
    capabilityEndpoint,
    capabilityLibraryView: libraryView,
    capabilityStatusesView: mounts.statusesView,
    capabilityToolsView: mounts.toolsView,
    reconcileCapabilities: mounts.reconcile,
    scheduleCapabilitiesReconcile: mounts.scheduleReconcile,
    ensureCapabilities: mounts.ensureCapabilities,
    expandCapabilities: (names: readonly string[] | undefined) => expandCapabilityNames(names, library()),
    changeCapabilityAttachment: changeAttachment,
  })
}

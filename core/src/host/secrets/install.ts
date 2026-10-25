// The wiring for secrets: the card a Bot opens, the settings endpoints, redaction of
// tool results and model requests, and the shell environment a saved key is offered in.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ToolContext } from '../../engine/registry.ts'
import type { Disposer, DshContext, LlmStreamOptions } from '../dsh-types.js'
import type { HostRuntime } from '../runtime.js'
import {
  SECRET_NAME,
  canUse,
  envName,
  LEGACY_ENV_PREFIX,
  normalizeName,
  redactDeep,
  redactor,
  type Redact,
  type SecretScope,
} from './redact.ts'
import {
  createSecretStore,
  type SecretBody,
  type SecretNote,
  type SecretRecord,
  type SecretStore,
} from './store.ts'

type SecretEndpoint = (body: SecretBody) => Promise<unknown>

interface ToolResult {
  readonly isError?: boolean
  readonly content?: unknown
  readonly meta?: unknown
  readonly error?: unknown
  readonly value?: unknown
  readonly additionalContexts?: unknown
}

interface ShellExecution {
  readonly agent?: {
    readonly id?: string
    readonly session?: { readonly header?: { readonly id?: string } }
  }
  readonly arguments?: { readonly command?: unknown }
}

interface ShellEnvContributor {
  readonly name: string
  readonly variables: Record<string, { readonly description: string }>
  resolve(execution: ShellExecution): Record<string, string>
}

interface ShellEnvService {
  register(contributor: ShellEnvContributor): Disposer
}

/** The injected slice of a context that carries the shell environment service. */
interface ShellEnvHost {
  readonly shellEnv: ShellEnvService
  effect(execute: () => void | Disposer, label: string): void
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt
  let redact: Redact = text => text
  let refreshEnv: () => void = () => {}

  const changed = (): void => {
    redact = redactor([...store.secrets.values()])
    refreshEnv()
    rt.secretsChanged?.()
  }
  const store: SecretStore = createSecretStore(rt, changed)

  const endpoints: Record<string, SecretEndpoint> = {
    // From a card (requestId) or from the settings page (name).
    async 'secret-set'(body: SecretBody): Promise<unknown> {
      const value = store.cleanValue(body.value)
      const now = Date.now()
      const notes: SecretNote[] = []
      if (body.requestId !== undefined) {
        const { botId, request } = store.pendingRequest(body.requestId)
        const existing = store.secrets.get(request.name)
        let scope: SecretScope
        if (existing === undefined || request.kind === 'fill') scope = body.scope === 'bot' ? [botId] : 'all'
        else scope = existing.scope === 'all' ? 'all' : [...new Set([...existing.scope, botId])]
        const record: SecretRecord = {
          name: request.name,
          value,
          purpose: existing?.purpose || request.purpose,
          scope,
          requestedBy: existing?.requestedBy ?? botId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          ...(existing?.lastUsedAt !== undefined ? { lastUsedAt: existing.lastUsedAt } : {}),
        }
        store.secrets.set(request.name, record)
        store.settle(request, 'saved')
        notes.push([botId, store.savedNote(request.name, `The user saved ${request.name} for ${store.scopeText(scope)}.`)])
        store.reconcile(request.name, notes, request)
        await store.commit(notes)
        return store.secretView(record)
      }
      const name = normalizeName(body.name)
      if (!SECRET_NAME.test(name)) throw new Error('A name uses capitals, digits, and underscores, and starts with a letter')
      const existing = store.secrets.get(name)
      const record: SecretRecord = {
        name,
        value,
        purpose: typeof body.purpose === 'string' && body.purpose.trim() !== '' ? body.purpose.trim().slice(0, 300) : existing?.purpose ?? '',
        scope: body.scope !== undefined ? store.cleanScope(body.scope) : existing?.scope ?? 'all',
        requestedBy: existing?.requestedBy ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(existing?.lastUsedAt !== undefined ? { lastUsedAt: existing.lastUsedAt } : {}),
      }
      store.secrets.set(name, record)
      store.reconcile(name, notes)
      await store.commit(notes)
      return store.secretView(record)
    },
    async 'secret-allow'(body: SecretBody): Promise<unknown> {
      const { botId, request } = store.pendingRequest(body.requestId)
      const secret = store.secrets.get(request.name)
      if (secret === undefined) throw new Error(`${request.name} is not saved yet`)
      if (!canUse(secret, botId)) store.allowBot(secret, botId)
      secret.updatedAt = Date.now()
      store.settle(request, 'allowed')
      const notes: SecretNote[] = [[botId, store.savedNote(request.name, `The user let you use ${request.name}.`)]]
      store.reconcile(request.name, notes, request)
      await store.commit(notes)
      return store.secretView(secret)
    },
    async 'secret-cancel'(body: SecretBody): Promise<unknown> {
      const { botId, request } = store.pendingRequest(body.requestId)
      store.settle(request, 'canceled')
      await rt.save()
      await store.tell(botId, `The user canceled your request for ${request.name}. Do not ask for it again unless the user brings it up; carry on without it, or tell the user what you cannot do without it.`)
      return true
    },
    async 'secret-update'(body: SecretBody): Promise<unknown> {
      const secret = store.secrets.get(normalizeName(body.name))
      if (secret === undefined) throw new Error('No such key')
      secret.scope = store.cleanScope(body.scope)
      secret.updatedAt = Date.now()
      const notes: SecretNote[] = []
      store.reconcile(secret.name, notes)
      await store.commit(notes)
      return store.secretView(secret)
    },
    async 'secret-delete'(body: SecretBody): Promise<unknown> {
      const name = normalizeName(body.name)
      if (!store.secrets.delete(name)) throw new Error('No such key')
      const notes: SecretNote[] = []
      store.reconcile(name, notes)
      await store.commit(notes)
      return true
    },
  }

  async function secretEndpoint(endpoint: string, body: SecretBody): Promise<unknown> {
    await store.load()
    const handler = endpoints[endpoint]
    if (handler === undefined) throw new Error('No such secret endpoint')
    return handler(body ?? {})
  }

  const callerOf = (context: ToolContext): string | undefined => {
    const headerId = (context.session as { readonly header?: { readonly id?: unknown } } | undefined)?.header?.id
    return rt.selfOf(typeof headerId === 'string' ? headerId : context.sessionId)
  }

  rt.registerTool({
    name: 'request_secret',
    description: 'Ask the user for a key, token, or password through a secure card in your own chat. The user types it into the card; you never see the value. It reaches your shell as an environment variable. When the key is already saved for you, this only tells you its variable. Showing a card ends your turn; a note arrives when the user saves or cancels.',
    parameters: {
      name: { type: 'string', required: true, description: 'Key name in capitals, digits, and underscores, e.g. GITHUB_TOKEN' },
      purpose: { type: 'string', required: true, description: 'One short line for the user: what you need it for' },
    },
    schema: z.object({ name: z.string(), purpose: z.string() }).passthrough(),
    async execute(args, context: ToolContext): Promise<string> {
      await rt.load()
      await store.load()
      const id = context.sessionId
      const bot = rt.botOf(callerOf(context))
      if (bot === undefined) return 'Only Bots on the team can use request_secret.'
      const name = normalizeName(args.name)
      if (!SECRET_NAME.test(name)) return 'Name the key with capitals, digits, and underscores, starting with a letter (for example GITHUB_TOKEN).'
      const secret = store.secrets.get(name)
      if (canUse(secret, bot.id)) return `${name} is already saved and you may use it: ${store.usage(name)}. You cannot see the value; never print it.`
      if (rt.groupOwners.has(id)) return 'Secret cards only work in your own chat. Tell the group you will ask the user in your own chat, and call request_secret there.'
      if (!rt.chatOwners.has(id)) return 'Secret cards only work in your current own chat.'
      const readOnly = rt.readOnly()
      if (readOnly !== undefined) return `No card can be shown now. ${readOnly}`
      const list = store.requestsOf(bot.id)
      const now = Date.now()
      for (const request of list) {
        if (request.status === 'pending' && request.name === name) {
          request.status = 'canceled'
          request.settledAt = now
        }
      }
      list.push({
        id: randomUUID(),
        ...(context.callId !== '' ? { callId: context.callId } : {}),
        sessionId: id,
        name,
        purpose: String(args.purpose ?? '').trim().slice(0, 300),
        kind: secret !== undefined ? 'allow' : 'fill',
        status: 'pending',
        askedAt: now,
      })
      store.trimRequests(list)
      await rt.save()
      context.concludeTurn?.()
      return secret !== undefined
        ? `The card asking the user to let you use ${name} is on screen. A note arrives when the user answers; you will not see the value.`
        : `The card asking the user for ${name} is on screen. A note arrives when the user saves or cancels; you will not see the value.`
    },
  })

  rt.registerTool({
    name: 'list_secrets',
    description: 'List the keys the user saved for the team: name, purpose, which Bots may use them, and whether you may. Values are never shown.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(_args, context: ToolContext): Promise<string> {
      await rt.load()
      await store.load()
      const self = callerOf(context)
      if (rt.botOf(self) === undefined) return 'Only Bots on the team can use list_secrets.'
      if (store.secrets.size === 0) return 'No keys are saved yet. Ask for one with request_secret.'
      return [
        'Saved keys (values are never shown):',
        ...store.secretsView().map(secret => `- ${secret.name}${secret.purpose ? ` — ${secret.purpose}` : ''} — for ${store.scopeText(secret.scope)} — ${canUse(store.secrets.get(secret.name), self) ? `you may use it as $${envName(secret.name)}` : 'you may not use it; ask with request_secret'}`),
      ].join('\n')
    },
  })

  // Tool results lose the values before the registry renders and saves them: a fresh
  // result object is re-rendered from its value, so the model content, the saved
  // `tool/result`, and the tool card's presentation all come from the redacted value.
  ctx.on<unknown, () => Promise<unknown>>('tools/execute', async (_exec, next) => {
    const result = await next()
    if (store.secrets.size === 0 || result === null || typeof result !== 'object') return result
    const record = result as ToolResult & Record<string, unknown>
    if (record.isError) {
      const content = redactDeep(record.content, redact)
      const meta = redactDeep(record.meta, redact)
      const error = redactDeep(record.error, redact)
      if (content === record.content && meta === record.meta && error === record.error) return result
      return { ...record, content, error, ...(meta !== undefined ? { meta } : {}) }
    }
    const value = redactDeep(record.value, redact)
    if (value === record.value) return result
    return { isError: false, value, ...(record.additionalContexts !== undefined ? { additionalContexts: record.additionalContexts } : {}) }
  })

  // Anything that still carries a value (the user pasted it, an earlier part kept it)
  // is replaced before the request leaves. `next` cannot take new options, so the
  // request starts over; it then carries no value and passes through here.
  // A value that is part of its own label would be replaced again on every pass, so a
  // request this listener rewrote passes straight through.
  const rewritten = new WeakSet<readonly unknown[]>()
  ctx.on<LlmStreamOptions, () => AsyncIterable<unknown>>('llm/stream', (options, next) => {
    if (store.secrets.size === 0 || rewritten.has(options.messages)) return next()
    const messages = redactDeep(options.messages, redact)
    const system = redactDeep(options.system, redact)
    if (messages === options.messages && system === options.system) return next()
    const fresh = [...(messages ?? [])]
    rewritten.add(fresh)
    rt.carryUsageTag(options.messages, fresh)
    return ctx.llm.stream({ ...options, messages: fresh, ...(system !== undefined ? { system } : {}) })
  })

  function resolveEnv(execution: ShellExecution): Record<string, string> {
    const botId = rt.selfOf(execution?.agent?.session?.header?.id ?? execution?.agent?.id)
    if (rt.botOf(botId) === undefined) return {}
    const command = typeof execution.arguments?.command === 'string' ? execution.arguments.command : ''
    const values: Record<string, string> = {}
    let used = false
    for (const secret of store.secrets.values()) {
      if (!canUse(secret, botId)) continue
      values[envName(secret.name)] = secret.value
      values[`${LEGACY_ENV_PREFIX}${secret.name}`] = secret.value // the DSH-era name still works
      if (command.includes(envName(secret.name)) || command.includes(`${LEGACY_ENV_PREFIX}${secret.name}`)) {
        secret.lastUsedAt = Date.now()
        used = true
      }
    }
    if (used) store.noteUsed()
    return values
  }

  // Keys must be declared up front, so the contribution is registered again whenever
  // the set of names (or a purpose, which describes the key) changes.
  function attachShellEnv(sub: ShellEnvHost): void {
    let unregister: Disposer | null = null
    let declared = ''
    refreshEnv = (): void => {
      const list = [...store.secrets.values()].sort((a, b) => a.name.localeCompare(b.name))
      const key = list.map(secret => `${secret.name}\u0000${secret.purpose}`).join('\n')
      if (key === declared) return
      unregister?.()
      unregister = null
      declared = key
      if (list.length === 0) return
      try {
        unregister = sub.shellEnv.register({
          name: 'ds-bot-secrets',
          variables: Object.fromEntries(list.map(secret => [envName(secret.name), { description: `Moon Bot secret ${secret.name}${secret.purpose ? `: ${secret.purpose}` : ''}` }])),
          resolve: resolveEnv,
        })
      } catch (error) {
        declared = ''
        rt.warn('ds-bot: secrets not offered to the shell: %s', (error as { readonly message?: unknown } | null | undefined)?.message ?? error)
      }
    }
    refreshEnv()
    sub.effect(() => () => {
      unregister?.()
      unregister = null
      declared = ''
      refreshEnv = () => {}
    }, 'ds-bot: secrets shell env')
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['shellEnv'], (sub) => {
      const shellEnv = (sub as DshContext & { readonly shellEnv: ShellEnvService }).shellEnv
      attachShellEnv({ shellEnv, effect: (execute, label) => sub.effect(execute, label) })
    })
  } else {
    const shellEnv = ctx.get<ShellEnvService>('shellEnv')
    if (shellEnv !== undefined) attachShellEnv({ shellEnv, effect: (execute, label) => ctx.effect(execute, label) })
  }

  ctx.effect(() => {
    void store.load()
    return () => { store.dispose() }
  }, 'ds-bot: load secrets')

  Object.assign(rt, {
    secretsView: () => store.secretsView(),
    secretValue: (name: string) => store.secrets.get(name)?.value,
    canUseSecret: (name: string, botId: string | undefined) => canUse(store.secrets.get(name), botId),
    secretEndpoint,
    forgetBotSecrets: (botId: string) => store.forgetBotSecrets(botId),
    loadSecrets: () => store.load(),
    redactSecrets: (text: string) => redact(text),
  })
}

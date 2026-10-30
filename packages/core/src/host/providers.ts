import type { ConfigurableProvider, CredentialsService, SettingsSection, SettingsService } from './host-types.js'
import type { HostRuntime } from './runtime.js'
import { resolveModelSpec } from 'moon-bot-contracts'

type ProviderBody = Readonly<Record<string, unknown>>
type Profile = Readonly<Record<string, unknown>>

interface ProviderSeams {
  readonly settings: SettingsService
  readonly credentials: CredentialsService
}

// Model providers and their API keys, for a window that has no the host Models page of its
// own. the host keeps all of it: a provider route in the settings of the adapter that serves
// it, the route's key in the host's credential store under the reference the route names.
// The providers to add are the ones the host's directory of configurable providers offers.

const PI_AI = 'llm-pi-ai'
const ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
// The wire protocols the host's pi-ai adapter serves on a route it ships nothing about.
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const MAX_MODELS = 500

// The reference the host's own Models page derives for a route's key, so a provider added
// here and one added there read the same key.
export const keyRefFor = (provider: string): string => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

const invalid = (message: string): Error => Object.assign(new Error(message), { code: 'bot/invalid' })

// What an HTTP header can carry, like the host's own key check: a pasted `NAME=value` line
// or a quoted value would be stored as the key and refused by the provider.
export function checkKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : ''
  if (key === '') throw invalid('Enter the API key')
  if (/^[A-Za-z_][A-Za-z0-9_]*=[^=]/.test(key)) throw invalid('Paste only the key, not a NAME=value line')
  if (/^(["']).*\1$/.test(key)) throw invalid('Paste the key without quotes')
  if (!/^[\x21-\x7E]+$/.test(key)) throw invalid('An API key has no spaces or special characters')
  return key
}

function checkEndpoint(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const text = raw.replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '')
  let url
  try {
    url = new URL(text)
  } catch {
    throw invalid('Enter the endpoint as an http or https address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Enter the endpoint as an http or https address')
  return text
}

// A model as the route stores it: what discovery told about it, under pi-ai's names.
function modelEntry(model: unknown): {
  readonly id: string
  readonly name?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxTokens?: number | undefined
  readonly input?: readonly string[] | undefined
} {
  const source = model as
    | {
        readonly id?: unknown
        readonly name?: unknown
        readonly contextWindow?: unknown
        readonly maxTokens?: unknown
        readonly inputModalities?: readonly unknown[]
        readonly input?: readonly unknown[]
      }
    | undefined
  const id = typeof model === 'string' ? model.trim() : typeof source?.id === 'string' ? source.id.trim() : ''
  if (id === '') throw invalid('Every model needs an id')
  const spec = resolveModelSpec(id)
  const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined)
  const contextWindow = whole(source?.contextWindow) ?? spec.contextWindow
  const maxTokens = whole(source?.maxTokens) ?? spec.maxTokens
  const rawInputs = Array.isArray(source?.inputModalities)
    ? source.inputModalities
    : Array.isArray(source?.input)
      ? source.input
      : spec.name
        ? spec.inputModalities
        : undefined
  return {
    id,
    ...(typeof source?.name === 'string' && source.name.trim() !== '' ? { name: source.name.trim() } : spec.name ? { name: spec.name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(Array.isArray(rawInputs) && rawInputs.length > 0 ? { input: rawInputs.filter((kind): kind is string => typeof kind === 'string') } : {}),
  }
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt

  const seams = (): ProviderSeams | undefined => {
    const settings = ctx.get<SettingsService>('settings')
    const credentials = ctx.get<CredentialsService>('credentials')
    return settings !== undefined && credentials !== undefined ? { settings, credentials } : undefined
  }
  const usable = (): ProviderSeams => {
    const found = seams()
    if (found === undefined) throw invalid('Model providers cannot be set up here')
    return found
  }
  const sections = (settings: SettingsService): Map<string, SettingsSection> =>
    new Map(settings.describe({ redactSecrets: true }).map(section => [section.ns, section]))
  const profileOf = (entry: ConfigurableProvider, map: Map<string, SettingsSection>, layer: 'value' | 'user' | 'base' = 'value'): Profile | undefined =>
    entry.settingsPath.reduce<unknown>((value, key) => (value as Profile | undefined)?.[key], map.get(entry.settingsNs)?.[layer]) as Profile | undefined
  const refOf = (profile: Profile | undefined): string | undefined =>
    typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv !== '' ? profile.apiKeyEnv : undefined
  const entryOf = (provider: string): ConfigurableProvider | undefined => ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)

  // Per provider route, the credential its the host settings name as its API key. A
  // provider with none authenticates some other way.
  function keyRefs(): Map<string, string> {
    const found = seams()
    if (found === undefined) return new Map()
    const map = sections(found.settings)
    const refs = new Map<string, string>()
    for (const entry of ctx.llm.listConfigurableProviders()) {
      const ref = refOf(profileOf(entry, map))
      if (ref !== undefined) refs.set(entry.provider, ref)
    }
    return refs
  }

  async function missingKeys(providers: readonly string[]): Promise<Set<string>> {
    let refs: Map<string, string>
    try {
      refs = keyRefs()
    } catch {
      return new Set()
    }
    const missing = new Set<string>()
    await Promise.all(
      providers
        .filter(id => refs.has(id))
        .map(async id => {
          const ref = refs.get(id)
          if (ref === undefined) return
          const info = await seams()
            ?.credentials.describe(ref)
            .catch(() => undefined)
          if (info?.configured === false) missing.add(id)
        }),
    )
    return missing
  }

  // The providers set up in the host, with their models and key state, and the ones the host
  // can add. A provider with no key and no models (DeepSeek's account route before a
  // sign-in) is left out.
  async function providersView(): Promise<Record<string, unknown>> {
    const found = seams()
    if (found === undefined) return { available: false }
    const map = sections(found.settings)
    const catalog = await rt.catalog({ fresh: true })
    const providers: Record<string, unknown>[] = []
    const addable: Record<string, unknown>[] = []
    for (const entry of ctx.llm.listConfigurableProviders()) {
      const profile = profileOf(entry, map)
      if (entry.settingsNs === PI_AI && profile === undefined) {
        if (entry.declared !== true) addable.push({ id: entry.provider, name: entry.displayName })
        continue
      }
      const ref = refOf(profile)
      const models = catalog
        .filter(model => model.provider === entry.provider)
        .map(model => {
          const spec = resolveModelSpec(model.id ?? model.ref)
          return {
            ref: model.ref,
            name: model.name,
            contextWindow: model.contextWindow ?? spec.contextWindow,
            maxTokens: model.maxTokens ?? spec.maxTokens,
            input: model.input ?? (spec.inputModalities ? [...spec.inputModalities] : undefined),
            reasoning: model.reasoning !== undefined ? true : spec.reasoning,
          }
        })
      if (ref === undefined && models.length === 0 && entry.error === undefined) continue
      const info = ref === undefined ? undefined : await found.credentials.describe(ref).catch(() => undefined)
      providers.push({
        id: entry.provider,
        name: entry.displayName,
        models,
        key: ref === undefined ? null : { configured: info?.configured === true, writable: info?.writable !== false },
        removable: entry.settingsNs === PI_AI && profileOf(entry, map, 'user') !== undefined && profileOf(entry, map, 'base') === undefined,
        custom: entry.declared === true,
        ...(entry.error ? { error: entry.error } : {}),
      })
    }
    // The ones that come with the setup first, then the added ones as the host lists them.
    providers.sort((a, b) => Number(a.removable) - Number(b.removable))
    return { available: true, providers, addable, protocols: PROTOCOLS }
  }

  async function writableRef(provider: string): Promise<string> {
    const ref = keyRefs().get(provider)
    if (ref === undefined) throw invalid(`${provider} takes no API key here`)
    if ((await usable().credentials.describe(ref)).writable === false)
      throw invalid(`The API key for ${provider} is set outside Moon Bot and cannot be changed here`)
    return ref
  }

  // A key is only ever written; nothing here reads one back.
  async function setProviderKey(provider: string, value: unknown): Promise<void> {
    const key = checkKey(value)
    await usable().credentials.set(await writableRef(provider), key)
    rt.dropCatalog()
  }

  async function clearProviderKey(provider: string): Promise<void> {
    await usable().credentials.unset(await writableRef(provider))
    rt.dropCatalog()
  }

  // `provider` from the host's directory, or a route the user declares (`custom`) for an
  // endpoint the host ships nothing about. The route goes in first, then its key, as the host's
  // own Models page does it: a failed key write leaves a provider that asks for one.
  async function addProvider(body: ProviderBody): Promise<Record<string, unknown>> {
    const { settings, credentials } = usable()
    const provider = String(body.provider ?? '').trim()
    const map = sections(settings)
    const entry = entryOf(provider)
    if (entry !== undefined && (entry.settingsNs !== PI_AI || profileOf(entry, map) !== undefined)) throw invalid(`${provider} is already set up`)
    const custom = body.custom === true
    if (!custom && (entry === undefined || entry.declared === true)) throw invalid(`Moon Bot offers no provider ${provider}`)
    if (custom && !ROUTE_ID.test(provider)) throw invalid('A provider id is lowercase letters, digits and dashes, starting with a letter')
    if (custom && entry !== undefined) throw invalid(`Moon Bot already offers ${provider}; add it from its list`)
    const key = typeof body.key === 'string' && body.key.trim() !== '' ? checkKey(body.key) : undefined
    const ref = keyRefFor(provider)
    const info = await credentials.describe(ref)
    if (key !== undefined && info.writable === false) throw invalid(`The API key for ${provider} is set outside Moon Bot and cannot be changed here`)
    // A blank key keeps a key that is already there, else the provider's own sign-in.
    const keyed = key !== undefined || info.configured === true
    const profile: Record<string, unknown> = custom ? customProfile(body) : {}
    if (keyed) profile.apiKeyEnv = ref
    await settings.mutate(PI_AI, [{ op: 'set', path: entry?.settingsPath ?? ['providers', provider], value: profile }], map.get(PI_AI)?.revision)
    if (key !== undefined) await credentials.set(ref, key)
    rt.dropCatalog()
    return providersView()
  }

  function customProfile(body: ProviderBody): Record<string, unknown> {
    const api = typeof body.api === 'string' ? body.api : ''
    if (!PROTOCOLS.includes(api)) throw invalid(`The protocol must be one of ${PROTOCOLS.join(', ')}`)
    const models = Array.isArray(body.models) ? body.models.slice(0, MAX_MODELS).map(modelEntry) : []
    if (models.length === 0) throw invalid('Add at least one model')
    if (new Set(models.map(model => model.id)).size !== models.length) throw invalid('Two models have the same id')
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    return { ...(name ? { displayName: name } : {}), api, baseURL: checkEndpoint(body.baseURL), models }
  }

  // The models an endpoint (or a provider the host ships) says it serves. The key typed for
  // the question goes with it and is not stored.
  async function discoverModels(body: ProviderBody): Promise<readonly Record<string, unknown>[]> {
    usable()
    const provider = typeof body.provider === 'string' && body.provider !== '' ? body.provider : undefined
    const request =
      provider !== undefined && entryOf(provider)?.declared === false
        ? { provider }
        : {
            baseURL: checkEndpoint(body.baseURL),
            ...(typeof body.api === 'string' && PROTOCOLS.includes(body.api) ? { api: body.api } : {}),
            ...(typeof body.key === 'string' && body.key.trim() !== '' ? { apiKey: checkKey(body.key) } : {}),
          }
    const models = await ctx.llm.discoverModels(PI_AI, request).catch((error: unknown) => {
      throw invalid(error instanceof Error ? error.message : String(error))
    })
    return models.slice(0, MAX_MODELS).map(model => {
      const spec = resolveModelSpec(model.id)
      return {
        id: model.id,
        ...(model.name ? { name: model.name } : spec.name ? { name: spec.name } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : spec.contextWindow ? { contextWindow: spec.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : spec.maxTokens ? { maxTokens: spec.maxTokens } : {}),
        // A spec fills a field only when it recognizes the model (`name`, as the route
        // merge above rules): the heuristics must not invent modalities an endpoint
        // did not report.
        ...(model.inputModalities
          ? { inputModalities: [...model.inputModalities] }
          : spec.name !== undefined && spec.inputModalities
            ? { inputModalities: [...spec.inputModalities] }
            : {}),
        ...((model as { reasoning?: boolean }).reasoning ? { reasoning: true } : spec.reasoning ? { reasoning: true } : {}),
      }
    })
  }

  // Only a route the user added goes; its key goes with it when it is the one this page
  // derives and no other provider names it.
  async function removeProvider(provider: string): Promise<Record<string, unknown>> {
    const { settings, credentials } = usable()
    const map = sections(settings)
    const entry = entryOf(provider)
    if (entry === undefined || entry.settingsNs !== PI_AI || profileOf(entry, map) === undefined) throw invalid(`${provider} is not set up`)
    if (profileOf(entry, map, 'user') === undefined || profileOf(entry, map, 'base') !== undefined)
      throw invalid(`${provider} comes with this setup and cannot be removed`)
    const ref = refOf(profileOf(entry, map))
    const shared = [...keyRefs()].some(([other, otherRef]) => other !== provider && otherRef === ref)
    await settings.mutate(PI_AI, [{ op: 'unset', path: entry.settingsPath }], map.get(PI_AI)?.revision)
    if (ref === keyRefFor(provider) && !shared) {
      const info = await credentials.describe(ref)
      if (info.configured && info.writable) await credentials.unset(ref)
    }
    rt.dropCatalog()
    return providersView()
  }

  Object.assign(rt, { keyRefs, missingKeys, providersView, setProviderKey, clearProviderKey, addProvider, discoverModels, removeProvider })
}

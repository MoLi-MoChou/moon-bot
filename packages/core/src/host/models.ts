import { clearTimeout, setTimeout } from 'node:timers'
import type { AgentDefaultModelService, ModelSelection } from './host-types.js'
import type { HostRuntime, ModelEntry, ModelReasoning, StoredBot } from './runtime.js'
import { resolveModelSpec } from '../shared/model-catalog.ts'

interface Selection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

// Models. Every Bot runs on one model of its own, fixed when it is created and changed
// only in its settings or by a Main Bot. The team's first Main Bot has none until the
// user picks one in its chat. The Session keeps the selection durably.
import { normalize, splitRef } from './text.ts'

const CATALOG_TTL_MS = 10_000
const ROUTE_WAIT_MS = 30_000

export function install(rt: HostRuntime): void {
  const { ctx, state } = rt

  let modelsSynced: Promise<unknown> | null = null
  let catalogCache: { at: number; value: readonly ModelEntry[] } = { at: 0, value: [] }
  // A model's thinking levels, resolved once and kept for a short while: they change
  // only with the provider, which also drops the catalog cache.
  const reasoningCache = new Map<string, { at: number; value: ModelReasoning | undefined }>()
  ctx.on?.('llm/adapters-updated', () => { catalogCache = { at: 0, value: [] }; reasoningCache.clear() })
  for (const name of ['credentials/reference-updated', 'settings/document-updated']) ctx.on?.(name, () => { catalogCache = { at: 0, value: [] } })

  // The thinking levels a model serves: `{efforts: [{id, name, description?}],
  // defaultEffort?}`, or undefined when it has none or the provider cannot say.
  async function reasoningOf(ref: string): Promise<ModelReasoning | undefined> {
    const cached = reasoningCache.get(ref)
    if (cached !== undefined && Date.now() - cached.at < CATALOG_TTL_MS) return cached.value
    const route = splitRef(ref)
    const info = route === undefined ? undefined : await ctx.llm.resolveModelInfo(route.provider, route.model).catch(() => undefined)
    const spec = route ? resolveModelSpec(route.model) : undefined
    const efforts = info?.reasoning?.efforts?.length
      ? (info.reasoning.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name ?? effort.id, ...(effort.description ? { description: effort.description } : {}) }))
      : spec?.reasoning && spec.reasoningEfforts
        ? spec.reasoningEfforts.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))
        : []
    const value = efforts.length === 0 ? undefined : {
      efforts,
      defaultEffort: info?.reasoning?.defaultEffort ?? 'medium',
    }
    reasoningCache.set(ref, { at: Date.now(), value })
    return value
  }

  // A provider's model list can change in the host settings without any event, so a picker
  // that is about to be used asks for a `fresh` one. Entries for models a Bot uses
  // also carry their `reasoning`, so the picker can offer thinking levels.
  async function catalog({ fresh = false }: { readonly fresh?: boolean } = {}): Promise<readonly ModelEntry[]> {
    if (!fresh && Date.now() - catalogCache.at < CATALOG_TTL_MS && catalogCache.value.length > 0) return catalogCache.value
    const entries: ModelEntry[] = []
    for (const provider of ctx.llm.listProviders()) {
      let models: readonly { readonly id: string; readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number; readonly inputModalities?: readonly string[] }[] = []
      try { models = await ctx.llm.listModels(provider.id) } catch { continue }
      for (const model of models) {
        const spec = resolveModelSpec(model.id)
        const contextWindow = model.contextWindow ?? spec.contextWindow
        const maxTokens = model.maxTokens ?? spec.maxTokens
        const input = model.inputModalities ? [...model.inputModalities] : (spec.inputModalities ? [...spec.inputModalities] : undefined)
        entries.push({
          ref: `${provider.id}/${model.id}`,
          provider: provider.id,
          providerName: provider.name ?? provider.id,
          id: model.id,
          name: model.name ?? spec.name ?? model.id,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(input !== undefined ? { input } : {}),
        })
      }
    }
    // the host serves a provider's models whether or not its key is set; without one, every
    // turn on them fails.
    const missing = await rt.missingKeys?.([...new Set(entries.map(entry => entry.provider).filter((id): id is string => id !== undefined))]) ?? new Set()
    for (const entry of entries) if (entry.provider !== undefined && missing.has(entry.provider)) entry.needsKey = true
    const used = new Set(Object.values(state.bots ?? {}).flatMap(bot => [bot.model, bot.appliedModel].filter(Boolean)))
    await Promise.all(entries.filter(entry => used.has(entry.ref)).map(async (entry) => {
      const reasoning = await reasoningOf(entry.ref)
      if (reasoning !== undefined) entry.reasoning = reasoning
    }))
    catalogCache = { at: Date.now(), value: entries }
    return entries
  }

  // The profile default model of the host as set, served or not.
  const defaultRef = (): string | undefined => {
    const selection = ctx.get<AgentDefaultModelService>('agentDefaultModel')?.currentSelection?.()
    return selection?.provider && selection?.model ? `${selection.provider}/${selection.model}` : undefined
  }
  // The profile default model of the host, when it is served; else the first served model.
  function pickDefault(entries: readonly ModelEntry[]): string | undefined {
    const ref = defaultRef()
    return entries.find(entry => entry.ref === ref)?.ref ?? entries[0]?.ref
  }
  const defaultModel = async (): Promise<string | undefined> => pickDefault(await catalog())

  // A full `provider/model` ref, or a model id or name that only one provider serves.
  async function resolveModel(text: unknown): Promise<string> {
    const entries = await catalog({ fresh: true })
    const wanted = String(text ?? '').trim()
    const exact = entries.find(entry => entry.ref === wanted)
    if (exact) return exact.ref
    const key = normalize(wanted)
    const named = entries.filter(entry => normalize(entry.id) === key || normalize(entry.name) === key)
    if (named.length === 1) return named[0]?.ref ?? wanted
    const known = entries.map(entry => entry.ref).join(', ') || 'none'
    throw new Error(named.length > 1
      ? `Model ${wanted} is served by more than one provider; use one of ${named.map(entry => entry.ref).join(', ')}`
      : `Model ${wanted} is not available. Available models: ${known}`)
  }

  // A Bot with no model yet waits for the user to pick one and changes nothing. A
  // model that is no longer served falls back to the last one it ran on, then the default.
  async function desiredModel(bot: StoredBot): Promise<string | undefined> {
    if (!bot.model) return undefined
    const entries = await catalog()
    const served = new Set(entries.map(entry => entry.ref))
    return [bot.model, bot.appliedModel].find(ref => ref && served.has(ref)) ?? pickDefault(entries)
  }

  // The thinking level a Bot asked for, when the model it runs on serves it; else the
  // model's own default applies. A level the model does not have is ignored, never
  // sent: an explicit effort a provider does not know is a hard refusal there.
  async function desiredEffort(bot: StoredBot, ref: string | undefined): Promise<string | undefined> {
    if (bot.effort === undefined || ref === undefined) return undefined
    const reasoning = await reasoningOf(ref)
    return reasoning?.efforts?.some(effort => effort.id === bot.effort) ? bot.effort : undefined
  }

  // A thinking level id, or a name only one level of the model has, like resolveModel.
  async function resolveEffort(ref: string, text: unknown): Promise<string | undefined> {
    const wanted = String(text ?? '').trim()
    if (wanted === '') return undefined
    const reasoning = await reasoningOf(ref)
    const efforts = reasoning?.efforts ?? []
    if (efforts.length === 0) throw new Error(`Model ${ref} has no thinking levels`)
    const key = normalize(wanted)
    const named = efforts.filter(effort => normalize(effort.id) === key || normalize(effort.name) === key)
    if (named.length === 1) return named[0]?.id
    throw new Error(`Thinking level ${wanted} is not available for ${ref}. Available: ${efforts.map(effort => effort.name).join(', ')}`)
  }

  // the host's selectModel also saves the selection as the profile default model, in the
  // background. A Bot's model is its own, so the user's default is written back after
  // it. Selections run one at a time and wait for the write-back: profile writes land in
  // submission order, so the next one reads the user's default, not a Bot's.
  let selecting: Promise<unknown> = Promise.resolve()
  function selectSessionModel(sessionId: string, { provider, model, reasoningEffort }: Selection): Promise<unknown> {
    const run = selecting.then(async () => {
      const defaults = ctx.get<AgentDefaultModelService>('agentDefaultModel')
      const before = defaults?.currentSelection?.()
      const result = await ctx.sessionController.selectModel({
        sessionId, provider, model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
      const saved = result?.selected ?? { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
      if (before?.provider && before?.model && !sameSelection(before, saved)) {
        await defaults?.saveSelection?.(before).catch(error => rt.warn('moon-bot: the default model was not restored: %s', error))
      }
      return result
    })
    selecting = run.catch(() => {})
    return run
  }

  const sameSelection = (a: ModelSelection, b: ModelSelection): boolean => a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort

  // `force` re-selects even when the record says it is applied: the composer's own
  // model picker can move the Session without telling this plugin.
  async function applyModel(bot: StoredBot, { force = false }: { readonly force?: boolean } = {}): Promise<string | undefined> {
    const ref = await desiredModel(bot)
    if (ref === undefined) return ref
    const effort = await desiredEffort(bot, ref)
    if (!force && bot.appliedModel === ref && (bot.appliedEffort ?? undefined) === effort) return ref
    const split = splitRef(ref)
    if (split === undefined) return undefined
    const route: Selection = { ...split, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
    await selectSessionModel(rt.chatOf(bot.id), route)
    for (const sessionId of rt.groupSessionsOf(bot.id)) {
      await selectSessionModel(sessionId, route)
        .catch(error => rt.warn('moon-bot: model for %s in a group not applied: %s', bot.name, error))
    }
    bot.appliedModel = ref
    if (effort === undefined) delete bot.appliedEffort
    else bot.appliedEffort = effort
    await rt.save()
    return ref
  }

  // A provider may register after the plugin starts; a greeting waits for its Bot's
  // model instead of failing with "no adapter registered".
  async function waitForModel(bot: StoredBot, ms = ROUTE_WAIT_MS): Promise<string | undefined> {
    const deadline = Date.now() + ms
    for (;;) {
      if (!bot.model) return undefined
      catalogCache = { at: 0, value: [] }
      const served = new Set((await catalog()).map(entry => entry.ref))
      if (served.has(bot.model) || Date.now() >= deadline) return desiredModel(bot)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(2000, deadline - Date.now()))
        const off = ctx.on?.('llm/adapters-updated', done)
        function done() { clearTimeout(timer); off?.(); resolve() }
      })
    }
  }

  // Sequential, and again whenever the served models change: a provider that
  // registers late still gets its Bots' models selected.
  let syncedKey: string | undefined
  const syncModels = (): Promise<unknown> => {
    const key = catalogCache.value.map(entry => entry.ref).join(',')
    if (key !== syncedKey) {
      syncedKey = key
      modelsSynced = modelsSynced === null ? syncAll() : modelsSynced.then(syncAll, syncAll)
    }
    return modelsSynced ?? Promise.resolve()
  }
  async function syncAll(): Promise<void> {
    for (const bot of Object.values(state.bots)) {
      await applyModel(bot).catch(error => rt.warn('moon-bot: model for %s not applied: %s', bot.name, error))
    }
  }

  Object.assign(rt, {
    catalog, cachedCatalog: () => catalogCache.value, cachedDefault: () => pickDefault(catalogCache.value),
    defaultRef, defaultModel, resolveModel, desiredModel, reasoningOf, resolveEffort, desiredEffort,
    selectSessionModel, applyModel, waitForModel, syncModels,
    dropCatalog: () => { catalogCache = { at: 0, value: [] } },
  })
}

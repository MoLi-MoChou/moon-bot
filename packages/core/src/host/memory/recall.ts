// Reading memory: the recall tool, and the memory panel with its summary, its
// "ask or update" call and its per-entry removal. All changes go through the same
// storage path as the tools and the review.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ToolRunContext } from '../host-types.js'
import type { ToolContext } from '../../engine/registry.ts'
import type { StoredBot } from '../runtime.ts'
import type { MemoryActor, MemoryFile, MemoryScope, ScopedEntry } from './records.ts'
import type { MemoryBody, Panel, RecallDeps, RecallService, Scopes, ScopeList } from '../memory-types.ts'
import { MEMORY_LIMITS, cleanEntry, cleanTopic, errorMessage, formatEntry, squash } from './records.ts'
import { SUMMARY_SYSTEM, askRequest, askSystem, groupSummaryRequest, parseAsk, summaryRequest } from './prompt.ts'

export interface Caller {
  readonly bot: StoredBot
  readonly sessionId: string
  readonly roomId: string | undefined
}

export interface PanelEntry {
  readonly scope: string
  readonly topic: string | null
  readonly text: string
  readonly added: string | null
  readonly by: string | null
  readonly source: string | null
}

export interface MemoryView {
  readonly roomId?: string | undefined
  readonly botId?: string | undefined
  readonly entries: readonly PanelEntry[]
  readonly sizes: Readonly<Record<string, number>>
  readonly limits: { readonly entry: number; readonly main: number; readonly topic: number; readonly topics: number }
  readonly summary: { readonly text: string; readonly at?: number | undefined } | null
  readonly fresh: boolean
  readonly summarizing: boolean
  readonly error: string | null
}

export interface AskAnswer {
  readonly op: string
  readonly scope: string
  readonly text: string
  readonly before?: string | undefined
  readonly ok: boolean
  readonly error?: string | undefined
}

export interface AskResult {
  readonly reply: string
  readonly changes: readonly AskAnswer[]
  readonly view: MemoryView
}

export interface Summary {
  readonly hash: string
  readonly text: string
  readonly at?: number | undefined
}

export interface SummaryFailure {
  readonly hash: string
  readonly model: string | undefined
  readonly message: string
}

const RECALL_MAX = 30
const QUERY_TERMS_MAX = 6
const SOURCE_READ_MS = 5_000
const SUMMARY_TEXT_MAX = 8_000
const ASK_TEXT_MAX = 2_000
const ASK_CHANGES_MAX = 20

/** The read side: recall, the source of an entry, and the memory panel. */
export function createRecall({ rt, storage, botShot }: RecallDeps): RecallService {
  const USER: MemoryActor = { id: 'user', name: 'user' }
  const languageNow = (): string => rt.uiLanguage?.() ?? 'the language most entries are written in'
  const capital = (text: string): string => (text[0] ?? '').toUpperCase() + text.slice(1)

  const callerOf = (exec: ToolContext | ToolRunContext): Caller | undefined => {
    const agentView = (exec as { readonly agent?: { readonly id?: unknown } | undefined }).agent
    const fromContext = 'sessionId' in exec ? exec.sessionId : undefined
    const sessionId: string | undefined = typeof fromContext === 'string' ? fromContext : (agentView !== null && agentView !== undefined && typeof agentView.id === 'string' ? agentView.id : undefined)
    if (sessionId === undefined) return undefined
    const bot = rt.botOf(rt.selfOf(sessionId))
    return bot === undefined ? undefined : { bot, sessionId, roomId: storage.roomIdOf(sessionId) }
  }

  // Where the caller learned it: the anchor of the latest message to it in this part,
  // which read_own_chat opens, or the group and the time.
  async function sourceOf(sessionId: string): Promise<string> {
    const owner = rt.groupOwners.get(sessionId)
    if (owner !== undefined) return `group "${rt.roomOf(owner.roomId)?.name ?? '?'}" ${rt.clock(Date.now())}`
    const parts = rt.partsOf(rt.selfOf(sessionId) ?? '')
    const at = parts.findIndex(part => part.sessionId === sessionId)
    const number = at === -1 ? Math.max(parts.length, 1) : at + 1
    let seq: number | undefined
    try {
      for await (const event of rt.eventsBackwards(sessionId, AbortSignal.timeout(SOURCE_READ_MS), 1)) {
        const entry = rt.historyEntry(event, false)
        if (entry !== undefined && !entry.answer && entry.text !== '') {
          seq = event.seq
          break
        }
      }
    } catch { /* no history to point at: the time stands in */ }
    return seq === undefined ? `part ${number} ${rt.clock(Date.now())}` : `part ${number} #${seq}`
  }
  const metaFor = async (caller: Caller, scope: MemoryScope): Promise<Record<string, string>> => ({
    source: await sourceOf(caller.sessionId),
    ...(scope.kind !== 'bot' || scope.botId !== caller.bot.id ? { by: caller.bot.name } : {}),
    added: storage.today(),
  })

  // ---------------------------------------------------------------------------
  // The scopes a caller reads: by default its own, its group's when it speaks in one,
  // and the team's.
  function readScopes(raw: unknown, botId: string, sessionRoomId: string | undefined): ScopeList | Scopes {
    const room = rt.roomOf(sessionRoomId)
    const roomId = room !== undefined && (room.members ?? []).includes(botId) ? sessionRoomId : undefined
    const { scope, error } = storage.namedScope(raw, botId, roomId)
    if (error !== undefined) return { error }
    if (scope === undefined) return { scopes: roomId === undefined ? [storage.ownScope(botId), storage.TEAM] : [storage.ownScope(botId), storage.groupScope(roomId), storage.TEAM] }
    if (scope.kind === 'bot' && scope.botId !== botId && !rt.isMain(botId)) return { error: 'Only a Main Bot can read another Bot\'s memory. Ask that Bot with message_bot instead.' }
    return { scopes: [scope] }
  }
  const tagOf = (scope: MemoryScope, botId: string): string => (scope.kind === 'team' ? 'team' : scope.kind === 'group' ? 'group' : scope.botId === botId ? 'yours' : rt.botOf(scope.botId)?.name ?? '?')

  function installTools(): void {
    rt.registerTool({
      name: 'recall',
      description: 'Search your memory, the team memory, and in a group chat the group memory, or read one topic whole. It also finds entries saved after this conversation began. With no arguments, lists what is saved where.',
      parameters: {
        query: { type: 'string', description: 'Words to look for, separated by spaces. An entry must have all of them; when none has, those with the most are shown' },
        topic: { type: 'string', description: 'A topic to read whole, as listed with [[topic]]' },
        scope: { type: 'string', description: 'Omit for yours, the team\'s, and in a group chat the group\'s; "own", "group", "team", or a Bot\'s name (Main Bots only)' },
      },
      schema: z.object({ query: z.string().optional(), topic: z.string().optional(), scope: z.string().optional() }).passthrough(),
      async execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
        await rt.load()
        const caller = callerOf(context)
        if (caller === undefined) return 'Only Bots on the team keep a memory.'
        const self = caller.bot.id
        const chosen = readScopes(args.scope, self, caller.roomId)
        if ('error' in chosen) return chosen.error
        const loaded = chosen.scopes.map(scope => ({ scope, tag: tagOf(scope, self), label: storage.labelOf(scope, self), files: storage.loadScope(scope) }))
        if (args.topic !== undefined && String(args.topic).trim() !== '') {
          const topic = cleanTopic(args.topic)
          for (const { label, files } of loaded) {
            const file = files.find(item => item.topic === topic)
            if (file !== undefined) return `Topic [[${topic ?? ''}]] in ${label} (${storage.sizeNote(file, file.content.length)}):\n${file.content.trim() || '(empty)'}`
          }
          const known = loaded.flatMap(({ tag, files }) => files.filter(file => file.topic !== undefined).map(file => `[[${file.topic ?? ''}]] (${tag})`))
          return `No topic [[${String(args.topic).slice(0, 60)}]] there. Topics: ${known.join(', ') || 'none yet'}.`
        }
        const where = (tag: string, file: MemoryFile): string => `${tag} · ${file.topic === undefined ? 'MEMORY.md' : `[[${file.topic}]]`}`
        const query = String(args.query ?? '').trim().slice(0, 120)
        if (query === '') {
          return loaded.map(({ tag, label, files }) => {
            const main = files[0]
            if (main === undefined) return ''
            const topics = files.slice(1)
            return [
              `${capital(label)}: MEMORY.md has ${main.entries.length} entries (${storage.sizeNote(main, main.content.length)})${topics.length > 0 ? `; topics ${topics.map(file => `[[${file.topic ?? ''}]] (${file.entries.length})`).join(', ')}` : '; no topics'}.`,
              ...main.entries.map(entry => `[${where(tag, main)}] ${formatEntry(entry.text, entry.meta).slice(2)}`),
            ].join('\n')
          }).join('\n\n')
        }
        const terms = [...new Set(squash(query).split(' ').filter(Boolean))].slice(0, QUERY_TERMS_MAX)
        const scored = loaded.flatMap(({ tag, files }) => storage.allEntries(files).map((entry) => {
          const hay = squash(`${entry.text} ${entry.file.topic ?? ''}`)
          return { entry, tag, count: terms.filter(term => hay.includes(term)).length }
        })).filter(hit => hit.count > 0)
        const every = scored.filter(hit => hit.count === terms.length)
        const hits = (every.length > 0 ? every : scored.sort((a, b) => b.count - a.count)).slice(0, RECALL_MAX)
        const names = loaded.map(item => item.label)
        const labels = names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1) ?? ''}` : names.join(' and ')
        if (hits.length === 0) return `Nothing in ${labels} mentions "${query}". read_own_chat searches what was said.`
        return [
          every.length > 0 ? `Entries with "${query}" in ${labels}:` : `No entry has all of "${query}"; entries with the most of these words:`,
          ...hits.map(({ entry, tag }) => `[${where(tag, entry.file)}] ${formatEntry(entry.text, entry.meta).slice(2)}`),
        ].join('\n')
      },
    })
  }

  // ---------------------------------------------------------------------------
  // The memory panel: a summary the keeper's model writes, every entry, and "ask or
  // update", one model call whose changes go through the same path as the tools.

  const panelEntries = (files: readonly MemoryFile[], scope: string): PanelEntry[] => storage.allEntries(files).map(entry => ({
    scope, topic: entry.file.topic ?? null, text: entry.text,
    added: entry.meta.added ?? null, by: entry.meta.by ?? null, source: entry.meta.source ?? null,
  }))

  const summaries = new Map<string, Summary>()
  const summarizing = new Map<string, Promise<unknown>>()
  const summaryFailures = new Map<string, SummaryFailure>()
  const summaryPath = (id: string): string => join(storage.root, 'summaries', `${storage.safeId(id)}.json`)
  const savedSummary = (id: string): Summary | undefined => {
    if (summaries.has(id)) return summaries.get(id)
    try {
      const value: unknown = JSON.parse(readFileSync(summaryPath(id), 'utf8'))
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.hash === 'string' && typeof record.text === 'string') {
          const summary: Summary = { hash: record.hash, text: record.text, ...(typeof record.at === 'number' ? { at: record.at } : {}) }
          summaries.set(id, summary)
          return summary
        }
      }
    } catch { /* none yet */ }
    return undefined
  }
  const linesFor = (files: readonly MemoryFile[]): string[] => storage.allEntries(files).map(entry => `- ${entry.file.topic ? `[[${entry.file.topic}]] ` : ''}${entry.text}`)

  // What a panel is about: a Bot (`botId`) or a group chat (`roomId`), the memory it
  // shows by tag, and the keeper, whose model writes the summary and answers. A group
  // left with no Bot has no keeper: its entries still show and can be removed.
  function panelOf(body: MemoryBody): Panel {
    if (body.roomId !== undefined && body.roomId !== null) {
      const room = rt.roomOf(String(body.roomId))
      if (room === undefined) throw new Error('Unknown group chat')
      return { id: room.id, name: room.name, group: true, keeper: storage.keeperOf(room), tag: { sessionId: room.id, kind: 'memory' }, scopes: { group: storage.groupScope(room.id) } }
    }
    const bot = rt.botOf(String(body.botId ?? ''))
    if (bot === undefined) throw new Error('Unknown Bot')
    return { id: bot.id, name: bot.name, group: false, keeper: bot, tag: { sessionId: rt.chatOf(bot.id), kind: 'memory' }, scopes: { own: storage.ownScope(bot.id), team: storage.TEAM } }
  }
  const panelBody = (panel: Panel): { readonly roomId: string } | { readonly botId: string } => (panel.group ? { roomId: panel.id } : { botId: panel.id })
  const panelLabel = (panel: Panel, scope: MemoryScope): string => (scope.kind === 'team' ? 'the team memory' : panel.group ? 'the group memory' : `${panel.name}'s memory`)

  function startSummary(panel: Panel, loaded: Readonly<Record<string, MemoryFile[]>>, language: string, hash: string): void {
    const keeper = panel.keeper
    if (keeper === undefined) return
    const model = keeper.model
    const request = panel.group
      ? groupSummaryRequest({ name: panel.name, lines: linesFor(loaded.group ?? []), language })
      : summaryRequest({ name: panel.name, own: linesFor(loaded.own ?? []), team: linesFor(loaded.team ?? []), language })
    const job = (async () => {
      const text = await botShot(keeper, SUMMARY_SYSTEM, request, panel.tag)
      const value: Summary = { hash, text: text.slice(0, SUMMARY_TEXT_MAX), at: Date.now() }
      summaries.set(panel.id, value)
      summaryFailures.delete(panel.id)
      if (rt.readOnly() === undefined) await storage.writeText(summaryPath(panel.id), JSON.stringify(value, null, 2))
    })().catch((error: unknown) => {
      summaryFailures.set(panel.id, { hash, model, message: errorMessage(error) })
      rt.warn('moon-bot: memory summary for %s failed: %s', panel.name, error)
    }).finally(() => summarizing.delete(panel.id))
    summarizing.set(panel.id, job)
  }

  // The summary is written again when the entries or the interface language change;
  // a failed one waits for `regenerate`, or a new model for the keeper, instead of
  // retrying on every poll.
  function memoryView(body: MemoryBody): MemoryView {
    const panel = panelOf(body)
    const loaded: Record<string, MemoryFile[]> = {}
    for (const [tag, scope] of Object.entries(panel.scopes)) loaded[tag] = storage.loadScope(scope)
    const entries = Object.entries(loaded).flatMap(([tag, files]) => panelEntries(files, tag))
    const language = languageNow()
    const hash = createHash('sha256').update(JSON.stringify([language, ...Object.values(loaded).map(linesFor)])).digest('hex')
    const saved = savedSummary(panel.id)
    const prior = summaryFailures.get(panel.id)
    const failed = prior !== undefined && prior.hash === hash && prior.model === panel.keeper?.model ? prior : undefined
    const wanted = body.regenerate === true || (body.summarize === true && saved?.hash !== hash && failed === undefined)
    if (wanted && entries.length > 0 && panel.keeper !== undefined && !summarizing.has(panel.id)) startSummary(panel, loaded, language, hash)
    const sizes: Record<string, number> = {}
    for (const [tag, files] of Object.entries(loaded)) sizes[tag] = files[0]?.content.length ?? 0
    return {
      ...panelBody(panel),
      entries,
      sizes,
      limits: MEMORY_LIMITS,
      summary: entries.length > 0 && saved !== undefined ? { text: saved.text, ...(saved.at === undefined ? {} : { at: saved.at }) } : null,
      fresh: entries.length === 0 || saved?.hash === hash,
      summarizing: summarizing.has(panel.id),
      error: failed !== undefined && !summarizing.has(panel.id) ? failed.message : null,
    }
  }

  async function memoryAsk(body: MemoryBody): Promise<AskResult> {
    const panel = panelOf(body)
    if (panel.keeper === undefined) throw new Error('No Bot is left in this group chat')
    const text = String(body.text ?? '').trim().slice(0, ASK_TEXT_MAX)
    if (text === '') throw new Error('Type a question or a change first')
    const numbered: ScopedEntry[] = Object.entries(panel.scopes).flatMap(([tag, scope]) => storage.allEntries(storage.loadScope(scope)).map(entry => ({ ...entry, scope: tag })))
    const answer = parseAsk(await botShot(panel.keeper, askSystem(panel.group), askRequest({ name: panel.name, group: panel.group, numbered, language: languageNow(), text }), panel.tag))
    const meta = { source: 'memory panel', by: 'user', added: storage.today() }
    const home = panel.group ? 'group' : 'own'
    const changes: AskAnswer[] = []
    for (const change of answer.changes.slice(0, ASK_CHANGES_MAX)) {
      const op = String(change.op ?? '')
      const target = numbered[Number(change.entry) - 1]
      const tag = op === 'add' ? (change.team === true && panel.scopes.team !== undefined ? 'team' : home) : target?.scope ?? home
      const scope = panel.scopes[tag]
      const next = cleanEntry(change.text)
      try {
        if (scope === undefined) continue
        const label = panelLabel(panel, scope)
        if (op !== 'add' && target === undefined) throw new Error(`There is no entry ${String(change.entry)}.`)
        if (op === 'add' || op === 'edit') {
          const problem = storage.entryProblem(next)
          if (problem !== undefined) throw new Error(problem)
        }
        if (op === 'add') await storage.addEntry({ scope, text: next, meta, actor: USER, label })
        else if (op === 'edit' && target !== undefined) await storage.replaceEntry({ scope, topic: target.file.topic, match: target.text, text: next, meta, actor: USER, label })
        else if (op === 'remove' && target !== undefined) await storage.removeEntry({ scope, topic: target.file.topic, match: target.text, actor: USER, label })
        else continue
        changes.push({ op, scope: tag, text: op === 'remove' ? target?.text ?? '' : next, ...(op === 'edit' && target !== undefined ? { before: target.text } : {}), ok: true })
      } catch (failure) {
        changes.push({ op, scope: tag, text: next || target?.text || '', ok: false, error: errorMessage(failure) })
      }
    }
    return { reply: answer.reply, changes, view: memoryView(panelBody(panel)) }
  }

  // One entry the user removes from the list.
  async function memoryForget(body: MemoryBody): Promise<MemoryView> {
    const panel = panelOf(body)
    const scope = panel.scopes[typeof body.scope === 'string' ? body.scope : ''] ?? panel.scopes[panel.group ? 'group' : 'own']
    if (scope === undefined) throw new Error('Unknown memory scope')
    const topic = body.topic === null || body.topic === undefined ? undefined : cleanTopic(body.topic)
    await storage.removeEntry({ scope, topic, match: String(body.text ?? ''), actor: USER, label: panelLabel(panel, scope) })
    return memoryView(panelBody(panel))
  }

  return {
    callerOf, sourceOf, metaFor, installTools, memoryView, memoryAsk, memoryForget,
    forgetSummary: (id, clearFailure = false) => {
      summaries.delete(id)
      if (clearFailure) summaryFailures.delete(id)
    },
  }
}

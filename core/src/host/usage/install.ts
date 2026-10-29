// Wiring the usage ledger into the plugin: opening the file, metering the calls made
// outside every Session log, and journaling an owner before the first scan.
import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmStreamOptions } from '../host-types.js'
import type { HostRuntime } from '../runtime.js'
import { tokensOf } from './fold.ts'
import { memoryLedger, sqliteLedger } from './ledger.ts'
import type { Ledger, LedgerCall } from './ledger.ts'
import { createViewer, inGroup, liveOwners } from './view.ts'

interface UsageTag {
  readonly sessionId: string
  readonly kind: string
}

/** A request as `llm/stream` carries it: the host names the Session and the purpose. */
interface StreamRequest extends LlmStreamOptions {
  readonly purpose?: string | undefined
}

type StreamNext = () => AsyncIterable<unknown>

interface RecordedCall {
  readonly sessionId?: string | undefined
  readonly kind: string
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly usage: unknown
}

const messageOf = (error: unknown): unknown =>
  (typeof error === 'object' && error !== null ? (error as { readonly message?: unknown }).message : undefined)

export function install(rt: HostRuntime): void {
  const { ctx, home } = rt
  const path = join(home, 'usage.sqlite')

  let ledger: Ledger | undefined
  let opening: Promise<Ledger> | undefined
  // Metered calls that finish before the ledger opens.
  const early: LedgerCall[] = []
  function openLedger(): Promise<Ledger> {
    if (ledger !== undefined) return Promise.resolve(ledger)
    const job: Promise<Ledger> = opening ??= (async (): Promise<Ledger> => {
      let DatabaseSync: typeof import('node:sqlite').DatabaseSync
      try {
        ({ DatabaseSync } = await import('node:sqlite'))
        await mkdir(home, { recursive: true })
      } catch (error) {
        rt.warn('moon-bot: usage is kept in memory only: %s', error)
        return memoryLedger()
      }
      // Only proven damage warrants a rebuild: Desktop and Web share this file,
      // and a busy lock must never read as corruption, or the other writer's
      // ledger would be deleted under it.
      const damaged = (error: unknown): boolean => /malformed|not a database|corrupt/i.test(String(messageOf(error) ?? error))
      for (const fresh of [false, true]) {
        try {
          if (fresh) await unlink(path).catch(() => {})
          return sqliteLedger(DatabaseSync, path)
        } catch (error) {
          if (fresh || !damaged(error)) {
            rt.warn('moon-bot: usage is kept in memory only: %s', error)
            return memoryLedger()
          }
        }
      }
      return memoryLedger()
    })().then((opened) => {
      // The plugin may have been disposed while the file opened.
      if (opening !== job) {
        opened.close()
        return memoryLedger()
      }
      for (const row of early.splice(0)) opened.add(row)
      ledger = opened
      return opened
    })
    return job
  }
  ctx.effect(() => () => {
    ledger?.close()
    ledger = undefined
    opening = undefined
  }, 'moon-bot: usage ledger')

  const viewer = createViewer({ rt, openLedger })

  // DS Bot tags the requests it makes outside a Session with the Session they serve.
  const tags = new WeakMap<object, UsageTag>()
  const setTag = (messages: unknown, tag: UsageTag): void => {
    if (messages !== null && typeof messages === 'object') tags.set(messages, tag)
  }
  const tagUsage = (messages: readonly unknown[], tag: UsageTag): readonly unknown[] => {
    setTag(messages, tag)
    return messages
  }
  const carryUsageTag = (from: unknown, to: unknown): void => {
    if (from === null || typeof from !== 'object') return
    const tag = tags.get(from)
    if (tag !== undefined) setTag(to, tag)
  }
  // DS Bot's own requests name the Session they serve, as some routes require, so
  // `sessionId` alone does not make a request that Session's own round; the tag does.
  const ownRequest = (options?: { readonly sessionId?: string | undefined; readonly messages?: unknown }): boolean => {
    const messages = options?.messages
    return messages !== null && messages !== undefined && typeof messages === 'object' && tags.has(messages)
  }
  // Owner and group use are journaled with the call itself: a Bot or room that
  // is deleted before the first scan still leaves its calls under its own name.
  const journaled = new Map<string, string | true>()
  const journal = (book: Ledger, sessionId: string): void => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const owner = liveOwners(rt, viewer.sessions(), book.owners()).get(sessionId)
    if (owner !== undefined && owner.name !== '') {
      const stamp = `${owner.owner}\n${owner.name}`
      if (journaled.get(sessionId) !== stamp) {
        journaled.set(sessionId, stamp)
        book.setOwner(sessionId, owner)
      }
    }
    if (inGroup(rt).has(sessionId) && journaled.get(`${sessionId}\ngroup`) === undefined) {
      journaled.set(`${sessionId}\ngroup`, true)
      book.setKind(sessionId, 'group')
    }
  }
  // Plain Session requests skip the meter, so every caller notes its Session
  // here. The journal needs the team state and the ledger; both load behind
  // the request, and `journaled` keeps the repeat calls from writing again.
  const noteSession = (sessionId: string): void => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    void (async () => {
      await rt.load()
      const book = ledger ?? await openLedger().catch(() => undefined)
      if (book === undefined) return
      try { journal(book, sessionId) } catch (error) { rt.warn('moon-bot: usage could not journal %s: %s', sessionId, error) }
    })()
  }
  function record({ sessionId, kind, provider, model, usage }: RecordedCall): void {
    noteSession(sessionId ?? '')
    const row: LedgerCall = { key: `live:${randomUUID()}`, session: sessionId ?? '', time: Date.now(), provider: provider ?? '', model: model ?? '', kind, ...tokensOf(usage) }
    if (ledger !== undefined) {
      try { ledger.add(row) } catch (error) { rt.warn('moon-bot: usage could not record a call: %s', error) }
      return
    }
    early.push(row)
    void openLedger().catch(() => {})
  }

  // A request listener that rewrites a request starts it over, so the same usage chunk
  // can pass here twice; it counts once.
  const counted = new WeakSet<object>()
  // A Session's own requests are in its log; every other request is metered here.
  ctx.on<StreamRequest, StreamNext>('llm/stream', (options, next) => {
    const tag = tags.get(options.messages)
    if (tag === undefined && options.sessionId !== undefined && options.purpose === undefined) {
      noteSession(options.sessionId)
      return next()
    }
    return (async function* meter(): AsyncGenerator<unknown> {
      let usage: unknown
      try {
        for await (const chunk of next()) {
          if (typeof chunk === 'object' && chunk !== null) {
            const sample = chunk as { readonly type?: unknown; readonly usage?: unknown }
            if (sample.type === 'usage' && sample.usage && !counted.has(chunk)) {
              counted.add(chunk)
              usage = sample.usage
            }
          }
          yield chunk
        }
      } finally {
        if (usage !== undefined) record({ sessionId: tag?.sessionId ?? options.sessionId, kind: tag?.kind ?? options.purpose ?? 'other', provider: options.provider, model: options.model, usage })
      }
    })()
  })

  Object.assign(rt, { usageView: viewer.view, tagUsage, carryUsageTag, ownRequest })
}

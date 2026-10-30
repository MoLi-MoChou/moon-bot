// Memory news and the review that writes it: the latest change a conversation header
// shows, and the idle-time review that reads what is new in a chat or a group and
// keeps it in memory, one review at a time. News is keyed by Bot or group chat id.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredBot, StoredRoom } from '../runtime.ts'
import { speakerOf } from 'moon-bot-contracts'
import type {
  ApplyInput, Batch, BatchInput, ChangeResult, MemoryLine, MemoryNewsItem, MemoryNewsService, NewsDeps,
  NoteNews, ReviewStatus, RoomCopy, RoomLine, Seen,
} from '../memory-types.ts'
import type { MemoryMetaInput } from './records.ts'
import {
  DENIED, GONE, NO_MATCH, cleanEntry, cleanTopic, errorCode, errorMessage, lastIndexWhere, lastWhere,
  splitMeta,
} from './records.ts'
import {
  REVIEW_CHANGES_MAX, REVIEW_MEMORY_MAX,
  fitted, parseReview, reviewEntries, reviewLine, reviewRequest, reviewSystem, writtenIn,
} from './prompt.ts'
const NEWS_TEXT_MAX = 160
const REVIEW_READ_MS = 15_000
const REVIEW_FIRST_LINES = 6
const REVIEW_CONTEXT_LINES = 4
const REVIEW_PASSES_MAX = 4
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)} …(cut)` : text)

/** The memory news digest and, when enabled, the idle-time review. */
export function createNews({ rt, root, reviewOn, delay, botShot, getStorage }: NewsDeps): MemoryNewsService {
  const { ctx } = rt
  const news = new Map<string, MemoryNewsItem>()

  const noteNews: NoteNews = (scope, actor, op, line) => {
    if (actor.id === 'user') return
    const id = scope.kind === 'team' ? actor.id : scope.kind === 'group' ? scope.roomId : scope.botId
    if (rt.botOf(id) === undefined && rt.roomOf(id) === undefined) return
    news.set(id, { at: Date.now(), op, text: splitMeta(String(line ?? '').replace(/^- /, '')).text.slice(0, NEWS_TEXT_MAX) })
  }
  const memoryNews = (): Readonly<Record<string, MemoryNewsItem>> => Object.fromEntries(news)
  const languageNow = (): string => rt.uiLanguage?.() ?? 'the language most entries are written in'
  // ---------------------------------------------------------------------------
  // The review. When a conversation goes idle, a model reads what is new there and
  // keeps, changes, or removes entries, as a person would after a talk. Reviews run
  // one at a time, and a conversation that goes on before its review starts is read
  // in one go.
  const cursorsPath = join(root, 'reviewed.json')
  let cursors: Record<string, number> | undefined
  const cursorsNow = (): Record<string, number> => {
    if (cursors === undefined) {
      try {
        const value: unknown = JSON.parse(readFileSync(cursorsPath, 'utf8'))
        cursors = value !== null && typeof value === 'object' ? value as Record<string, number> : {}
      } catch {
        cursors = {}
      }
    }
    return cursors
  }

  const roomLines = (room: StoredRoom | RoomCopy): readonly RoomLine[] => (room.log ?? []) as readonly RoomLine[]

  // What is new in a Bot's own chat, read newest first from the Session.
  async function chatBatch(sessionId: string, bot: StoredBot, since: number | undefined): Promise<Batch> {
    const fresh: MemoryLine[] = []
    const earlier: MemoryLine[] = []
    let through: number | undefined
    // Reading goes back as far as it takes: to the cursor, or for a first review to
    // the user's latest line.
    for await (const line of rt.partLines(sessionId, AbortSignal.timeout(REVIEW_READ_MS), { pages: Infinity })) {
      through ??= line.seq
      // A first review reads back at least to the user's latest line.
      if (since === undefined ? fresh.length < REVIEW_FIRST_LINES || !fresh.some(seen => seen.who === 'user') : line.seq > since) fresh.push(line)
      else if (earlier.push(line) >= REVIEW_CONTEXT_LINES) break
    }
    const parts = rt.partsOf(bot.id)
    const at = parts.findIndex(part => part.sessionId === sessionId)
    return {
      through,
      fresh: fresh.reverse(),
      earlier: earlier.reverse(),
      where: 'its own chat with the user',
      // The user's latest line among those the review read.
      source: (lines) => {
        const said = lastWhere(lines, line => line.who === 'user')
        return said === undefined ? undefined : `part ${at === -1 ? Math.max(parts.length, 1) : at + 1} #${said.seq}`
      },
    }
  }

  // What is new in a group, from its log: the members' Sessions hold the same
  // messages wrapped in turn prompts.
  function groupBatch(room: RoomCopy, since: number | undefined): Batch {
    const log = room.log.filter(line => line.kind === undefined && typeof line.text === 'string' && line.text.trim() !== '')
    // A first review reads back at least to the user's latest line, which a round of
    // replies from many members can push out of the last few.
    const lastUser = lastIndexWhere(log, line => line.who === 'User' && line.botId === undefined)
    let start = since === undefined ? Math.max(0, Math.min(log.length - REVIEW_FIRST_LINES, lastUser === -1 ? log.length : lastUser)) : log.findIndex(line => line.seq > since)
    const oldest = room.log[0]?.seq
    if (since !== undefined && oldest !== undefined && oldest > since + 1) rt.warn('moon-bot: %d lines of group "%s" left its log before they were reviewed', oldest - since - 1, room.name)
    if (start === -1) start = log.length
    const line = (entry: RoomLine): MemoryLine => {
      const who = entry.botId === undefined && entry.who === 'User' ? 'user' : 'bot'
      return { who, text: `${who === 'user' ? 'User' : speakerOf({ who: entry.who ?? null, ...(entry.botId === undefined ? {} : { botId: entry.botId }) })}: ${entry.text}`, seq: entry.seq }
    }
    return {
      through: log.at(-1)?.seq,
      fresh: log.slice(start).map(line),
      earlier: log.slice(Math.max(0, start - REVIEW_CONTEXT_LINES), start).map(line),
      where: `the group chat "${room.name}"`,
      source: () => `group "${room.name}" ${rt.clock(Date.now())}`,
    }
  }

  // `home` is the memory the review keeps what it finds in: the keeper's own, or its
  // group's. `teamWrites` says whether the keeper may also write the team's.
  async function applyReview({ keeper, name, home, numbered, changes, source, teamWrites }: ApplyInput): Promise<number> {
    const store = getStorage()
    const actor = { id: keeper.id, name: keeper.name, auto: true }
    const done: ChangeResult[] = []
    let failed: unknown
    for (const change of changes) {
      // A keeper deleted mid-review keeps no more changes, its team ones included.
      if (rt.botOf(keeper.id) === undefined) return 0
      // Its role may change mid-review too, so each change asks again.
      const team = teamWrites()
      const op = String(change.op ?? '')
      const topic = op === 'add' && change.topic !== undefined ? cleanTopic(String(change.topic)) : undefined
      const target = numbered[Number(change.entry) - 1]
      const scope = op === 'add' ? (change.team === true && team ? store.TEAM : home) : target?.scope === 'team' ? store.TEAM : home
      const label = store.labelOf(scope, keeper.id)
      const text = cleanEntry(change.text)
      const meta: MemoryMetaInput = { source, ...(scope.kind === 'team' ? { by: keeper.name } : {}), added: store.today() }
      try {
        if (op !== 'add' && target === undefined) continue
        if (scope.kind === 'team' && !team) continue
        if ((op === 'add' || op === 'edit') && store.entryProblem(text) !== undefined) continue
        if (op === 'add') done.push(await store.addEntry({ scope, topic, text, meta, actor, label }))
        else if (op === 'edit' && target !== undefined) done.push(await store.replaceEntry({ scope, topic: target.file.topic, match: target.text, text, meta, actor, label }))
        else if (op === 'remove' && target !== undefined) done.push(await store.removeEntry({ scope, topic: target.file.topic, match: target.text, actor, label }))
      } catch (failure) {
        if (errorCode(failure) === GONE) return 0
        rt.warn('moon-bot: memory review of %s left out a change: %s', name, errorMessage(failure))
        if (errorCode(failure) !== NO_MATCH && errorCode(failure) !== DENIED) failed ??= failure
      }
    }
    // A full file or a failed write is no reason to pass the lines: the next
    // review reads them again, and its request shows how full MEMORY.md is.
    if (failed !== undefined) throw failed
    return done.filter(result => result.changed).length
  }

  const roomCopy = (room: StoredRoom | RoomCopy): RoomCopy => ({ id: room.id, name: room.name, seq: typeof room.seq === 'number' ? room.seq : 0, log: [...roomLines(room)] })
  // The log as of `now`, with the lines of an earlier copy that have left it since.
  const joinLogs = (kept: RoomCopy | undefined, now: StoredRoom | RoomCopy): RoomCopy => {
    if (kept === undefined || kept.id !== now.id) return roomCopy(now)
    const oldest = roomLines(now)[0]?.seq ?? Infinity
    return { ...roomCopy(now), log: [...kept.log.filter(line => line.seq < oldest), ...roomLines(now)] }
  }

  // What a Session's turn gives the review: its Bot's own chat, or its group with a
  // copy of the group's log as of now. `key` is where the review keeps its place.
  const reviewOf = (sessionId: string | undefined): Seen | undefined => {
    if (sessionId === undefined) return undefined
    const chat = rt.chatOwners.get(sessionId)
    if (chat !== undefined) return { key: `chat:${sessionId}`, sessionId, botId: chat }
    const owner = rt.groupOwners.get(sessionId) ?? rt.pastOwners.get(sessionId)
    if (owner === undefined) return undefined
    if (owner.roomId === undefined) return { key: `chat:${sessionId}`, sessionId, botId: owner.botId }
    const room = rt.roomOf(owner.roomId)
    return room === undefined ? undefined : { key: `group:${room.id}`, roomId: room.id, room: roomCopy(room) }
  }

  // A Bot's own chat, kept in its own memory. A context switch during the wait leaves
  // the Session an earlier part, still the Bot's.
  async function reviewChat(seen: Seen): Promise<void> {
    const sessionId = seen.sessionId
    if (sessionId === undefined) return
    const bot = rt.botOf(reviewOf(sessionId)?.botId ?? seen.botId)
    if (bot === undefined) return
    const since = cursorsNow()[seen.key]
    await reviewBatch({
      key: seen.key, since, batch: await chatBatch(sessionId, bot, since),
      keeper: bot, name: bot.name, home: getStorage().ownScope(bot.id), teamWrites: () => getStorage().writesTeam(bot.id),
      who: `The Bot: ${bot.name}${bot.role ? `, ${bot.role}` : ''}.`,
      tag: { sessionId: rt.chatOf(bot.id), kind: 'memory' },
      alive: () => rt.botOf(bot.id) !== undefined,
      next: () => queueReview(seen),
    })
  }

  // A group chat, kept in the group's memory and read once for all its members.
  // `seen.room` holds the lines that left the log while the review waited, so who
  // has joined or left since changes nothing. A deleted group's memory is archived
  // with it, so nothing more is kept of it.
  async function reviewGroup(seen: Seen): Promise<void> {
    const roomId = seen.roomId
    if (roomId === undefined) return
    const store = getStorage()
    const live = rt.roomOf(roomId)
    const keeper = live === undefined ? undefined : store.keeperOf(live)
    if (keeper === undefined || live === undefined) return
    const room = joinLogs(seen.room, live)
    const since = cursorsNow()[seen.key]
    const members = (live.members ?? []).map(id => rt.botOf(id)).filter((bot): bot is StoredBot => bot !== undefined).map(bot => `${bot.name}${live.admin === bot.id ? ' (admin)' : ''}`)
    await reviewBatch({
      key: seen.key, since, batch: groupBatch(room, since),
      keeper, name: `group "${live.name}"`, home: store.groupScope(live.id), teamWrites: () => false, group: true,
      who: `The group chat: "${live.name}", with the user and ${members.join(', ')}.`,
      tag: { sessionId: live.id, kind: 'memory' },
      alive: () => rt.botOf(keeper.id) !== undefined && (rt.roomOf(live.id)?.members ?? []).includes(keeper.id),
      next: () => queueReview({ ...seen, room }),
    })
  }

  // One review from the conversation's place `since`: `home` is where it keeps what it
  // finds, `keeper` the Bot whose model reads, `who` whose memory it is. `alive` says
  // whether the keeper, and the group, are still there to keep it.
  async function reviewBatch({ key, since, batch, keeper, name, home, teamWrites, group = false, who, tag, alive, next }: BatchInput): Promise<void> {
    const store = getStorage()
    // The cursor only moves forward.
    if (batch.through === undefined || (since !== undefined && batch.through <= since)) return
    // A backlog past the text limit is read in passes, oldest first, so the cursor
    // only passes lines the model has seen.
    const fresh = fitted(batch.fresh, keeper)
    const read = batch.fresh.slice(0, fresh.count)
    const more = fresh.count < batch.fresh.length
    let through: number | undefined = more ? read.at(-1)?.seq ?? batch.through : batch.through
    let again = more
    // A first review fixes where it starts before the model call, so a failure
    // leaves a cursor that the next review goes on from.
    if (since === undefined && read.length > 0) {
      const first = read[0]
      if (first !== undefined) cursorsNow()[key] = first.seq - 1
      await store.writeText(cursorsPath, JSON.stringify(cursors))
    }
    // Only the user's words are kept, so lines without any need no model call.
    if (read.some(line => line.who === 'user')) {
      const homeFiles = store.loadScope(home)
      const teamFiles = store.loadScope(store.TEAM)
      const said = read.filter(line => line.who === 'user').map(line => line.text).join('\n')
      const tagged = group ? 'group' : 'own'
      const { numbered, left } = reviewEntries(homeFiles, teamFiles, REVIEW_MEMORY_MAX, said, tagged)
      const sizes = { home: homeFiles[0]?.content.length ?? 0, team: teamFiles[0]?.content.length ?? 0 }
      const earlier = batch.earlier.map(line => reviewLine(line.who, line.text, keeper))
      const language = writtenIn(read.filter(line => line.who === 'user').map(line => line.text.replace(/^User: /, '')), languageNow())
      const reply = await botShot(keeper, reviewSystem({ teamWrites: teamWrites(), group }), reviewRequest({ who, tag: tagged, numbered, left, sizes, where: batch.where, earlier, fresh: fresh.texts, more, language }), tag)
      const changes = parseReview(reply)
      if (changes === undefined) throw new Error(`the model's answer is not a list of changes: ${clip(reply.replace(/\s+/g, ' '), 120)}`)
      const unknown = changes.find(change => change.op !== 'add' && numbered[Number(change.entry) - 1] === undefined)
      if (unknown !== undefined) throw new Error(`the model's answer names entry ${String(unknown.entry)}, which is not listed`)
      // A secret is left out for good; any other entry memory cannot keep (one too
      // long, say) fails the answer, so the next review reads the lines again.
      const applied = changes.slice(0, REVIEW_CHANGES_MAX)
      const unfit = applied.filter(change => change.op !== 'remove').map(change => cleanEntry(change.text)).find(text => !store.secretEntry(text) && store.entryProblem(text) !== undefined)
      if (unfit !== undefined) throw new Error(`the model's answer holds an entry memory cannot keep: ${String(store.entryProblem(unfit))}`)
      const badTopic = applied.find(change => change.op === 'add' && typeof change.topic === 'string' && change.topic.trim() !== '' && cleanTopic(change.topic) === undefined)
      if (badTopic !== undefined) throw new Error(`the model's answer names the topic "${clip(String(badTopic.topic), 60)}", which cannot be a topic name`)
      if (!alive()) return
      const changed = await applyReview({ keeper, name, home, numbered, changes: applied, source: batch.source(read), teamWrites })
      if (!alive()) return
      // An answer at the limit may have left some out, so the same lines are read
      // again, a few times at most, while each pass still changes something.
      const prior = overflowed.get(key)
      const passes = prior !== undefined && prior.since === since ? prior.passes : 0
      if (changes.length >= REVIEW_CHANGES_MAX && changed > 0 && passes < REVIEW_PASSES_MAX) {
        overflowed.set(key, { since, passes: passes + 1 })
        through = since
        again = true
      } else {
        overflowed.delete(key)
      }
    }
    const now = cursorsNow()[key]
    if (through !== undefined && (now === undefined || through > now)) {
      cursorsNow()[key] = through
      await store.writeText(cursorsPath, JSON.stringify(cursors))
    }
    if (again) next()
  }

  /** @type {Map<string, {since: number | undefined, passes: number}>} */
  const overflowed = new Map<string, { readonly since: number | undefined; readonly passes: number }>()
  const reviewTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const reviewQueue = new Map<string, Seen>()
  let reviewChain: Promise<unknown> = Promise.resolve()
  let reviewsRunning = 0
  const memoryReviews = (): number => reviewTimers.size + reviewQueue.size + reviewsRunning
  // A conversation waits in the line once: a later turn's copy of a group log joins
  // the one that already waits.
  function queueReview(seen: Seen): void {
    const prior = reviewQueue.get(seen.key)
    if (prior !== undefined) {
      if (seen.room !== undefined) reviewQueue.set(seen.key, { ...seen, room: joinLogs(prior.room, seen.room) })
      return
    }
    reviewQueue.set(seen.key, seen)
    reviewChain = reviewChain.then(async () => {
      const waited = reviewQueue.get(seen.key)
      reviewQueue.delete(seen.key)
      reviewsRunning += 1
      try {
        if (waited !== undefined && rt.readOnly() === undefined) await (waited.roomId === undefined ? reviewChat(waited) : reviewGroup(waited))
      } catch (error) {
        rt.warn('moon-bot: memory review of %s failed: %s', waited?.key ?? seen.key, errorMessage(error))
      } finally {
        reviewsRunning -= 1
      }
    })
  }

  if (reviewOn) {
    // What each running turn gave when it began: a member removed from its group
    // mid-turn leaves a Session that no longer has one when it ends.
    const turnOwners = new Map<string, Seen | undefined>()
    // A turn that starts again before the delay is over is reviewed when it ends.
    ctx.on<ReviewStatus>('agent/status', ({ agent, status }) => {
      const id = agent?.id
      if (id === undefined || (!rt.isBotSession(id) && !turnOwners.has(id))) return
      clearTimeout(reviewTimers.get(id))
      reviewTimers.delete(id)
      if (status !== 'idle') {
        if (!turnOwners.has(id)) turnOwners.set(id, reviewOf(id))
        return
      }
      const started = turnOwners.get(id)
      turnOwners.delete(id)
      const seen = reviewOf(id) ?? started
      if (seen === undefined) return
      const timer = setTimeout(() => {
        reviewTimers.delete(id)
        queueReview(seen)
      }, delay)
      timer.unref?.()
      reviewTimers.set(id, timer)
    })
    ctx.effect(() => () => {
      for (const timer of reviewTimers.values()) clearTimeout(timer)
      reviewTimers.clear()
      turnOwners.clear()
    }, 'moon-bot: memory review')
  }

  return {
    noteNews,
    delete: (id) => { news.delete(id) },
    memoryNews,
    memoryReviews,
  }
}


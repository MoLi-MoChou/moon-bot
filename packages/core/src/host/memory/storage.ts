// Storage for memory: where a Bot's, a group's and the team's files live, reading and
// writing them one change at a time, who may touch which scope, and the frozen prompt
// section each Session keeps. The text format and the shared shapes are in records.ts.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { replaceFile } from '../files.ts'
import { unquote } from '../text.ts'
import type { StoredBot, StoredRoom } from '../runtime.ts'
import type { MemoryActor, MemoryFile, MemoryScope, TaggedEntry } from './records.ts'
import type {
  AddEntryInput, ChangeResult, MemoryRuntime, MemoryStorage, NoteNews, RemoveEntryInput, ReplaceEntryInput,
  ScopeChoice,
} from '../memory-types.ts'
import {
  DENIED, EMPTY_MAIN, GONE, HEADING, MAIN, MEMORY_LIMITS, NO_MATCH, addLink, errorCode, formatEntry,
  insertEntry, joinLines, looksSecret, matchEntries, parseMemory, removeLink, squash,
} from './records.ts'
import { GROUP_HEADING, memorySection, teamRule } from './prompt.ts'

export interface StorageDeps {
  readonly reviewOn: boolean
  readonly noteNews: NoteNews
}

export interface ActorFields {
  readonly actor: string
  readonly actorName: string
  readonly auto?: boolean | undefined
}

/** Read/write one memory scope, and say who may do it. */
export function createStorage(rt: MemoryRuntime, deps: StorageDeps): MemoryStorage {
  const { config, home, state } = rt
  const root = join(home, 'memory')
  const journalPath = join(root, 'journal.jsonl')
  const dayFormat = new Intl.DateTimeFormat('en-CA', { ...(config.timeZone ? { timeZone: config.timeZone } : {}), year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = (): string => dayFormat.format(Date.now())

  // Ids are Session ids; anything else becomes a hash, so no id can leave the folder.
  const safeId = (id: string): string => (/^[\w-]{1,128}$/.test(id) ? id : createHash('sha256').update(String(id)).digest('hex').slice(0, 32))
  const TEAM: MemoryScope = { kind: 'team' }
  const ownScope = (botId: string): MemoryScope => ({ kind: 'bot', botId })
  const groupScope = (roomId: string): MemoryScope => ({ kind: 'group', roomId })
  const dirOf = (scope: MemoryScope): string => (scope.kind === 'team' ? join(root, 'team') : scope.kind === 'group' ? join(root, 'groups', safeId(scope.roomId)) : join(root, 'bots', safeId(scope.botId)))
  const scopeKey = (scope: MemoryScope): string => (scope.kind === 'team' ? 'team' : scope.kind === 'group' ? `group:${scope.roomId}` : `bot:${scope.botId}`)
  // The group a Session speaks in, an earlier part of it included: none for a Bot's
  // own chat. Writes check membership again, so a member that has left writes nothing.
  const roomIdOf = (sessionId: string | undefined): string | undefined =>
    (sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)?.roomId ?? rt.pastOwners.get(sessionId)?.roomId)
  // The Bot whose model keeps a group's memory: its admin, else its first member.
  const keeperOf = (room: StoredRoom): StoredBot | undefined => {
    const admin = rt.botOf(room.admin ?? undefined)
    if (admin !== undefined) return admin
    return (room.members ?? []).map(id => rt.botOf(id)).find((bot): bot is StoredBot => bot !== undefined)
  }

  const readText = (path: string): string => {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') rt.warn('moon-bot: unreadable memory file %s: %s', path, error)
      return ''
    }
  }
  const topicNames = (scope: MemoryScope): string[] => {
    try {
      return readdirSync(dirOf(scope)).filter(name => name.endsWith('.md') && name !== MAIN).map(name => name.slice(0, -3)).sort()
    } catch {
      return []
    }
  }
  // MEMORY.md first, then the topics by name.
  const loadScope = (scope: MemoryScope): MemoryFile[] => {
    const dir = dirOf(scope)
    return [undefined, ...topicNames(scope)].map((topic): MemoryFile => {
      const file = topic === undefined ? MAIN : `${topic}.md`
      const content = readText(join(dir, file))
      return { topic, file, path: join(dir, file), content, ...parseMemory(content) }
    })
  }
  const limitOf = (file: MemoryFile): number => (file.topic === undefined ? MEMORY_LIMITS.main : MEMORY_LIMITS.topic)
  const fileName = (file: MemoryFile): string => (file.topic === undefined ? MAIN : `topic [[${file.topic}]]`)
  const mainOf = (files: readonly MemoryFile[]): MemoryFile => {
    const main = files[0]
    if (main === undefined) throw new Error('Memory has no MEMORY.md')
    return main
  }

  async function writeText(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, text, 'utf8')
    await replaceFile(temp, path)
  }
  async function journal(record: Readonly<Record<string, unknown>>): Promise<void> {
    await mkdir(root, { recursive: true })
    await appendFile(journalPath, `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`, 'utf8')
  }
  let writing: Promise<unknown> = Promise.resolve()
  const queued = <T>(job: () => Promise<T>): Promise<T> => {
    const run = writing.then(job)
    writing = run.catch(() => {})
    return run
  }
  // Checked when the write runs: a Bot or group chat deleted after the write was
  // queued has its memory archived already, and writing would bring the folder back;
  // nor does a deleted Bot write the team memory, or one no longer Main Bot or group
  // admin, or a group's memory once it has left the group.
  const writable = (scope: MemoryScope, actor: MemoryActor | undefined): void => {
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw new Error(`Memory cannot change now: ${readOnly}`)
    const botActor = actor?.id === 'user' ? undefined : actor?.id
    const gone = [scope.kind === 'bot' ? scope.botId : undefined, botActor].some(id => id !== undefined && rt.botOf(id) === undefined)
    if (gone) throw Object.assign(new Error('That Bot has been deleted'), { code: GONE })
    if (scope.kind === 'group' && rt.roomOf(scope.roomId) === undefined) throw Object.assign(new Error('That group chat has been deleted'), { code: GONE })
    const denied = botActor === undefined ? undefined : writeDenied(scope, botActor)
    if (denied !== undefined) throw Object.assign(new Error(denied), { code: DENIED })
  }

  // ---------------------------------------------------------------------------
  // Who may do what. A Bot reads and writes its own memory and reads the team's;
  // Main Bots and the admins of a group also write the team's; Main Bots read and
  // write every Bot's. The members of a group chat read and write its memory, and
  // only from their conversations in that group. The user may do everything from
  // the memory panel.

  const writesTeam = (botId: string): boolean => rt.isMain(botId) || Object.values(state.rooms).some(room => room.admin === botId)

  // `raw` names a scope: "own", "group", "team", or a Bot. Undefined for the default.
  // "group" is the group the caller speaks in, so no other group's memory can be named.
  function namedScope(raw: unknown, botId: string, roomId: string | undefined): ScopeChoice {
    const value = unquote(raw)
    if (value === '') return {}
    if (/^(own|me|mine|self|yours?|自己|我)$/i.test(value)) return { scope: ownScope(botId) }
    if (/^(group|this group|群|本群|群聊)$/i.test(value)) {
      return roomId === undefined ? { error: 'There is no group memory here: scope "group" is for the group chat you speak in, from your conversation there.' } : { scope: groupScope(roomId) }
    }
    if (/^(team|团队|共享)$/i.test(value)) return { scope: TEAM }
    const bot = rt.findBot(value)
    if (bot === undefined) return { error: `No Bot named ${value}. scope is "own", ${roomId === undefined ? '' : '"group", '}"team", or a Bot's name.` }
    return { scope: ownScope(bot.id) }
  }
  function writeDenied(scope: MemoryScope, botId: string): string | undefined {
    if (scope.kind === 'team') return writesTeam(botId) ? undefined : 'Only Main Bots and group admins write the team memory. Tell a Main Bot with message_bot what the team should know.'
    if (scope.kind === 'group') return (rt.roomOf(scope.roomId)?.members ?? []).includes(botId) ? undefined : 'Only the members of a group chat write its memory.'
    if (scope.botId !== botId && !rt.isMain(botId)) return 'Only a Main Bot can change another Bot\'s memory. Use message_bot to tell that Bot instead.'
    return undefined
  }
  const labelOf = (scope: MemoryScope, botId: string): string => (scope.kind === 'team' ? 'the team memory' : scope.kind === 'group' ? 'the group memory' : scope.botId === botId ? 'your memory' : `${rt.botOf(scope.botId)?.name ?? 'that Bot'}'s memory`)

  // The words an entry may not hold.
  const secretEntry = (text: string): boolean => (rt.redactSecrets?.(text) ?? text) !== text || looksSecret(text)
  function entryProblem(text: string): string | undefined {
    if (text === '') return 'Write the entry to save.'
    if (text.length > MEMORY_LIMITS.entry) return `An entry holds at most ${MEMORY_LIMITS.entry} characters; this one has ${text.length}. Keep one fact per entry, or save the details as several entries in a topic.`
    if (secretEntry(text)) return 'This looks like a key, token, password, or ID number, which memory never keeps. Keys go to request_secret.'
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Changes. Each runs alone, rereads the files, and returns what changed.

  function checkSize(file: MemoryFile, next: string, label: string): void {
    const limit = limitOf(file)
    // A file already past its size (edited by hand) may still shrink.
    if (next.length <= limit || next.length <= file.content.length) return
    throw new Error(file.topic === undefined
      ? `${capital(label)}'s MEMORY.md would have ${next.length} of its ${limit} characters. Make room first: move details into a topic (remember with topic, then forget them here), merge entries with replace, or forget what no longer matters.`
      : `The topic [[${file.topic}]] in ${label} would have ${next.length} of its ${limit} characters. Put the rest in another topic, or forget old entries.`)
  }
  const capital = (text: string): string => (text[0] ?? '').toUpperCase() + text.slice(1)
  const sizeNote = (file: MemoryFile, size: number): string => `${file.file}: ${size} of ${limitOf(file)} characters`
  const allEntries = (files: readonly MemoryFile[]): TaggedEntry[] => files.flatMap(file => file.entries.map(entry => ({ ...entry, file })))
  const actorOf = (actor: MemoryActor): ActorFields => ({ actor: actor.id, actorName: actor.name, ...(actor.auto ? { auto: true } : {}) })

  function addEntry({ scope, topic, text, meta, actor, label }: AddEntryInput): Promise<ChangeResult> {
    return queued(async () => {
      writable(scope, actor)
      const files = loadScope(scope)
      const [same] = matchEntries(allEntries(files), text).filter(entry => squash(entry.text) === squash(text))
      if (same !== undefined) return { changed: false, file: same.file, message: `Already in ${label} (${fileName(same.file)}): "${same.text}". Nothing changed.` }
      const main = mainOf(files)
      let target = topic === undefined ? main : files.find(file => file.topic === topic)
      const fresh = target === undefined
      if (target === undefined) {
        if (files.length - 1 >= MEMORY_LIMITS.topics) throw new Error(`${capital(label)} already has ${MEMORY_LIMITS.topics} topics, the most it holds. Add to one of them (recall lists them), or forget one.`)
        target = { topic, file: `${topic ?? ''}.md`, path: join(dirOf(scope), `${topic ?? ''}.md`), content: '', ...parseMemory(`# ${topic ?? ''}\n`) }
      }
      const base = target.lines.length > 0 ? target.lines : parseMemory(target === main ? EMPTY_MAIN : `# ${topic ?? ''}\n`).lines
      const line = formatEntry(text, meta)
      const next = joinLines(insertEntry(base, line))
      checkSize(target, next, label)
      let index: string | undefined
      if (topic !== undefined && !main.links.includes(topic)) {
        index = joinLines(addLink(main.lines.length > 0 ? main.lines : parseMemory(EMPTY_MAIN).lines, topic))
        checkSize(main, index, label)
      }
      await writeText(target.path, next)
      if (index !== undefined) await writeText(main.path, index)
      await journal({ op: 'add', scope: scopeKey(scope), file: target.file, ...actorOf(actor), after: line })
      deps.noteNews(scope, actor, 'add', line)
      const where = topic === undefined ? MAIN : fresh ? `the new topic [[${topic}]], linked from MEMORY.md` : `topic [[${topic}]]`
      return { changed: true, file: target, message: `Saved to ${label}, in ${where} (${sizeNote(target, next.length)}).` }
    })
  }

  // `topic` narrows where to look; undefined looks in every file of the scope.
  function findOne(files: readonly MemoryFile[], topic: string | undefined, wanted: unknown, label: string): TaggedEntry {
    const pool = topic === undefined ? files : files.filter(file => file.topic === topic)
    const missing = (message: string): Error => Object.assign(new Error(message), { code: NO_MATCH })
    if (topic !== undefined && pool.length === 0) throw missing(`${capital(label)} has no topic [[${topic}]].`)
    const found = matchEntries(allEntries(pool), wanted)
    const shown = String(wanted ?? '').slice(0, 80)
    if (found.length === 0) throw missing(`No entry in ${label}${topic ? ` (topic [[${topic}]])` : ''} matches "${shown}". recall shows what is saved.`)
    if (found.length > 1) throw missing(`"${shown}" matches ${found.length} entries in ${label}; quote more of the one you mean:\n${found.slice(0, 8).map(entry => `- ${entry.text} (${fileName(entry.file)})`).join('\n')}`)
    const only = found[0]
    if (only === undefined) throw missing(`No entry in ${label} matches "${shown}".`)
    return only
  }

  // The entry keeps its place; `topic` only narrows where to look.
  function replaceEntry({ scope, topic, match, text, meta, actor, label }: ReplaceEntryInput): Promise<ChangeResult> {
    return queued(async () => {
      writable(scope, actor)
      const old = findOne(loadScope(scope), topic, match, label)
      const line = formatEntry(text, meta)
      const lines = [...old.file.lines]
      const before = lines[old.line]
      lines[old.line] = line
      const next = joinLines(lines)
      checkSize(old.file, next, label)
      await writeText(old.file.path, next)
      await journal({ op: 'replace', scope: scopeKey(scope), file: old.file.file, ...actorOf(actor), before, after: line })
      deps.noteNews(scope, actor, 'replace', line)
      return { changed: true, file: old.file, message: `Updated in ${label} (${fileName(old.file)}): "${old.text}" is now "${text}".` }
    })
  }

  function removeEntry({ scope, topic, match, actor, label }: RemoveEntryInput): Promise<ChangeResult> {
    return queued(async () => {
      writable(scope, actor)
      const files = loadScope(scope)
      const old = findOne(files, topic, match, label)
      const before = old.file.lines[old.line]
      const lines = old.file.lines.filter((_line, index) => index !== old.line)
      // A topic left with nothing but its title goes, and so does its link.
      const empty = old.file.topic !== undefined && lines.every(line => line.trim() === '' || HEADING.test(line))
      if (empty && old.file.topic !== undefined) {
        await unlink(old.file.path).catch(error => { if (errorCode(error) !== 'ENOENT') throw error })
        const main = mainOf(files)
        if (main.links.includes(old.file.topic)) await writeText(main.path, joinLines(removeLink(main.lines, old.file.topic)))
      } else {
        await writeText(old.file.path, joinLines(lines))
      }
      await journal({ op: 'remove', scope: scopeKey(scope), file: old.file.file, ...actorOf(actor), before, ...(empty ? { removedTopic: true } : {}) })
      deps.noteNews(scope, actor, 'remove', before)
      return { changed: true, file: old.file, message: `Removed from ${label} (${fileName(old.file)}): "${old.text}", all of it, so save again with remember any part that is still true. The change log keeps a copy.${empty ? ` The topic [[${old.file.topic ?? ''}]] was empty, so it is gone too.` : ''}` }
    })
  }

  // ---------------------------------------------------------------------------
  // The prompt section, frozen per Session.

  const frozen = new Map<string, string>()
  const snapshotPath = (sessionId: string): string => join(root, 'snapshots', `${safeId(sessionId)}.md`)
  const sectionSource = {
    isMain: (botId: string): boolean => rt.isMain(botId),
    writesTeam: (botId: string): boolean => writesTeam(botId),
    main: (scope: MemoryScope) => parseMemory(readText(join(dirOf(scope), MAIN))),
    topics: (scope: MemoryScope): readonly string[] => topicNames(scope),
  }
  function sectionFor(sessionId: string | undefined): string {
    if (sessionId === undefined) return ''
    const bot = rt.botOf(rt.selfOf(sessionId))
    if (bot === undefined) return ''
    // A section frozen under another role (made a Main Bot or a group admin since, or no
    // longer one) is frozen again, so the rule it states matches what the tools allow;
    // so is a group Session's section frozen before groups kept a memory.
    const roomId = roomIdOf(sessionId)
    const marks = [teamRule(rt.isMain(bot.id), writesTeam(bot.id)), ...(roomId === undefined ? [] : [GROUP_HEADING])]
    const holds = (text: string): boolean => marks.every(mark => text.includes(mark))
    const kept = frozen.get(sessionId)
    if (kept !== undefined && holds(kept)) return kept
    const path = snapshotPath(sessionId)
    let text = existsSync(path) ? readText(path) : ''
    if (text === '' || !holds(text)) {
      text = memorySection(bot, {
        own: ownScope(bot.id),
        team: TEAM,
        ...(roomId === undefined ? {} : { group: groupScope(roomId) }),
      }, sectionSource, deps.reviewOn)
      if (rt.readOnly() === undefined) {
        try {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(`${path}.tmp`, text, 'utf8')
          renameSync(`${path}.tmp`, path)
        } catch (error) {
          rt.warn('moon-bot: memory snapshot for %s not saved: %s', bot.name, error)
        }
      }
    }
    frozen.set(sessionId, text)
    return text
  }
  // The Session's next render freezes the memory as it is then.
  function renewMemory(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    frozen.delete(sessionId)
    try { unlinkSync(snapshotPath(sessionId)) } catch { /* none saved */ }
  }

  return {
    root, TEAM, ownScope, groupScope, dirOf, scopeKey, safeId, roomIdOf, keeperOf,
    loadScope, allEntries, limitOf, fileName, sizeNote, today, writeText, journal, enqueue: queued,
    addEntry, replaceEntry, removeEntry, writesTeam, namedScope, writeDenied, labelOf, secretEntry,
    entryProblem, sectionFor, renewMemory,
  }
}

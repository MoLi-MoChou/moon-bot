import type { HostRuntime, StoredWork, TurnInfo } from './runtime.js'

// Hand-offs: the work Bots give each other, and what each Bot is doing right now.
//
// A Bot's request to another Bot is a piece of work. What the recipient hands on while
// it works on it hangs below it, and the recipient's answer goes up only once all of
// that came back, together with what came back. Results find their way up by
// themselves, so no Bot needs to message one that waits for it, and that is the one
// hand-off refused. The open works are kept in state.json so a restart waits on.
import { TEXT_KEPT } from './constants.ts'
import { headOf } from './text.ts'

const minutes = (since: number): string => {
  const count = Math.floor((Date.now() - since) / 60_000)
  return count < 1 ? 'for less than a minute' : `for ${count} min`
}

export function install(rt: HostRuntime): void {
  const { state } = rt
  const works = (): Record<string, StoredWork> => (state.works ??= {})
  // What came back, whole; state.json keeps the start of each.
  const whole = new Map<string, string>()
  const save = () => void rt.save().catch(() => {})
  const nameOf = (id: string | undefined): string | undefined => rt.botOf(id)?.name

  // The work a turn does: the request it answers, or the work a result that came back
  // (or a turn picked up again) goes on with.
  const workOf = (info: TurnInfo | undefined): string | undefined => (info === undefined ? undefined
    : info.role === 'request' && info.audience !== 'user' ? info.exchangeId : info.work)

  // `parent`: the work the sender was doing when it sent this one.
  function openWork(id: string, { from, to, parent, fromRoom, room }: { readonly from?: string; readonly to?: string; readonly parent?: string; readonly fromRoom?: string; readonly room?: string }): void {
    const above = parent === undefined ? undefined : works()[parent]
    works()[id] = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(room ? { room } : {}), ...(above ? { parent } : {}), ...(fromRoom ? { fromRoom } : {}), open: [], results: [], at: Date.now() }
    if (above !== undefined) above.open.push(id)
    save()
  }

  // The answer to work `id` is on its way, with `result` from `name`. Returns the work
  // it goes on with. That work keeps waiting until a turn reads the answer (`taken`).
  function closeWork(id: string, name: string, text: string): string | undefined {
    const work = works()[id]
    if (work === undefined) return undefined
    delete works()[id]
    // What it still waits for comes back to it alone.
    for (const child of Object.values(works())) if (child.parent === id) delete child.parent
    const above = work.parent === undefined ? undefined : works()[work.parent]
    if (above !== undefined) {
      above.results.push({ id, name, text: headOf(text, TEXT_KEPT), ...(text.length > TEXT_KEPT ? { length: text.length } : {}) })
      whole.set(id, text)
    }
    for (const result of work.results) whole.delete(result.id)
    save()
    return above === undefined ? undefined : work.parent
  }
  const dropWork = (id: string): void => {
    const work = works()[id]
    if (work === undefined) return
    const parent = work.parent
    delete works()[id]
    const above = parent === undefined ? undefined : works()[parent]
    if (above !== undefined) above.open = above.open.filter(other => other !== id)
    save()
  }

  function taken(workId: string, id: string): void {
    const work = works()[workId]
    if (work === undefined || !work.open.includes(id)) return
    work.open = work.open.filter(other => other !== id)
    save()
  }

  const owns = (botId: string, workId: string | undefined): boolean => workId !== undefined && works()[workId]?.to === botId
  const waits = (workId: string): boolean => (works()[workId]?.open.length ?? 0) > 0
  function hold(workId: string, text: string): void {
    const work = works()[workId]
    if (work === undefined || text === '') return
    work.held = headOf(text, TEXT_KEPT)
    save()
  }
  // Who asked for the work, as the turn that answers a request sees its trigger.
  const askedBy = (workId: string): TurnInfo | undefined => {
    const work = works()[workId]
    return work === undefined ? undefined : { kind: 'bot', role: 'request', exchangeId: workId, senderSessionId: work.from, ...(work.fromRoom ? { senderRoomId: work.fromRoom } : {}) }
  }
  // The answer that goes up: what the Bot said last for this work, then what came back.
  function answerText(workId: string, reply: string, botName: string): string {
    const work = works()[workId]
    const said = reply !== '' ? reply : work?.held ?? ''
    const results = (work?.results ?? []).map(result => {
      const text = whole.get(result.id) ?? result.text
      const cut = whole.has(result.id) || result.length === undefined ? '' : `\n[cut at ${TEXT_KEPT} characters by a restart]`
      return `${result.name}:\n${text}${cut}`
    })
    if (results.length === 0) return said || `${botName} finished without a reply.`
    return [said || `${botName} finished and wrote nothing more.`, `[Handed back to ${botName} for this work]`, ...results].join('\n\n')
  }

  // The Bots waiting for the result of these works: whoever asked for each, and on up.
  function upstreamOf(workIds: readonly string[]): Set<string> {
    const bots = new Set<string>()
    for (const workId of workIds) {
      const seen = new Set<string>()
      for (let id: string | undefined = workId; id !== undefined && !seen.has(id);) {
        const work: StoredWork | undefined = works()[id]
        if (work === undefined) break
        seen.add(id)
        if (work.from !== undefined) bots.add(work.from)
        id = work.parent
      }
    }
    return bots
  }

  // Two requests from one sender belong to the same work when they were sent for it.
  const sameWork = (id: string, parent: string): boolean => (works()[id]?.parent ?? undefined) === (works()[parent] === undefined ? undefined : parent)

  // The works their Bots wait on, outside a turn that does them (`busy`): each with what
  // it handed on that has not come back yet. One that came back waits only to be read.
  const held = (busy: ReadonlySet<string | undefined>) => Object.entries(works())
    .filter(([id, work]) => work.to !== undefined && work.open.length > 0 && !busy.has(id))
    .map(([id, work]) => ({ id, work, out: work.open.map(childId => works()[childId]).filter((child): child is StoredWork => child !== undefined) }))
  const busyWith = (sessionIds: readonly string[]): Set<string | undefined> => new Set(sessionIds.map(sessionId => rt.live.get(sessionId)).filter(entry => entry?.turn !== undefined).map(entry => workOf(entry?.info)))

  // Per Bot, the Bots and groups it waits for, and the Bots it does that work for.
  function waitingView(): Record<string, { bots: string[]; rooms: string[]; for: string[] }> {
    const view: Record<string, { bots: string[]; rooms: string[]; for: string[] }> = {}
    const add = (list: string[], id: string | undefined): void => { if (id !== undefined && !list.includes(id)) list.push(id) }
    for (const { work, out } of held(busyWith([...rt.live.keys()]))) {
      if (out.length === 0) continue
      const entry = (view[work.to ?? ''] ??= { bots: [], rooms: [], for: [] })
      for (const child of out) add(child.room ? entry.rooms : entry.bots, child.room ?? child.to)
      add(entry.for, work.from)
    }
    return view
  }

  // A deleted Bot answers no more work and waits for none.
  function forgetBot(botId: string): (TurnInfo | undefined)[] {
    const waiting = Object.entries(works()).filter(([, work]) => work.to === botId).map(([id]) => askedBy(id))
    for (const [id, work] of Object.entries(works())) if (work.from === botId && work.to !== botId) dropWork(id)
    return waiting
  }

  // What a Bot is doing, in one line for the Bots that work with it.
  function statusOf(botId: string): string {
    const chat = rt.chatOf(botId)
    const sessions = [...new Set([chat, ...(rt.groupSessionsOf?.(botId) ?? [])])]
    const place = (sessionId: string): string => {
      const room = rt.roomOf(rt.groupOwners.get(sessionId)?.roomId)
      return room ? `in group "${room.name}"` : 'in its own chat'
    }
    const forWhom = (sessionId: string, info: TurnInfo | undefined): string => {
      if (rt.groupOwners.has(sessionId)) return info?.askedBy && nameOf(info.askedBy) ? `, for ${nameOf(info.askedBy)}` : ''
      const workId = workOf(info)
      const asker = info?.role === 'request' || info?.role === 'stopped' ? info.senderSessionId : workId === undefined ? undefined : works()[workId]?.from
      if (asker !== undefined) return nameOf(asker) ? `, for ${nameOf(asker)}` : ''
      return info === undefined ? ', for the user' : ''
    }
    const doing = (entry: import('./runtime.js').LiveEntry): string => {
      const what = rt.doingOf?.(entry) ?? {}
      if (what.tool) return `: running ${what.tool}${what.target ? ` on ${what.target}` : ''}`
      return what.said ? `: "${what.said.slice(0, 100)}"` : ''
    }
    const lines: string[] = []
    const approval = (rt.approvalsView?.() ?? []).find(entry => entry.botId === botId)
    const switching = [...(rt.switchJobs?.() ?? [])].find(job => job.botId === botId)
    const running = sessions.filter(sessionId => rt.live.get(sessionId)?.turn !== undefined)
    if (approval !== undefined) lines.push(`waiting for the user's approval to run ${approval.tool || 'a tool'} ${place(approval.sessionId)} (${minutes(approval.at)})`)
    else if (switching !== undefined) lines.push(`moving on to a fresh part of its ${switching.roomId ? `conversation in group "${rt.roomOf(switching.roomId)?.name ?? '?'}"` : 'own chat'}`)
    for (const sessionId of approval === undefined && switching === undefined ? running : []) {
      const entry = rt.live.get(sessionId)
      if (entry === undefined) continue
      lines.push(`working ${place(sessionId)} ${minutes(entry.since ?? Date.now())}${forWhom(sessionId, entry.info)}${doing(entry)}`)
    }
    for (const { work, out } of held(busyWith(running))) {
      if (work.to !== botId) continue
      const forName = nameOf(work.from) ? `, for ${nameOf(work.from)}` : ''
      const on = [...new Set(out.map(child => (child.room ? `group "${rt.roomOf(child.room)?.name ?? 'a group'}"` : nameOf(child.to) ?? 'a teammate')))]
      lines.push(on.length > 0 ? `waiting for ${on.join(' and ')} to hand back work${forName}` : `about to go on with work${forName}, whose results came back`)
    }
    if (lines.length === 0) lines.push('idle')
    if (state.questions?.[chat] !== undefined) lines.push('a question card in its own chat waits for the user\'s answer')
    if (state.views?.[chat] !== undefined) lines.push('a view card in its own chat waits for the user\'s answer')
    const unread = new Map<string, number>()
    for (const args of rt.unreadOf?.(chat) ?? []) {
      const name = nameOf(args.fromId)
      if (name !== undefined) unread.set(name, (unread.get(name) ?? 0) + 1)
    }
    if (unread.size > 0) lines.push(`not read yet: ${[...unread].map(([name, count]) => `${count} from ${name}`).join(', ')}`)
    return lines.join('; ')
  }

  Object.assign(rt, { workOf, openWork, closeWork, dropWork, takenWork: taken, ownsWork: owns, waitsWork: waits, holdWork: hold, workAsker: askedBy, answerText, upstreamOf, sameWork, forgetBotWork: forgetBot, statusOf, waitingView })
}

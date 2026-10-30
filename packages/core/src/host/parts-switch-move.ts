// Moving one part on to a fresh Session: what the fresh part carries, the model it runs
// on, the working folder it starts in, and the input the old part hands over. The switch
// lifecycle and its state tables stay in `parts-switch.ts`, which owns this factory.
import { createUserMessage } from './llm-bits.ts'
import type { LlmMessageSource } from './host-types.js'
import { REPLY_KIND, SOURCE_KIND } from './constants.ts'
import { estimateTokens, splitRef } from './text.ts'

import type { SwitchOwner, SwitchMessage, InboxTarget, SwitchSession, SwitchAgent, SwitchSegment, SwitchBot, SwitchJob, HandoffLines, WrittenNote, FreshRoute, PartMoveOptions, PartMove } from './parts-switch-move-types.ts'
export type {
  SwitchOwner,
  SwitchMessage,
  InboxTarget,
  SwitchInbox,
  SwitchEvent,
  SwitchSession,
  SwitchAgent,
  SwitchFallback,
  SwitchSegment,
  SwitchPart,
  SwitchBot,
  SwitchRoom,
  SwitchJob,
  SwitchTables,
  SwitchState,
  Lines,
  HandoffLines,
  WrittenNote,
  HandoffPackageOptions,
  SwitchLiveEntry,
  PartMoveRuntime,
  PartMoveOptions,
  PartMove,
} from './parts-switch-move-types.ts'

export const FOLDER_RETRY_MS = 300_000

export function createPartMove({ ctx, rt, state, tables, placeOf, tokensOf, contextLines, writeNote, handoffLines, handoffPackage, handoffSource, partsOf, recentTokens, noteTimeoutMs, noteCooldownMs }: PartMoveOptions): PartMove {
  const currentOf = (owner: SwitchOwner): string | undefined => (owner.roomId === undefined ? rt.chatOf(owner.botId) : rt.roomOf(owner.roomId)?.sessions[owner.botId])

  // Input for an earlier part goes on in the current one: a browser may still show the
  // old part, and a turn stopped for a switch hands on what it claimed.
  async function forward(owner: SwitchOwner, messages: readonly SwitchMessage[]): Promise<void> {
    const target = currentOf(owner)
    if (target === undefined || messages.length === 0) return
    await rt.ensureCapabilities(target)
    const agent = await rt.resolveAgent(target)
    // A retry after a forward that stopped halfway must not deliver the same input twice.
    const pending: { readonly source?: LlmMessageSource | undefined }[] = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    for (const message of messages) {
      const kind = message.source?.kind
      // the host's notice of a folder change is about the Session it was queued in; the part
      // that goes on has its own folder, which its handoff names.
      if (kind === 'working-directory') continue
      const exchangeId = message.source?.exchangeId
      if (exchangeId !== undefined && pending.some(queued => queued.source?.exchangeId === exchangeId)) continue
      const copy = createUserMessage({ content: message.content ?? [], ...(message.source ? { source: message.source } : {}) })
      if (kind === 'user' || kind === SOURCE_KIND || kind === REPLY_KIND) agent.followup(copy)
      else agent.inject(copy)
      pending.push(copy)
    }
    await ctx.sessions.flush(agent.session)
  }

  // A message's inbox boundary, the same one forward() delivers it to.
  const inboxTargetOf = (message: SwitchMessage): InboxTarget => (message.source?.kind === 'user' || message.source?.kind === SOURCE_KIND || message.source?.kind === REPLY_KIND ? 'next-turn' : 'next-step')

  // Input a switch could not hand on goes back into the part's own durable inbox, in
  // order: input followup would deliver waits for the next turn, the rest waits for
  // the next step. agent.inbox writes do not touch this plugin's context, so they
  // still work while it is being unloaded.
  const restore = (agent: SwitchAgent, messages: readonly SwitchMessage[]): void => {
    for (const message of [...messages].reverse()) {
      const exchangeId = message.source?.exchangeId
      const pending = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
      if (pending.some(queued => queued.id === message.id || (exchangeId !== undefined && queued.source?.exchangeId === exchangeId))) continue
      agent.inbox.prepend(inboxTargetOf(message), message)
    }
  }

  // Input in the inbox is durable but does not wake the driver; send() is what wakes
  // it. Re-send what waits, in order, the first message with the wake, so a stopped
  // turn goes on without waiting for the next input. Only while the plugin is live —
  // a turn that starts during unload would run without DS Bot's hooks.
  const wake = (agent: SwitchAgent): void => {
    const pending = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    for (const message of pending) agent.inbox.remove(message.id)
    pending.forEach((message, index) => agent.send(message, inboxTargetOf(message), index === 0))
  }

  // A switch that lost its move or its input to a failure leaves its part marked in
  // state.switching. Hand on what it kept: input an earlier part still holds goes to
  // the part that replaced it and the earlier part is archived as the switch meant
  // to; a part that stayed just wakes so its kept input goes on.
  async function heldBack(): Promise<void> {
    await rt.load()
    if (rt.readOnly() !== undefined) return
    for (const [sessionId, owner] of Object.entries(state.switching ?? {})) {
      try {
        const agent = await rt.resolveAgent(sessionId)
        const held = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
        if (currentOf(owner) !== sessionId) {
          await forward(owner, held)
          for (const message of held) agent.inbox.remove(message.id)
          await ctx.workspaceRegistry.archiveSession(sessionId).catch(error => rt.warn('moon-bot: earlier part %s not archived: %s', sessionId, error))
        } else {
          try {
            wake(agent)
          } catch (error) {
            rt.warn('moon-bot: part %s could not be woken for its kept input: %s', sessionId, error)
          }
        }
        delete state.switching[sessionId]
        await rt.save()
      } catch (error) {
        rt.warn('moon-bot: input kept in part %s was not handed on: %s', sessionId, error)
      }
    }
  }

  // A fresh part runs on the Bot's model. The earlier part's route is what its last
  // request used, which misses a model the user picked since, so it counts only for a
  // Bot without a model of its own.
  async function freshRoute(bot: SwitchBot, session: SwitchSession): Promise<FreshRoute | undefined> {
    const ref = await rt.desiredModel(bot)
    if (ref !== undefined) return { ref, effort: await rt.desiredEffort(bot, ref) }
    const route = session.requestHeader()?.config
    return route?.provider && route?.model ? { ref: `${route.provider}/${route.model}`, effort: route.reasoningEffort } : undefined
  }
  const selectRoute = (bot: SwitchBot, sessionId: string, { ref, effort }: FreshRoute): Promise<unknown> => {
    const split = splitRef(ref)
    const route = split === undefined ? {} : split
    return rt.selectSessionModel(sessionId, { ...route, ...(effort === undefined ? {} : { reasoningEffort: effort }) }).catch(error => rt.warn('moon-bot: model for the fresh part of %s not applied: %s', bot.name, error))
  }

  // The folder a part should move to, when it is not the one the part was made in. A
  // working folder that is gone counts as the team workspace, where a fresh part would
  // start. A group reply ends where it began; the group conversation moves at its next
  // turn there.
  async function folderMove(agent: SwitchAgent, { midTurn = false }: { readonly midTurn?: boolean | undefined } = {}): Promise<string | undefined> {
    const place = placeOf(agent.id)
    const cwd = agent.session.header?.cwd
    if (place === undefined || cwd === undefined || (midTurn && place.roomId !== undefined) || Date.now() < (tables.folderRetry.get(agent.id) ?? 0)) return undefined
    const wanted = rt.workDirOf(place)
    const usable = wanted !== undefined && (await rt.isFolder(wanted))
    // A team copied from another DSH_HOME has no team workspace here until one is made, and its
    // Sessions still work in the old one.
    if (!usable && rt.teamFolder() === undefined) await rt.ensureWorkspace()
    const target = usable ? wanted : rt.teamFolder()
    return target === undefined || target === cwd ? undefined : target
  }

  async function moveOn(agent: SwitchAgent, job: SwitchJob, signal: AbortSignal): Promise<void> {
    job.started = true
    const bot = rt.botOf(job.botId)
    const room = rt.roomOf(job.roomId)
    if (bot === undefined || (job.roomId !== undefined && room === undefined)) return
    const session = agent.session
    const tokens = tokensOf(session)
    const lines = await contextLines(session).catch(() => undefined)
    const parts = partsOf(bot.id, room?.id)
    const number = parts.length
    const budget = Math.min(recentTokens, Math.floor((lines?.check ?? 4 * recentTokens) / 4))
    const readLines = async (): Promise<HandoffLines> => (job.bare ? { recent: [], earlier: [], unlisted: 0, complete: true } : handoffLines(agent.id, { budget, group: room !== undefined, number }))
    let carried: HandoffLines | undefined = job.folder ? await readLines() : undefined
    // A short part with no tool work goes over word for word, so it needs no note.
    const whole = carried?.whole === true && !session.deriveMessages().some(message => message.role === 'tool')
    let written: WrittenNote | undefined
    let failure: unknown
    if (!job.overflow && job.failed === undefined && !whole) {
      try {
        written = await writeNote(agent, AbortSignal.any([signal, AbortSignal.timeout(noteTimeoutMs)]), { folder: job.folder })
      } catch (error) {
        if (signal.aborted) throw error
        failure = error
      }
    }
    // Below the hard line a part without a good note stays as it is: it still works,
    // and a later try may write one.
    if (written === undefined && !job.hard) {
      const count = (tables.noteFailures.get(agent.id)?.count ?? 0) + 1
      const wait = noteCooldownMs[Math.min(count, noteCooldownMs.length) - 1] ?? noteCooldownMs[noteCooldownMs.length - 1] ?? 0
      tables.noteFailures.set(agent.id, { count, until: Date.now() + wait })
      job.noteFailed = true
      rt.warn('moon-bot: handoff note for %s failed (%d in a row); part %d goes on, next try in %ds: %s', bot.name, count, number, wait / 1000, failure)
      return
    }
    if (failure !== undefined) rt.warn('moon-bot: handoff note for %s failed past the hard line; moving on with the earlier note: %s', bot.name, failure)
    const previous = parts.at(-2)
    const noted: Pick<SwitchSegment, 'note' | 'noteFrom' | 'fallback'> =
      written !== undefined ? { note: written.note } : { fallback: whole ? 'whole' : job.failed !== undefined ? 'failure' : job.overflow ? 'overflow' : 'failed', ...(previous?.note ? { note: previous.note, noteFrom: previous.noteFrom ?? previous.number } : {}) }
    carried ??= await readLines()
    if (signal.aborted) throw signal.reason
    const dir = rt.workDirOf(job)
    const intended = dir !== undefined && (await rt.isFolder(dir)) ? dir : rt.teamFolder()
    const freshId = await rt.createSession(room ? `${bot.name} · ${room.name}` : bot.name, { dir })
    const picked = await freshRoute(bot, session)
    if (picked !== undefined) await selectRoute(bot, freshId, picked)
    await rt.applyPermission(bot, freshId, room).catch(error => rt.warn('moon-bot: permission for the fresh part of %s not applied: %s', bot.name, error))
    // The fresh part took several awaits: a Bot or group deleted meanwhile, a member that
    // left, or a part that is no longer the current one gets no fresh part.
    const current = room !== undefined ? room.sessions?.[bot.id] : rt.chatOf(bot.id)
    const gone = rt.botOf(bot.id) === undefined || (room !== undefined && (rt.roomOf(room.id) !== room || !room.members.includes(bot.id)))
    if (gone || current !== agent.id) {
      await ctx.workspaceRegistry.archiveSession(freshId, { stopActivity: true }).catch(error => rt.warn('moon-bot: unused fresh part of %s not archived: %s', bot.name, error))
      return
    }
    const segment: SwitchSegment = { sessionId: agent.id, endedAt: Date.now(), ...(tokens !== undefined ? { tokens } : {}), ...noted }
    if (room !== undefined) {
      room.segments ??= {}
      ;(room.segments[bot.id] ??= []).push(segment)
      room.sessions[bot.id] = freshId
    } else {
      ;(bot.segments ??= []).push(segment)
      bot.sessionId = freshId
      // The card's call stays in the old part, so the fresh part shows it in the
      // composer dock, which takes a card without a call.
      if (state.questions[agent.id] !== undefined) {
        const { callId: _call, ...question } = state.questions[agent.id] as { readonly callId?: unknown }
        state.questions[freshId] = question
        delete state.questions[agent.id]
      }
      if (state.views?.[agent.id] !== undefined) {
        const { callId: _call, ...pending } = state.views[agent.id] as { readonly callId?: unknown }
        state.views[freshId] = pending
        delete state.views[agent.id]
      }
    }
    await rt.save()
    // A model the user picked until now went to the earlier part, which was still the
    // Bot's; from here on a change goes to the fresh one.
    const now = await freshRoute(bot, session)
    if (now !== undefined && (now.ref !== picked?.ref || now.effort !== picked?.effort)) await selectRoute(bot, freshId, now)
    if (job.failed !== undefined) tables.rescued.set(freshId, job.bare ? 'bare' : 'carried')
    void rt.moveSchedules(agent.id, freshId)
    job.moved = true
    const resume = job.resume || job.overflow
    // Then what the old part held: the stopped turn's input, then whatever waited. It
    // moves first; only after that does the old inbox give it up, so a failure keeps it.
    const held = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
    const carry: SwitchMessage[] = []
    let folder: string | undefined
    try {
      await rt.ensureCapabilities(freshId)
      const fresh = await rt.resolveAgent(freshId)
      const cwd = fresh.session.header?.cwd
      folder = cwd !== undefined && cwd !== session.header?.cwd ? cwd : undefined
      // A fresh part that is not where it was made for would move on at every step.
      if (intended !== undefined && cwd !== undefined && cwd !== intended) {
        tables.folderRetry.set(freshId, Date.now() + FOLDER_RETRY_MS)
        rt.warn('moon-bot: the fresh part of %s did not start in %s; it works in %s', bot.name, intended, cwd)
      }
      const text = handoffPackage({ room, segment, lines: carried, number: number + 1, resume, overflow: job.overflow, failed: job.failed, bare: job.bare, folder })
      tables.freshParts.set(freshId, estimateTokens(text))
      fresh.followup(createUserMessage({ content: [{ type: 'text', text }], source: handoffSource(job, resume) }))
      await ctx.sessions.flush(fresh.session)
      carry.push(...job.carry.splice(0))
      await forward(job, [...carry, ...held])
    } catch (error) {
      job.kept = true
      try {
        restore(agent, [...carry, ...job.carry.splice(0)])
      } catch {}
      throw error
    }
    for (const message of held) agent.inbox.remove(message.id)
    // Input the old part claimed while the rest moved goes on after it.
    for (let late = job.carry.splice(0); late.length > 0; late = job.carry.splice(0)) {
      await forward(job, late).catch(error => {
        job.kept = true
        try {
          restore(agent, late)
        } catch {}
        throw error
      })
    }
    ctx.logger.info(
      'moon-bot: %s%s moved on to part %d at %d tokens (check line %d, hard line %d); %s; %d latest and %d earlier messages carried%s',
      bot.name,
      room ? ` in ${room.name}` : '',
      number + 1,
      tokens ?? -1,
      lines?.check ?? -1,
      lines?.hard ?? -1,
      written !== undefined ? `note written in ${written.attempts} attempt(s)` : `note put together by Moon Bot (${noted.fallback}${noted.note ? `, carries part ${noted.noteFrom}'s` : ', nothing to carry'})`,
      carried.recent.length,
      carried.earlier.length,
      folder === undefined ? '' : `; now works in ${folder}`,
    )
  }

  return { forward, restore, wake, heldBack, folderMove, moveOn }
}

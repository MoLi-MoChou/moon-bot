// Resetting a Bot: the four things a user can start over, in one place.
//
// Deleting a Bot removes it; resetting keeps the identity — the same id and its place in
// groups — and clears what it remembers instead. The parts are independent because their
// consequences differ: losing memory is not the same as losing the conversation, and
// neither is the same as losing who the Bot is. See docs/plans/2026-10-29-reset-bot.md.
import type { HostRuntime, StoredBot } from './runtime.js'

export type BotResetPart = 'memory' | 'conversation' | 'history' | 'identity'

/** What a reset does, one flag per part the user may pick. */
export interface BotReset {
  readonly memory?: boolean
  readonly conversation?: boolean
  readonly history?: boolean
  readonly identity?: boolean
}

export interface BotResetResult {
  readonly bot: StoredBot
  /** What actually changed, for the sentence the interface shows afterwards. */
  readonly done: readonly BotResetPart[]
  /** Parts that were asked for and could not be done, with why. */
  readonly failed: readonly { readonly part: BotResetPart; readonly reason: string }[]
}

const PART_ORDER: readonly BotResetPart[] = ['memory', 'conversation', 'history', 'identity']

const picked = (reset: BotReset): BotResetPart[] => PART_ORDER.filter(part => reset[part] === true)

/**
 * Resets one Bot. Every part is optional and they compose; with nothing picked this
 * refuses rather than doing something surprising.
 */
/** An RPC body as the parts it names. Only `true` counts, so a missing field resets nothing. */
export const resetFrom = (body: Readonly<Record<string, unknown>>): BotReset => ({
  memory: body.memory === true,
  conversation: body.conversation === true,
  history: body.history === true,
  identity: body.identity === true,
})

export async function resetBot(rt: HostRuntime, id: string, reset: BotReset): Promise<BotResetResult> {
  await rt.load()
  const bot = rt.botOf(id)
  if (bot === undefined) throw new Error('Unknown Bot')
  const parts = picked(reset)
  if (parts.length === 0) throw new Error('Pick at least one thing to reset')
  const readOnly = rt.readOnly()
  if (readOnly !== undefined) throw new Error(`A reset cannot run now: ${readOnly}`)

  const done: BotResetPart[] = []
  const failed: { part: BotResetPart; reason: string }[] = []
  const attempt = async (part: BotResetPart, run: () => Promise<void>): Promise<void> => {
    try {
      await run()
      done.push(part)
    } catch (error) {
      failed.push({ part, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  // Every Session the Bot speaks from: its own chat and its earlier parts, plus the
  // hidden Session it has in each group. Memory and history are kept per Session, and
  // the Bot's own view of a group is a Session too, so a reset has to cover all of them.
  const sessionsOf = (): readonly string[] => {
    const live = rt.botOf(id) ?? bot
    return [...new Set([id, rt.chatOf(id), ...(live.segments ?? []).map(segment => segment.sessionId), ...rt.groupSessionsOf(id)])]
  }

  if (parts.includes('memory')) {
    await attempt('memory', async () => {
      if (rt.clearBotMemory === undefined) throw new Error('Memory is turned off on this host')
      await rt.clearBotMemory(id)
    })
  }

  if (parts.includes('history')) {
    await attempt('history', async () => {
      if (rt.clearSessionHistory === undefined) throw new Error('This host cannot clear a conversation')
      for (const sessionId of sessionsOf()) await rt.clearSessionHistory(sessionId)
    })
  }

  if (parts.includes('conversation')) {
    await attempt('conversation', async () => {
      if (rt.startFreshPart === undefined) throw new Error('This host cannot start a new part')
      // One fresh part for the Bot's own chat; a group Session keeps its own place, so a
      // reset that restarts the conversation restarts it everywhere the Bot speaks.
      for (const sessionId of sessionsOf()) await rt.startFreshPart(sessionId)
    })
  }

  if (parts.includes('identity')) {
    await attempt('identity', async () => {
      const live = rt.botOf(id) ?? bot
      for (const sessionId of sessionsOf()) {
        delete rt.state.questions[sessionId]
        if (rt.state.views !== undefined) delete rt.state.views[sessionId]
        delete rt.state.exchangeTurns[sessionId]
        delete rt.state.switching?.[sessionId]
      }
      // The name stays: renaming is its own decision, and a reset is about what the Bot
      // knows and how it is set up, not what the user calls it.
      delete live.role
      delete live.instructions
      delete live.permission
      delete live.model
      delete live.appliedModel
      delete live.effort
      delete live.appliedEffort
      delete live.workDir
      delete live.avatar
      delete live.lab
    })
  }

  await rt.save()
  return { bot: rt.botOf(id) ?? bot, done, failed }
}

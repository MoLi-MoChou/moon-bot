// What a Session runs with: its folder and its model. A Bot's own chat is easy, and so is a
// member's group Session. A group chat's own Session is the hard case: it runs the relay, not
// a member's work, so it matches no Bot. It used to resolve no model and every group round
// ended as NO-MODEL before the relay could run. It now borrows its admin's model, or its
// first member's.
import type { Runtime } from './engine-helpers.ts'

/** The configuration the engine is handed for one Session. */
export interface SessionConfig {
  readonly cwd?: string
  readonly model?: string
}

/** The Bot whose model a Session borrows when it is a group chat's own Session. */
function ownerOf(runtime: Runtime, id: string): ReturnType<Runtime['botOf']> {
  const botOf = (candidate: string | undefined): ReturnType<Runtime['botOf']> =>
    candidate === undefined ? undefined : runtime.botOf(candidate)
  const bot = botOf(runtime.selfOf(id))
  if (bot !== undefined) return bot
  const room = runtime.roomOf?.(id)
  if (room === undefined) return undefined
  return (
    botOf(room.admin ?? undefined) ??
    room.members
      .map(member => botOf(member))
      .find(member => member !== undefined && (member.appliedModel ?? member.model) !== undefined)
  )
}

/** The folder and model for a Session, as the engine asks for them. */
export function sessionConfigOf(runtime: Runtime, id: string): SessionConfig {
  const botId = runtime.selfOf(id)
  const roomId = runtime.groupOwners?.get(id)?.roomId
  const cwd = runtime.workDirOf?.({ ...(botId ? { botId } : {}), ...(roomId ? { roomId } : {}) })
  const bot = ownerOf(runtime, id)
  const model = bot?.appliedModel ?? bot?.model
  return { ...(cwd ? { cwd } : {}), ...(model ? { model } : {}) }
}

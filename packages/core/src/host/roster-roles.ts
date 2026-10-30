// The Main Bot role and the sidebar flags. A team always keeps at least one Main Bot, and
// a Main Bot's place can be handed over in one step so it never has none.
import type { HostRuntime, StoredState } from './runtime.js'

export interface RosterRoles {
  setMain(id: string, main: boolean, options?: { readonly primary?: boolean; readonly replace?: string }): Promise<void>
  setFlags(id: string, patch: { readonly pinned?: unknown; readonly hidden?: unknown }): Promise<unknown>
}

export function createRosterRoles({ rt, state }: { readonly rt: HostRuntime; readonly state: StoredState }): RosterRoles {
  // The first Main Bot is the sidebar tile. `replace` gives a Main Bot's place to
  // another Bot in one step, so the team never has none; `primary` moves a Bot to the
  // front and keeps the others.
  async function setMain(id: string, main: boolean, { primary = false, replace }: { readonly primary?: boolean; readonly replace?: string } = {}): Promise<void> {
    const bot = rt.botOf(id)
    if (bot === undefined) throw new Error('Unknown Bot')
    const others = state.mainBotIds.filter(other => other !== id)
    let next: string[]
    if (!main) {
      if (!rt.isMain(id)) return
      if (others.length === 0) throw new Error('The team needs at least one Main Bot')
      next = others
    } else if (replace !== undefined && replace !== id) {
      const at = others.indexOf(replace)
      if (at === -1) throw new Error('Only a Main Bot can be replaced')
      next = [...others.slice(0, at), id, ...others.slice(at + 1)]
    } else if (primary) {
      next = [id, ...others]
    } else {
      next = rt.isMain(id) ? state.mainBotIds : [...others, id]
    }
    // The sidebar shows every Main Bot, so a hidden Bot would vanish again once demoted.
    if (main) delete bot.hidden
    // A held setup greeting says "you are the Main Bot"; it must not go out after demotion.
    for (const other of state.mainBotIds.filter(other => !next.includes(other))) {
      const demoted = rt.botOf(other)
      if (demoted?.kickoff?.main === true) delete demoted.kickoff
    }
    state.mainBotIds = next
    await rt.save()
  }

  async function setFlags(id: string, patch: { readonly pinned?: unknown; readonly hidden?: unknown }): Promise<unknown> {
    const entry = rt.botOf(id) ?? rt.roomOf(id) ?? rt.own(state.agents, id)
    if (entry === undefined) throw new Error('Unknown conversation')
    const target = entry as { pinned?: boolean; hidden?: boolean }
    if (typeof patch.pinned === 'boolean') target.pinned = patch.pinned
    if (typeof patch.hidden === 'boolean') target.hidden = patch.hidden
    await rt.save()
    return entry
  }

  return { setMain, setFlags }
}

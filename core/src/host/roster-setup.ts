// A new Bot or group chat needs a Session: in the team workspace, or in a folder of its
// own. This module keeps that setup in one place.
import { mkdir } from 'node:fs/promises'
import type { DshContext } from './dsh-types.js'
import type { HostRuntime, StoredState } from './runtime.js'

interface AgentPresetsService {
  list(): Promise<readonly { readonly id: string; readonly broken?: string }[]>
}

export interface RosterSetup {
  keepTeamFolder(): Promise<string | undefined>
  ensureWorkspace(): Promise<string>
  createSession(title: string, options?: { readonly dir?: string }): Promise<string>
}

export function createRosterSetup({ ctx, rt, state }: {
  readonly ctx: DshContext
  readonly rt: HostRuntime
  readonly state: StoredState
}): RosterSetup {
  // The team folder is DS Bot's own: deleted, it is made again before a Session needs it.
  async function keepTeamFolder(): Promise<string | undefined> {
    const team = rt.teamFolder()
    if (team !== undefined) await mkdir(team, { recursive: true }).catch(error => rt.warn('ds-bot: team folder %s not made again: %s', team, error))
    return team
  }

  async function ensureWorkspace(): Promise<string> {
    const known = state.workspaceId
    if (known !== undefined && ctx.workspaceRegistry.get(known) !== undefined) {
      await keepTeamFolder()
      return known
    }
    const path = rt.defaultTeamFolder()
    await mkdir(path, { recursive: true })
    const workspace = await ctx.workspaceRegistry.resolveByPath(path) ?? await ctx.workspaceRegistry.create(path, 'Moon Bot')
    state.workspaceId = workspace.id
    await rt.save()
    return workspace.id
  }

  // Under the PTC preset (DSH Desktop's default) a model may call only run_code, which
  // turns down the group_relay call that a group chat's Session is given. A Session
  // keeps the preset it is made with.
  async function botPreset(): Promise<{ readonly agentPreset?: string }> {
    const presets = ctx.get<AgentPresetsService>('agentPresets')
    if (presets === undefined) return {}
    const standard = (await presets.list()).some(preset => preset.id === 'standard' && preset.broken === undefined)
    return standard ? { agentPreset: 'standard' } : {}
  }

  // `dir` is a working folder outside the team workspace. Such a Session is made by cwd
  // alone, so it joins no DSH workspace and the user's own project lists stay as they are.
  async function createSession(title: string, { dir }: { readonly dir?: string } = {}): Promise<string> {
    // A Bot's tools run here too; while another instance holds the team, a new Session would
    // belong to no saved Bot.
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw new Error(readOnly)
    const usable = dir !== undefined && await rt.isFolder(dir)
    if (dir !== undefined && !usable) rt.warn('ds-bot: the working folder %s is gone; %s starts in the team workspace', dir, title)
    const place = usable ? { cwd: dir } : { workspaceId: await ensureWorkspace() }
    const { sessionId } = await ctx.sessionController.create({ ...place, ...await botPreset() })
    const agent = await rt.resolveAgent(sessionId)
    await ctx.sessionTitle.rename(agent.session, title)
    return sessionId
  }

  return { keepTeamFolder, ensureWorkspace, createSession }
}

// The engine half of the channel (plan §四): which runtime runs each Bot's turns — the
// built-in one, a local ACP agent, or a remote agent that dialed into the relay (2026-10-27
// remote-agents). The list reads; `engine-set` moves one Bot.
import { capabilitiesFor } from '../../engine/capabilities.ts'
import { canLaunch, healthOf } from '../../engine/health.ts'
import type { ChannelHandler, ChannelHandlers } from './envelope.ts'
import { fail, ok } from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'

/**
 * The relay's admin surface as the channel ops see it; the service wiring provides the
 * registry under `relayRegistry`. Declared here, not imported, so the host layer stays
 * independent of the service that happens to run it.
 */
interface RelayAdmin {
  invitesView(): readonly {
    readonly agentId: string
    readonly createdAt: number
    readonly revokedAt: number | null
    readonly lastSeenAt: number | null
    readonly online: boolean
  }[]
  inviteCreate(agentId: string): { readonly agentId: string; readonly token: string }
  inviteRevoke(agentId: string): boolean
}

export function engineHandlers(rt: ChannelRuntime): ChannelHandlers {
  const { state } = rt
  const ofMap = (): Record<string, string> => {
    const of: Record<string, string> = {}
    for (const bot of Object.values(state.bots)) {
      const engine = bot.engine
      of[bot.id] =
        engine?.kind === 'acp' && typeof engine.key === 'string'
          ? engine.key
          : engine?.kind === 'acp' && typeof engine.command === 'string'
            ? engine.command
            : engine?.kind === 'acp-remote' && typeof engine.agentId === 'string'
              ? `remote:${engine.agentId}`
              : 'builtin'
    }
    return of
  }
  const handlers: Partial<Record<string, ChannelHandler>> = {
    engines: async () => {
      await rt.load()
      const catalog = rt.ctx.get<{
        list(): readonly {
          id: string
          label: string
          command: string
          args: readonly string[]
          key: string
          kind: string
          path?: string
          version?: string
          reason?: string
          onDemand?: boolean
        }[]
      }>('engineCatalog')
      const entries = new Map<string, Record<string, unknown>>([
        [
          'builtin',
          {
            id: 'builtin',
            label: 'Moon Bot built-in',
            kind: 'builtin',
            selectable: true,
            health: 'ready',
            capabilities: capabilitiesFor('builtin'),
          },
        ],
      ])
      for (const agent of catalog?.list() ?? []) {
        entries.set(agent.id, {
          id: agent.id,
          label: agent.label,
          kind: agent.kind,
          command: agent.command,
          args: agent.args,
          key: agent.key,
          selectable: canLaunch(agent),
          health: healthOf(agent),
          capabilities: capabilitiesFor(agent.kind),
          ...(agent.path === undefined ? {} : { path: agent.path }),
          ...(agent.version === undefined ? {} : { version: agent.version }),
          ...(agent.reason === undefined ? {} : { reason: agent.reason }),
          ...(agent.onDemand ? { onDemand: true } : {}),
        })
      }
      const registry = rt.ctx.get<RelayAdmin>('relayRegistry')
      if (registry !== undefined)
        for (const invite of registry.invitesView()) {
          if (invite.revokedAt !== null) continue
          entries.set(`remote:${invite.agentId}`, {
            id: `remote:${invite.agentId}`,
            label: invite.agentId,
            kind: 'acp-remote',
            selectable: true,
            online: invite.online,
            capabilities: capabilitiesFor('acp-remote'),
          })
        }
      return ok({ engines: [...entries.values()], of: ofMap() })
    },
    'engine-set': async body => {
      await rt.load()
      const botId = String(body.botId ?? '')
      const engineId = String(body.engine ?? '')
      if (rt.botOf(botId) === undefined) return fail('Unknown Bot', 'bot/not-found')
      if (engineId === 'builtin') {
        await rt.updateBot(botId, { engine: { kind: 'builtin' }, runtimeId: null })
      } else if (engineId.startsWith('remote:')) {
        const registry = rt.ctx.get<RelayAdmin>('relayRegistry')
        const agentId = engineId.slice('remote:'.length)
        const invite = registry?.invitesView().find(entry => entry.agentId === agentId)
        if (invite === undefined) return fail('Unknown remote agent', 'bot/not-found')
        if (invite.revokedAt !== null) return fail('That invite was revoked', 'bot/invalid')
        await rt.updateBot(botId, { engine: { kind: 'acp-remote', agentId }, runtimeId: `remote:${agentId}` })
      } else {
        const catalog = rt.ctx.get<{
          list(): readonly { id: string; command: string; args: readonly string[]; key: string; kind: string }[]
        }>('engineCatalog')
        const source = catalog?.list().find(candidate => candidate.id === engineId && candidate.kind === 'acp')
        if (source === undefined) return fail('Unknown engine', 'bot/not-found')
        await rt.updateBot(botId, {
          engine: { kind: 'acp', command: source.command, args: source.args, key: source.key },
          runtimeId: source.key,
        })
      }
      return ok({ of: ofMap() })
    },
  }
  return handlers as ChannelHandlers
}

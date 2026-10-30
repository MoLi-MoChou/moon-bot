// The relay half of the channel (2026-10-27 remote-agents): the invites that let an
// external agent dial in. The service wiring provides the registry under
// `relayRegistry`; declared here, not imported, so the host layer stays independent of
// the service that runs it.
import type { ChannelHandler, ChannelHandlers } from './envelope.ts'
import { fail, invalid, ok } from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'

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

export function relayHandlers(rt: ChannelRuntime): ChannelHandlers {
  const registry = (): RelayAdmin | undefined => rt.ctx.get<RelayAdmin>('relayRegistry')
  const handlers: Partial<Record<string, ChannelHandler>> = {
    // The create answer carries the token exactly once; the store keeps only its hash.
    'relay-invites': async () => {
      const admin = registry()
      if (admin === undefined) return fail('The relay is not running', 'bot/unavailable')
      return ok({ invites: admin.invitesView() })
    },
    'relay-invite-create': async body => {
      const admin = registry()
      if (admin === undefined) return fail('The relay is not running', 'bot/unavailable')
      const agentId = String(body.agentId ?? '')
        .trim()
        .slice(0, 120)
      if (agentId === '') throw invalid('a remote agent needs a name')
      return ok(admin.inviteCreate(agentId))
    },
    'relay-invite-revoke': async body => {
      const admin = registry()
      if (admin === undefined) return fail('The relay is not running', 'bot/unavailable')
      admin.inviteRevoke(String(body.agentId ?? ''))
      return ok({ invites: admin.invitesView() })
    },
  }
  return handlers as ChannelHandlers
}

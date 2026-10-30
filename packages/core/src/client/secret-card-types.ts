/** Secret card shared types. */
export const MIN_VALUE = 4
export const NONE: Record<string, number> = {}
// A stored key's scope: every Bot, or the listed Bot ids.
export type SecretScope = 'all' | string[]
// What a save asks for: the card's "only this Bot" choice resolves to `bot` on the host.
export type SecretSetScope = 'all' | 'bot' | string[]
// One saved key as the settings page reads it; the value never comes back.
export interface SecretEntry {
  readonly name: string
  readonly purpose?: string | undefined
  readonly scope: SecretScope
  readonly requestedBy?: string | null | undefined
  readonly createdAt?: number | undefined
  readonly lastUsedAt?: number | undefined
}
// One card a Bot asked for, kept by the host.
export interface SecretRequest {
  readonly id: string
  readonly callId?: string | undefined
  readonly sessionId?: string | undefined
  readonly name: string
  readonly purpose?: string | undefined
  readonly kind: 'fill' | 'allow'
  readonly status?: 'pending' | 'saved' | 'allowed' | 'canceled' | undefined
  readonly scope?: SecretScope | undefined
}
export interface SecretBot {
  id: string
  name: string
}
export interface SecretRoster {
  byId: Record<string, SecretBot | undefined>
  secrets?: readonly SecretEntry[] | undefined
  secretRequests?: Record<string, readonly SecretRequest[] | undefined> | undefined
}
export interface SecretsRoster extends SecretRoster {
  bots: readonly SecretBot[]
}
export interface SecretActions {
  secretSet: (payload: {
    requestId?: string | undefined
    name?: string | undefined
    value: string
    scope?: SecretSetScope | undefined
    purpose?: string | undefined
  }) => Promise<unknown>
  secretAllow: (requestId: string) => Promise<unknown>
  secretCancel: (requestId: string) => Promise<unknown>
  secretUpdate: (name: string, scope: SecretScope) => Promise<unknown>
  secretDelete: (name: string) => Promise<unknown>
  noteHeldCard?: (sessionId: string, kind: string, requestId: string, delta: number) => void
}

export type CardCounts = Record<string, Record<string, number> | undefined>
export type CardsHook = <T>(select: (state: CardCounts) => T) => T

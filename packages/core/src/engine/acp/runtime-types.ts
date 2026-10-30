/** Types extracted from runtime.ts. */
import type { EngineEvent } from '../events.ts'
import type { PermissionRequestParams } from './permission.ts'
import type { AcpTransport } from './transport.ts'
export interface AcpAgentOptions {
  /** The wire to the agent: local stdio or a relay connection. */
  readonly transport: AcpTransport
  /** The client's own name, as the agent sees it in initialize. */
  readonly clientName?: string | undefined
  readonly clientVersion?: string | undefined
  /** Where the emit fanout goes, the same as the built-in engine's. */
  readonly emit: (sessionId: string, event: EngineEvent) => void
  /** Permission handler when agent asks for tool authorization (session/request_permission). */
  readonly requestPermission?: ((sessionId: string, params: PermissionRequestParams) => Promise<string>) | undefined
}
export interface Waiter {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}
export interface AgentSession {
  readonly acpId: string
  turns: number
  updates: ((event: EngineEvent) => void) | undefined
  stop: (() => void) | undefined
}

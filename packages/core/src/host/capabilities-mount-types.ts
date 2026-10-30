/** Types extracted. */
import type { Agent, HostContext, PluginFiber } from './host-types.js'
import type { CapabilityItem, HostRuntime, StoredBot, StoredState } from './runtime.js'
// Mounting capabilities into a Session: an MCP server or a skill becomes a fiber on the
// Agent's own context, so it lives as long as that Session does and goes away with it.
// One reconcile chain per Agent: a slow MCP server holds up only its own Agent.

export type CapabilityState = 'error' | 'needs-approval' | 'connecting' | 'ready'

export interface CapabilityStatus {
  readonly state: CapabilityState
  readonly error?: string
}
export interface MountRecord {
  readonly key: string
  readonly fiber: PluginFiber | undefined
  /** The standalone mount's own teardown (no the host fiber involved). */
  readonly drop?: (() => void) | undefined
}
export interface MountOptions {
  readonly ctx: HostContext
  readonly rt: HostRuntime
  readonly state: StoredState
  library(): Record<string, CapabilityItem>
  expand(names: readonly string[] | undefined): Set<string>
}
export interface CapabilityMounts {
  reconcile(): Promise<void>
  scheduleReconcile(): Promise<unknown>
  ensureCapabilities(sessionId: string): Promise<void>
  prepare(agent: Agent, sessionId: string): Promise<void>
  trackAgent(agent: Agent | undefined): void
  trackBotAgents(bot: StoredBot): Promise<void>
  statusFor(botId: string, name: string): CapabilityStatus | undefined
  statusesView(): Record<string, Record<string, CapabilityStatus>>
  /** The tools a capability currently serves, by its own name; packs merge their children. */
  toolsView(): Record<string, readonly string[]>
  /** The `rt.secretsChanged` hook: a secret changed, so re-out everything. */
  wrapSecretsChanged(previous: (() => void) | undefined): () => void
  dispose(): Promise<void>
}
export type StatusMap = Map<string, Map<string, Map<string, CapabilityStatus>>>

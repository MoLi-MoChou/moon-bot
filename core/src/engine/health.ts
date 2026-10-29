// What discovery already established about an engine. Nothing here probes, logs in,
// or decides that a version is too old.

export type EngineHealth = 'ready' | 'unversioned' | 'on-demand' | 'unsupported' | 'missing'

export interface HealthInput {
  readonly kind: string
  readonly path?: string | undefined
  readonly version?: string | undefined
  readonly onDemand?: boolean | undefined
}

/** The status a discovered row already supports. Remote online/offline is not this. */
export function healthOf(agent: HealthInput): EngineHealth {
  if (agent.onDemand === true) return 'on-demand'
  if (agent.kind === 'unsupported') return 'unsupported'
  if (agent.kind === 'builtin') return 'ready'
  if (agent.path === undefined || agent.path === '') return 'missing'
  if (agent.version === undefined || agent.version === '') return 'unversioned'
  return 'ready'
}

/** A row the runner may launch. A missing candidate stays on the list but is not started. */
export function canLaunch(agent: HealthInput): boolean {
  if (agent.onDemand === true) return agent.kind === 'acp'
  return agent.kind === 'acp' && agent.path !== undefined && agent.path !== ''
}

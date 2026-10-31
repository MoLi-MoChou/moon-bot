// What an engine can actually do, as data. A discovery result that only says "ACP" tells the
// settings page nothing about whether prompts will work, whether the agent asks for
// permission, or what a user should do when it does not. This turns a doctor report into
// that answer, in one shape the CLI can print and the UI can render.
import type { DoctorReport, DoctorStepName } from './doctor.ts'

/** What an engine can do, and what a user should do when it cannot. */
export interface EngineCapabilityReport {
  readonly id: string
  /** Whether a real turn can run on this engine at all. */
  readonly usable: boolean
  readonly supportsTools: boolean
  readonly supportsPermissions: boolean
  readonly supportsResume: boolean
  readonly supportsModelDiscovery: boolean
  readonly supportsUsage: boolean
  /** A stable code for the first check that failed, or undefined when everything passed. */
  readonly failureCode?: string | undefined
  /** Where to go instead, when this engine cannot be used here. */
  readonly recommendedFallback?: string | undefined
}

/** The methods an agent advertises, as the doctor records them. */
export interface EngineMethods {
  readonly methods: readonly string[]
}

// Which advertised method enables which capability. An agent that does not list a method is
// not assumed to have it.
const HAS = {
  tools: ['session/prompt'],
  permissions: ['session/request_permission'],
  resume: ['session/load', 'session/resume'],
  modelDiscovery: ['session/set_model', 'session/models', 'models/list'],
  usage: ['session/usage', 'usage'],
} as const

const STEP_CODE: Record<DoctorStepName, string> = {
  executable: 'ENGINE_MISSING',
  version: 'ENGINE_VERSION_UNKNOWN',
  handshake: 'ENGINE_HANDSHAKE_FAILED',
  session: 'ENGINE_SESSION_FAILED',
}

/**
 * The report for one engine. A built-in engine has every capability the product promises; an
 * agent's are read from the methods it advertised at handshake, so a method it never
 * mentioned is reported as unsupported rather than assumed.
 */
export function capabilityReportOf(
  report: DoctorReport,
  methods: EngineMethods | undefined,
  kind: string,
): EngineCapabilityReport {
  const advertised = new Set(methods?.methods ?? [])
  const builtin = kind === 'builtin'
  const has = (key: keyof typeof HAS): boolean => builtin || HAS[key].some(name => advertised.has(name))
  const failed = report.steps.find(step => step.status === 'fail')
  const usable = report.ok
  return {
    id: report.id,
    usable,
    supportsTools: usable && has('tools'),
    supportsPermissions: usable && has('permissions'),
    supportsResume: usable && has('resume'),
    supportsModelDiscovery: usable && has('modelDiscovery'),
    supportsUsage: usable && has('usage'),
    ...(usable || failed === undefined
      ? {}
      : {
          failureCode: STEP_CODE[failed.name],
          recommendedFallback: fallbackFor(failed.name, kind),
        }),
  }
}

/**
 * What a user should do instead. A missing binary, a failed handshake and a session that
 * will not open all have their own next step; a remote agent that is not launched here is
 * told to reconnect rather than to install anything.
 */
export function fallbackFor(step: DoctorStepName, kind: string): string {
  if (kind === 'acp-remote') return 'Reconnect the remote agent, or pick a local engine.'
  if (step === 'executable') return 'Install the engine, or pick one that is already installed.'
  if (step === 'version') return 'Update the engine, or pick one with a readable version.'
  if (step === 'handshake') return 'Update the engine to a version that speaks ACP, or pick another engine.'
  return 'The engine could not open a session; restart it, or pick another engine.'
}

/** One JSON object per engine, the shape a script reads. */
export function reportJson(report: EngineCapabilityReport): string {
  return JSON.stringify({
    id: report.id,
    usable: report.usable,
    supportsTools: report.supportsTools,
    supportsPermissions: report.supportsPermissions,
    supportsResume: report.supportsResume,
    supportsModelDiscovery: report.supportsModelDiscovery,
    supportsUsage: report.supportsUsage,
    ...(report.failureCode !== undefined ? { failureCode: report.failureCode } : {}),
    ...(report.recommendedFallback !== undefined ? { recommendedFallback: report.recommendedFallback } : {}),
  })
}

/** The one sentence a settings row shows: what it can do, or what to do instead. */
export function capabilitySummary(report: EngineCapabilityReport): string {
  if (!report.usable) return report.recommendedFallback ?? 'This engine cannot be used here.'
  const missing = [
    report.supportsTools ? null : 'tools',
    report.supportsPermissions ? null : 'approvals',
    report.supportsResume ? null : 'resuming',
  ].filter((name): name is string => name !== null)
  if (missing.length === 0) return 'Ready. Tools, approvals and resuming all work.'
  return `Works, without ${missing.join(', ')}.`
}

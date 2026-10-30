// Four checks for an external engine. The probe is injected so the decision of
// which checks may run never starts a process by itself.

export type DoctorStepName = 'executable' | 'version' | 'handshake' | 'session'

export type DoctorStepStatus = 'ok' | 'fail' | 'skipped'

export interface DoctorStep {
  readonly name: DoctorStepName
  readonly status: DoctorStepStatus
  readonly detail?: string
}

export interface DoctorReport {
  readonly id: string
  readonly ok: boolean
  readonly steps: readonly DoctorStep[]
}

export interface DoctorSubject {
  readonly id: string
  readonly kind: string
  readonly command?: string | undefined
  readonly args?: readonly string[] | undefined
  readonly path?: string | undefined
  readonly version?: string | undefined
  readonly onDemand?: boolean | undefined
  readonly reason?: string | undefined
}

export interface HandshakeFacts {
  readonly agent?: string | undefined
  readonly sessionId?: string | undefined
  readonly methods: readonly string[]
}

export interface DoctorProbe {
  readVersion(path: string): Promise<string | undefined>
  handshake(command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<HandshakeFacts>
}

export interface DoctorOptions {
  readonly cwd: string
  readonly timeoutMs?: number | undefined
}

/** A probe failure tagged with the check that was in progress. */
export class DoctorStepError extends Error {
  readonly step: 'handshake' | 'session'

  constructor(step: 'handshake' | 'session', message: string) {
    super(message)
    this.name = 'DoctorStepError'
    this.step = step
  }
}

const ORDER = ['executable', 'version', 'handshake', 'session'] as const
const TIMEOUT_MS = 8_000

const clip = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/gu, ' ').trim().slice(0, 200)
}

const skipFrom = (from: DoctorStepName, detail: string): DoctorStep[] => {
  const start = ORDER.indexOf(from)
  return ORDER.slice(start).map(name => ({ name, status: 'skipped' as const, detail }))
}

const report = (id: string, steps: readonly DoctorStep[], passed?: boolean): DoctorReport => {
  const filled = ORDER.map(name => steps.find(step => step.name === name) ?? { name, status: 'skipped' as const })
  return { id, ok: passed ?? filled.every(step => step.status === 'ok'), steps: filled }
}

const versionStep = (version: string, failure?: string): DoctorStep =>
  version === ''
    ? { name: 'version', status: 'fail', detail: failure ?? 'no version output' }
    : { name: 'version', status: 'ok', detail: version }

/** Walk executable → version → handshake → one session. Never sends a prompt. */
export async function examine(
  subject: DoctorSubject,
  probe: DoctorProbe,
  options: DoctorOptions,
): Promise<DoctorReport> {
  if (subject.kind === 'builtin') {
    return report(
      subject.id,
      [
        { name: 'executable', status: 'ok', detail: 'built-in engine' },
        ...skipFrom('version', 'not an external process'),
      ],
      true,
    )
  }
  if (subject.onDemand === true) {
    const version = subject.version?.trim() ?? ''
    return report(subject.id, [
      { name: 'executable', status: 'ok', detail: 'on-demand package' },
      versionStep(version, 'package name unknown'),
      ...skipFrom('handshake', 'doctor does not download packages'),
    ])
  }
  if (subject.kind === 'acp-remote') {
    return report(subject.id, [
      { name: 'executable', status: 'fail', detail: 'remote agents are not launched here' },
      ...skipFrom('version', 'remote agents are not launched here'),
    ])
  }
  if (subject.kind !== 'acp') {
    const detail = subject.reason?.trim() || 'not an ACP agent'
    return report(subject.id, [
      { name: 'executable', status: 'fail', detail },
      ...skipFrom('version', 'not an ACP agent'),
    ])
  }
  const path = subject.path?.trim() ?? ''
  if (path === '') {
    return report(subject.id, [
      { name: 'executable', status: 'fail', detail: 'not installed' },
      ...skipFrom('version', 'not installed'),
    ])
  }
  const steps: DoctorStep[] = [{ name: 'executable', status: 'ok', detail: path }]
  const known = subject.version?.trim() ?? ''
  if (known !== '') steps.push(versionStep(known))
  else {
    try {
      steps.push(versionStep((await probe.readVersion(path))?.trim() ?? ''))
    } catch (error) {
      steps.push(versionStep('', clip(error)))
    }
  }
  try {
    const facts = await probe.handshake(
      subject.command?.trim() || path,
      subject.args ?? [],
      options.cwd,
      options.timeoutMs ?? TIMEOUT_MS,
    )
    steps.push({ name: 'handshake', status: 'ok', detail: facts.agent?.trim() || 'initialized' })
    if (facts.methods.includes('session/prompt'))
      steps.push({ name: 'session', status: 'fail', detail: 'doctor must not send a prompt' })
    else if (facts.sessionId === undefined || facts.sessionId.trim() === '')
      steps.push({ name: 'session', status: 'fail', detail: 'no session id' })
    else steps.push({ name: 'session', status: 'ok', detail: facts.sessionId })
  } catch (error) {
    const failed = error instanceof DoctorStepError ? error.step : 'handshake'
    if (failed === 'session') {
      steps.push({ name: 'handshake', status: 'ok', detail: 'initialized' })
      steps.push({ name: 'session', status: 'fail', detail: clip(error) })
    } else {
      steps.push({ name: 'handshake', status: 'fail', detail: clip(error) })
      steps.push({ name: 'session', status: 'skipped', detail: 'not reached' })
    }
  }
  return report(subject.id, steps)
}

/** One tab-separated line per check, in walk order. */
export function formatDoctor(result: DoctorReport): string {
  return result.steps
    .map(step => `${step.name}\t${step.status}${step.detail === undefined ? '' : `\t${step.detail}`}`)
    .join('\n')
}

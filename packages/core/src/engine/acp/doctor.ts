// The process half of doctor: `--version` is discovery's, and the wire stops at
// session/new. A prompt is refused before it is written. Permission requests are
// refused; doctor never grants them.
import { commandVersion } from './discovery.ts'
import { DoctorStepError, type DoctorProbe, type HandshakeFacts } from '../doctor.ts'
import { LineProtocol, type Inbound } from './protocol.ts'
import { StdioTransport } from './transport.ts'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const agentLabel = (result: unknown): string | undefined => {
  if (result === null || typeof result !== 'object') return undefined
  const info = (result as { serverInfo?: unknown }).serverInfo
  if (info === null || typeof info !== 'object') return undefined
  const name = (info as { name?: unknown }).name
  const version = (info as { version?: unknown }).version
  const parts = [typeof name === 'string' ? name.trim() : '', typeof version === 'string' ? version.trim() : ''].filter(
    part => part !== '',
  )
  return parts.length === 0 ? undefined : parts.join(' ')
}

const sessionIdOf = (result: unknown): string | undefined => {
  if (result === null || typeof result !== 'object') return undefined
  const id = (result as { sessionId?: unknown }).sessionId
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/** initialize, the initialized notification, then session/new. Then the process is killed. */
export async function probeAcp(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<HandshakeFacts> {
  const transport = new StdioTransport(command, args, cwd === '' ? undefined : { cwd })
  const methods: string[] = []
  const pending = new Map<
    number,
    { readonly reject: (error: Error) => void; readonly resolve: (value: unknown) => void }
  >()
  let nextId = 1
  let phase: 'handshake' | 'session' = 'handshake'
  let aborted: DoctorStepError | undefined
  const failWaiters = (error: DoctorStepError): void => {
    if (aborted === undefined) aborted = error
    for (const waiter of pending.values()) waiter.reject(aborted)
    pending.clear()
  }
  const protocol = new LineProtocol(
    line => {
      transport.write(line)
    },
    (message: Inbound) => {
      if ('method' in message && 'id' in message && message.id !== undefined) {
        try {
          protocol.send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'doctor does not grant permission' },
          })
        } catch {
          /* the pipe may already be gone; the refusal still stands */
        }
        failWaiters(new DoctorStepError(phase, 'the agent asked for permission'))
        return
      }
      if (!('id' in message) || 'method' in message) return
      const id = typeof message.id === 'number' ? message.id : Number(message.id)
      const waiter = pending.get(id)
      if (waiter === undefined) return
      pending.delete(id)
      if (message.error !== undefined)
        waiter.reject(new DoctorStepError(phase, message.error.message ?? 'the agent refused'))
      else waiter.resolve(message.result)
    },
  )
  const timer = setTimeout(() => {
    failWaiters(new DoctorStepError(phase, 'the agent did not answer'))
    transport.dispose()
  }, timeoutMs)
  const request = (method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> => {
    if (method === 'session/prompt')
      return Promise.reject(new DoctorStepError('session', 'doctor must not send a prompt'))
    if (aborted !== undefined) return Promise.reject(aborted)
    methods.push(method)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        protocol.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        pending.delete(id)
        reject(new DoctorStepError(phase, messageOf(error)))
      }
    })
  }
  try {
    transport.onLine(line => {
      protocol.feed(`${line}\n`)
    })
    transport.onClosed(() => {
      failWaiters(new DoctorStepError(phase, 'the agent connection closed'))
    })
    await transport.open()
    const initialized = await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { read: false, write: false } },
      clientInfo: { name: 'moon-bot-doctor', version: '0' },
    })
    phase = 'session'
    protocol.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    methods.push('initialized')
    const opened = await request('session/new', cwd === '' ? {} : { cwd })
    const sessionId = sessionIdOf(opened)
    const agent = agentLabel(initialized)
    return { methods, ...(agent === undefined ? {} : { agent }), ...(sessionId === undefined ? {} : { sessionId }) }
  } catch (error) {
    if (error instanceof DoctorStepError) throw error
    throw new DoctorStepError(phase, messageOf(error))
  } finally {
    clearTimeout(timer)
    transport.dispose()
    // The doctor answers only once the agent is really gone: it ran in a folder the caller
    // may remove next, and on Windows a killed child holds that folder for a moment.
    await transport.exited()
  }
}

export const acpDoctorProbe: DoctorProbe = {
  readVersion: async path => commandVersion(path),
  handshake: (command, args, cwd, timeoutMs) => probeAcp(command, args, cwd, timeoutMs),
}

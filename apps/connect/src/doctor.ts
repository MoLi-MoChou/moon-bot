// `moon-bot-connect doctor`: why an agent cannot join, answered without joining.
// It checks the three things that fail in practice — Node too old for type stripping,
// the relay unreachable or the invite rejected, and no (or several) local agents to
// hand over — and prints one line per check with a next step. Read-only: it closes the
// connection it opened, so a real CLI keeps its agent.
import { findAgents, pickAgent, pickFailureMessage, type FoundAgent } from './discovery.ts'
import { buildRelayUrl } from './bridge.ts'

export interface DoctorOptions {
  readonly url?: string | undefined
  readonly token?: string | undefined
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
}

const MIN_NODE = [22, 18] as const

/** The part of `globalThis.WebSocket` this check uses; injected so the test can fake it. */
export interface SocketLike {
  onopen?: (() => void) | null
  onerror?: (() => void) | null
  onclose?: ((event: { code?: number; reason?: string }) => void) | null
  close(): void
}

export interface DoctorDeps {
  readonly nodeVersion: string
  readonly agents?: readonly FoundAgent[]
  readonly connect?: ((url: string, socket: { current: SocketLike | undefined }) => SocketLike) | undefined
  readonly timeoutMs?: number
}

const relayCheck = async (url: string, deps: DoctorDeps): Promise<{ ok: boolean; text: string }> => {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function' && deps.connect === undefined) {
    return { ok: false, text: 'this Node has no WebSocket; Node 22.18 or newer has one built in' }
  }
  const socketBox: { current: SocketLike | undefined } = { current: undefined }
  const timeoutMs = deps.timeoutMs ?? 10_000
  return await new Promise(resolve => {
    let settled = false
    const finish = (result: { ok: boolean; text: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socketBox.current?.close()
      resolve(result)
    }
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          text: `no answer within ${Math.round(timeoutMs / 1000)}s; check the address and the firewall`,
        }),
      timeoutMs,
    )
    try {
      const socket =
        deps.connect?.(url, socketBox) ??
        new (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket(url)
      socketBox.current = socket
      socket.onopen = () => finish({ ok: true, text: 'relay accepted the invite' })
      socket.onerror = () =>
        finish({ ok: false, text: 'could not reach the relay; check the URL, https/wss, and the proxy' })
      socket.onclose = event => {
        const code = event?.code ?? 0
        finish({
          ok: false,
          text:
            code === 4401
              ? 'the relay rejected this invite (unknown or revoked); ask a Main Bot for a new one'
              : code === 4403
                ? 'this invite was revoked; ask a Main Bot for a new one'
                : `the relay closed the connection (code ${code})`,
        })
      }
    } catch (error) {
      finish({
        ok: false,
        text: `the relay URL is not usable: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  })
}

/** Runs the checks in the order that explains the most with the least. */
export async function doctor(options: DoctorOptions, deps: DoctorDeps): Promise<number> {
  const say = (ok: boolean, label: string, detail: string): void => {
    options.stdout(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`)
  }
  let failures = 0

  const [major, minor] = deps.nodeVersion.split('.').map(Number) as [number, number]
  const nodeOk = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])
  say(
    nodeOk,
    'node',
    `v${deps.nodeVersion}${nodeOk ? '' : ' — need 22.18 or newer (the CLI runs TypeScript directly)'}`,
  )
  if (!nodeOk) failures += 1

  const agents = deps.agents ?? findAgents()
  const pick = pickAgent(agents)
  if (pick.ok)
    say(
      true,
      'agent',
      `${pick.agent.label} at ${pick.agent.path}${pick.agent.version === undefined ? '' : ` (${pick.agent.version})`}`,
    )
  else {
    say(false, 'agent', pickFailureMessage(pick.found))
    failures += 1
  }

  if (options.url === undefined || options.token === undefined) {
    options.stdout('skip relay: pass --url and --token to check the invite too')
    return failures === 0 ? 0 : 1
  }
  let relayUrl: string
  try {
    relayUrl = buildRelayUrl(options.url, options.token)
  } catch (error) {
    say(false, 'relay', error instanceof Error ? error.message : String(error))
    return 1
  }
  const relay = await relayCheck(relayUrl, deps)
  say(relay.ok, 'relay', relay.text)
  if (!relay.ok) failures += 1
  return failures === 0 ? 0 : 1
}

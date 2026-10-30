#!/usr/bin/env node
// moon-bot-connect (plan §接入 CLI): one command that attaches a local ACP agent
// to a Moon Bot relay. The process is the unit of supervision — when either end
// of the bridge goes down it exits non-zero, and whatever launched it restarts it.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { USAGE, parseArgs, parseDoctorArgs } from './args.ts'
import { doctor } from './doctor.ts'
import { LineSplitter, buildRelayUrl } from './bridge.ts'
import { findAgents, pickAgent, pickFailureMessage } from './discovery.ts'

const log = (...parts: readonly string[]): void => {
  process.stderr.write(`${parts.join(' ')}\n`)
}

const EXIT_BRIDGE_DOWN = 1
const EXIT_USAGE = 2
const EXIT_SIGINT = 130
const EXIT_SIGTERM = 143

interface Launch {
  readonly command: string
  readonly args: readonly string[]
  readonly label: string
}

const resolveLaunch = (command: readonly string[]): Launch | { readonly error: string } => {
  if (command.length > 0) {
    const first = command[0]
    if (first === undefined || first === '') return { error: 'the command after "--" is empty' }
    return { command: first, args: command.slice(1), label: first }
  }
  const pick = pickAgent(findAgents())
  if (pick.ok) {
    // Spawn the resolved path, not the bare name: discovery proved that one works.
    return { command: pick.agent.path, args: [], label: `${pick.agent.label} (${pick.agent.path})` }
  }
  return { error: pickFailureMessage(pick.found) }
}

const runDoctor = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseDoctorArgs(argv)
  if (!parsed.ok) {
    log(`moon-bot-connect: ${parsed.error}`)
    process.stderr.write(USAGE)
    return EXIT_USAGE
  }
  return await doctor(
    { url: parsed.url, token: parsed.token, stdout: line => process.stdout.write(`${line}\n`), stderr: log },
    { nodeVersion: process.versions.node },
  )
}

const run = (): void => {
  const outcome = parseArgs(process.argv.slice(2))
  if (!outcome.ok) {
    log(`moon-bot-connect: ${outcome.error}`)
    process.stderr.write(USAGE)
    process.exit(EXIT_USAGE)
  }
  if (outcome.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }

  let relayUrl: string
  try {
    relayUrl = buildRelayUrl(outcome.url, outcome.token)
  } catch (error) {
    log(`moon-bot-connect: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(EXIT_USAGE)
  }

  const launch = resolveLaunch(outcome.command)
  if ('error' in launch) {
    log(`moon-bot-connect: ${launch.error}`)
    process.exit(EXIT_USAGE)
  }

  // The invite token is a secret: log the endpoint without its query string.
  const endpoint = new URL(relayUrl)
  const shownUrl = `${endpoint.origin}${endpoint.pathname}`

  log(`Connecting to ${shownUrl} …`)
  let socket: WebSocket
  try {
    socket = new WebSocket(relayUrl)
  } catch (error) {
    log(`moon-bot-connect: cannot open the relay: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(EXIT_BRIDGE_DOWN)
  }

  let child: ChildProcessWithoutNullStreams | undefined
  let finished = false
  const finish = (reason: string, code: number): void => {
    if (finished) return
    finished = true
    log(reason)
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    if (socket.readyState === socket.CONNECTING || socket.readyState === socket.OPEN) socket.close()
    process.exit(code)
  }

  socket.addEventListener('message', event => {
    // Frames carry JSON-RPC messages as text; anything else is not the agent's language.
    if (typeof event.data !== 'string') return
    child?.stdin.write(`${event.data}\n`)
  })
  socket.addEventListener('close', event => {
    finish(`Relay closed${event.reason !== '' ? `: ${event.reason}` : ''} [code ${event.code}].`, EXIT_BRIDGE_DOWN)
  })
  socket.addEventListener('error', event => {
    // undici's error event often carries neither message nor error (a refused
    // connection reports nothing), so fall back to a plain diagnosis.
    const detail =
      event.message !== ''
        ? event.message
        : event.error instanceof Error && event.error.message !== ''
          ? event.error.message
          : 'connection failed'
    finish(`Relay error: ${detail}.`, EXIT_BRIDGE_DOWN)
  })
  socket.addEventListener('open', () => {
    log(`Connected to ${shownUrl}; bridging ${launch.label}.`)
    // All three stdio pipes are open, so the child's streams are never null.
    child = spawn(launch.command, [...launch.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
    const splitter = new LineSplitter()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of splitter.feed(chunk)) {
        if (socket.readyState === socket.OPEN) socket.send(line)
      }
    })
    // The agent's own chatter stays on stderr; it is not ours to interpret.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      process.stderr.write(chunk)
    })
    // EPIPE here only means the agent died first; its exit event reports that.
    child.stdin.on('error', () => {})
    child.on('error', error => {
      finish(`Failed to start "${launch.command}": ${error.message}.`, EXIT_BRIDGE_DOWN)
    })
    child.on('exit', (code, signal) => {
      const how = signal !== null ? ` by signal ${signal}` : code !== null ? ` with code ${code}` : ''
      finish(`Agent ${launch.label} exited${how}.`, EXIT_BRIDGE_DOWN)
    })
  })

  const stop = (signal: 'SIGINT' | 'SIGTERM', code: number): void => {
    // Forward the termination to the agent so it can clean up before we go.
    child?.kill('SIGTERM')
    finish(`Received ${signal}; stopping.`, code)
  }
  process.on('SIGINT', () => {
    stop('SIGINT', EXIT_SIGINT)
  })
  process.on('SIGTERM', () => {
    stop('SIGTERM', EXIT_SIGTERM)
  })
}

// `doctor` answers "why can this machine not join" without joining; everything else bridges.
if (process.argv[2] === 'doctor') {
  void runDoctor(process.argv.slice(3)).then(code => process.exit(code))
} else {
  run()
}

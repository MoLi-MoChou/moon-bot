// The wire an AcpRuntime speaks, lifted off the child's stdio (plan 2026-10-27
// remote-agents): a transport carries newline-delimited JSON-RPC both ways, whether the
// agent is a spawned child or a relay connection to another machine. The runtime owns
// the protocol; the transport owns the pipe.
import { spawn } from 'node:child_process'

export interface AcpTransport {
  /** Ready to carry lines; resolves once, rejects when the wire cannot come up. */
  open(): Promise<void>
  /** A complete JSON-RPC line, without its newline. */
  write(line: string): void
  /** Lines arriving from the agent; replaces any earlier listener. */
  onLine(receive: (line: string) => void): void
  /** The wire is gone; fires at most once, after open() succeeded. */
  onClosed(receive: () => void): void
  /** Tear the wire down; safe to call more than once. */
  dispose(): void
}

/** The local agent: a spawned child, its stdio the pipe. */
export class StdioTransport implements AcpTransport {
  private child: ReturnType<typeof spawn> | undefined
  private line: ((line: string) => void) | undefined
  private closed: (() => void) | undefined
  private buffer = ''
  private readonly command: string
  private readonly args: readonly string[]

  constructor(command: string, args: readonly string[] = []) {
    this.command = command
    this.args = args
  }

  async open(): Promise<void> {
    if (this.child !== undefined) return
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.feed(chunk))
    // A closed agent is a failed request, not a crash: the runtime ends the turn.
    child.stdin.on('error', () => this.finish())
    child.on('exit', () => this.finish())
    child.on('error', () => this.finish())
  }

  write(line: string): void {
    // A line nobody reads would leave its request waiting forever; fail it instead.
    const stdin = this.child?.stdin
    if (stdin === null || stdin === undefined) throw new Error('the agent process is not running')
    stdin.write(`${line}\n`)
  }

  onLine(receive: (line: string) => void): void {
    this.line = receive
  }

  onClosed(receive: () => void): void {
    this.closed = receive
  }

  dispose(): void {
    this.child?.kill()
    this.finish()
  }

  private feed(chunk: string): void {
    this.buffer += chunk
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (line !== '') this.line?.(line)
    }
  }

  private finish(): void {
    if (this.child === undefined) return
    this.child = undefined
    this.closed?.()
  }
}

/**
 * The remote agent: lines over a relay connection. The port is the relay's live view —
 * `connect` returns the pipe that is current right now, so a replaced connection (a new
 * CLI run taking over the agentId) carries the next line without a new runtime.
 */
export interface RelayPort {
  /** The pipe for an agent, or undefined when that agent is offline. */
  connect(agentId: string): RelayPipe | undefined
  /** A pipe came up or was replaced; fires for every attach, current or later. */
  onUp(agentId: string, receive: () => void): void
}

export interface RelayPipe {
  write(line: string): void
  onLine(receive: (line: string) => void): void
  onClosed(receive: () => void): void
}

export class RelayTransport implements AcpTransport {
  private pipe: RelayPipe | undefined
  private line: ((line: string) => void) | undefined
  private closed: (() => void) | undefined
  private opened = false
  private readonly port: RelayPort
  private readonly agentId: string

  constructor(port: RelayPort, agentId: string) {
    this.port = port
    this.agentId = agentId
  }

  async open(): Promise<void> {
    if (this.opened) return
    const pipe = this.port.connect(this.agentId)
    if (pipe === undefined) throw new Error(`the remote agent "${this.agentId}" is offline`)
    this.opened = true
    this.attach(pipe)
    // A later connection replacing this one picks the runtime up where it stands.
    this.port.onUp(this.agentId, () => {
      const next = this.port.connect(this.agentId)
      if (next !== undefined && next !== this.pipe) this.attach(next)
    })
  }

  private attach(pipe: RelayPipe): void {
    this.pipe = pipe
    pipe.onLine(line => this.line?.(line))
    pipe.onClosed(() => {
      if (this.pipe !== pipe) return // already replaced
      this.pipe = undefined
      if (this.opened) this.closed?.()
    })
  }

  write(line: string): void {
    if (this.pipe === undefined) throw new Error(`the remote agent "${this.agentId}" is offline`)
    this.pipe.write(line)
  }

  onLine(receive: (line: string) => void): void {
    this.line = receive
  }

  onClosed(receive: () => void): void {
    this.closed = receive
  }

  dispose(): void {
    this.opened = false
    this.pipe = undefined
  }
}

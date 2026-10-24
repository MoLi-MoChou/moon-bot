// Runs the Host in Electron's Node mode and owns its lifetime.
// Follows DeepSeek Harness apps/desktop/src/host-process.ts (MIT); see NOTICE.
import { spawn } from 'node:child_process'

const STDERR_TAIL_CHARS = 8 * 1024

// The web server prints its launch URL, and the launch token in it opens the Host.
const redact = (text: string): string => text.replace(/([?&]token=)[^&\s]+/gu, '$1<hidden>')

const settlesWithin = (promise: Promise<unknown>, ms: number): Promise<boolean> => new Promise((resolve) => {
  const timer = setTimeout(() => { resolve(false) }, ms)
  void promise.then(() => { clearTimeout(timer); resolve(true) })
})

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

export interface HostProcessOptions {
  readonly entry: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly pnpm: string
  /** Receives the first unexpected failure, also after the Host was ready. */
  readonly onFailure: (error: Error) => void
}

/** What the Host's `start` resolves to: its launch URL and index injections; for the first-run
 *  check, the Sessions it cannot read. */
export type HostReady = { readonly url: string; readonly injections: readonly unknown[] } | { readonly unreadable: readonly string[] }

export class HostProcess {
  readonly #options: HostProcessOptions
  #child: ReturnType<typeof spawn> | undefined
  #ready: Promise<HostReady> | undefined
  #exit: Promise<void> | undefined
  #stderr = ''
  #stopping = false
  #failed = false

  constructor(options: HostProcessOptions) { this.#options = options }

  start(): Promise<HostReady> {
    this.#ready ??= new Promise((resolve, reject) => {
      const { entry, cwd, env, pnpm } = this.#options
      const child = spawn(process.execPath, ['--expose-internals', entry, pnpm], {
        cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      this.#child = child
      const { stdout, stderr } = child
      // stdio asks for two pipes; a child without them cannot report anything.
      if (stdout === null || stderr === null) throw new Error('the Host child opened without pipes')
      stdout.setEncoding('utf8')
      stderr.setEncoding('utf8')
      stdout.on('data', (chunk: string) => { process.stdout.write(redact(chunk)) })
      stderr.on('data', (chunk: string) => {
        process.stderr.write(redact(chunk))
        this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL_CHARS)
      })
      child.on('message', (raw: unknown) => {
        const message = record(raw)
        if (message === undefined) return
        const strings = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
        if (message.type === 'ready') resolve({ url: String(message.url), injections: Array.isArray(message.injections) ? message.injections : [] })
        else if (message.type === 'checked') resolve({ unreadable: strings(message.unreadable) })
        else if (message.type === 'fatal') this.#fail(new Error(String(message.message)), reject)
      })
      child.once('error', (error: Error) => { this.#fail(error, reject) })
      this.#exit = new Promise((done) => {
        child.once('close', (code: number | null) => {
          const tail = redact(this.#stderr.trim())
          this.#fail(new Error(`The DSH Host stopped (exit ${String(code)})${tail === '' ? '' : `:\n${tail}`}`), reject)
          done()
        })
      })
    })
    return this.#ready
  }

  /** Ask the Host to shut down, then end it if it does not exit in time. */
  async stop(): Promise<void> {
    const child = this.#child
    if (child === undefined) return
    this.#stopping = true
    if (child.connected) child.send({ type: 'shutdown' }, (error) => { if (error) console.error(error) })
    if (!await settlesWithin(this.#exit ?? Promise.resolve(), 10_000)) child.kill()
    if (!await settlesWithin(this.#exit ?? Promise.resolve(), 5_000)) child.kill('SIGKILL')
    this.#child = undefined
  }

  #fail(error: Error, reject: (error: Error) => void): void {
    reject(error)
    if (this.#failed || this.#stopping) return
    this.#failed = true
    this.#options.onFailure(error)
  }
}

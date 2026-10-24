// The Host: the shell runs this file in Electron's Node mode. It boots the app's own `ds-bot` profile
// on a loopback port and reports the launch URL over IPC. With DS_BOT_CHECK, the path of a JSON list
// of Session ids, it boots the first-run check's profile instead and reports which of them it cannot read.
// Follows DeepSeek Harness apps/desktop-host/src/index.ts (MIT); see NOTICE.
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { loadLayeredEnv, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { CHECK_PROFILE, INSTALL_ANCHOR, PROFILE, loadAppProfile, loadCheckProfile } from './profile.ts'
import { unreadableSessions, type CheckPersistence } from './session-check.ts'

const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

type ShellMessage = { readonly type: 'ready'; readonly url: string; readonly injections: readonly unknown[] }
  | { readonly type: 'checked'; readonly unreadable: readonly string[] }
  | { readonly type: 'shutdown-complete' }
  | { readonly type: 'fatal'; readonly message: string; readonly diagnostic: string }

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

const send = (message: ShellMessage): Promise<void> => new Promise((resolve, reject) => {
  if (!process.connected || process.send === undefined) { resolve(); return }
  process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
})

async function main(): Promise<void> {
  const pnpm = process.argv[2]
  const check = process.env.DS_BOT_CHECK || undefined
  const profile = check === undefined ? loadAppProfile() : loadCheckProfile()
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: check === undefined ? PROFILE : CHECK_PROFILE,
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: [],
    args: ['--no-open', '--port', process.env.DS_BOT_PORT || '0'],
    ...(pnpm === undefined ? {} : {
      packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1' } },
    }),
  })
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    // A Host that failed to boot has nothing to shut down; the shell already has the failure.
    const running = await application.catch((): undefined => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (raw: unknown) => { if (record(raw)?.type === 'shutdown') void stop() })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  if (check !== undefined) {
    const persistence = ctx.get('sessionPersistence') as CheckPersistence | undefined
    if (persistence === undefined) throw new Error(`The profile in ${profile.dir} does not store Sessions.`)
    const ids = JSON.parse(readFileSync(check, 'utf8')) as string[]
    await send({ type: 'checked', unreadable: await unreadableSessions(persistence, ids) })
    return
  }
  const webServer = ctx.get('webServer') as { readonly port: number; collectIndexInjections(): unknown[] } | undefined
  const connection = ctx.get('connection') as { authenticatedUrl(origin: string): string } | undefined
  // A profile patch can turn these rows off; then the window has nothing to talk to.
  if (webServer === undefined || connection === undefined) throw new Error(`The profile in ${profile.dir} does not start the engine's web server and connection.`)
  const url = connection.authenticatedUrl(`http://127.0.0.1:${String(webServer.port)}`)
  await send({ type: 'ready', url, injections: webServer.collectIndexInjections() })
}

void main().catch(async (error: unknown) => {
  console.error(error)
  process.exitCode = 1
  const message = error instanceof Error ? error.message : String(error)
  const diagnostic = inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS)
  await send({ type: 'fatal', message, diagnostic }).catch(() => undefined)
  if (process.connected) process.disconnect()
})

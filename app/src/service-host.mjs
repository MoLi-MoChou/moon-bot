// The standalone Host: the shell runs this file in Electron's Node mode. It boots Moon
// Bot's own service (core/src/service) on a loopback port and reports the URL over IPC,
// speaking the same ready/fatal/shutdown protocol the DSH host did, so the shell's
// lifetime handling carries over unchanged.
import { inspect } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

const send = (message) => new Promise((resolve, reject) => {
  if (!process.connected || process.send === undefined) { resolve(); return }
  process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
})

async function main() {
  const { startService } = await import('moon-bot-core/service')
  const here = fileURLToPath(new URL('.', import.meta.url))
  // The packaged window build sits beside this file's package; in a dev checkout it is
  // built into ui/dist.
  const ui = process.env.MOON_BOT_UI || join(here, '..', 'ui', 'dist')
  const service = await startService({
    home: process.env.MOON_BOT_DATA,
    port: Number(process.env.MOON_BOT_WEB_PORT || '0'),
    host: '127.0.0.1',
    uiDir: ui,
  })
  let stopping
  const stop = () => stopping ??= (async () => {
    await service.close().catch(() => {})
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (message) => { if (message?.type === 'shutdown') void stop() })
  process.once('disconnect', () => { void stop() })
  await send({ type: 'ready', url: service.url, injections: [] })
}

main().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
  const message = error instanceof Error ? error.message : String(error)
  const diagnostic = inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS)
  await send({ type: 'fatal', message, diagnostic }).catch(() => undefined)
  if (process.connected) process.disconnect()
})

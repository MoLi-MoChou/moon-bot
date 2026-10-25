// The standalone entry (plan §阶段 3): boots the service from the environment the old
// web mode read — MOON_BOT_DATA (the team home), MOON_BOT_PASSWORD, MOON_BOT_WEB_HOST /
// MOON_BOT_WEB_PORT — and serves the built UI when MOON_BOT_UI names its directory.
// This file ships compiled (dist/service/main.js); the environment is its whole config.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { startService } from './server.ts'

const env = process.env
// MOON_BOT_* settings; the MOCHOU_* and DSH_BOT_* names from before the renames still work.
const setting = (name: string): string | undefined =>
  env[`MOON_BOT_${name}`] ?? env[`MOCHOU_${name}`] ?? env[`DSH_BOT_${name}`]

const defaultData = (): string => {
  const fresh = join(homedir(), '.moon-bot')
  if (existsSync(fresh)) return fresh
  return [join(homedir(), '.mochou'), join(homedir(), '.dsh-bot')].find(dir => existsSync(dir)) ?? fresh
}

const home = setting('DATA') ?? defaultData()
const password = setting('PASSWORD') ?? ''
const host = setting('WEB_HOST') ?? '127.0.0.1'
const port = Number(setting('WEB_PORT') ?? 8290)
const uiDir = setting('UI')

const service = await startService({
  home,
  ...(password !== '' ? { password } : {}),
  ...(uiDir !== undefined && uiDir !== '' ? { uiDir } : {}),
  host,
  port,
})
console.log(`moon-bot: ${service.url}${password !== '' ? ' (password set)' : host === '127.0.0.1' ? ' (loopback, no password)' : ''}`)

const stop = (): void => {
  void service.close().finally(() => process.exit(0))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

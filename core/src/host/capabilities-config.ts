// The config a capability mounts with: an MCP server's command, arguments, environment,
// URL and headers, or a skill's text. Secret references are resolved for this Bot only.
import { encodeUrlComponent } from './secrets.ts'
import type { CapabilityItem, HostRuntime } from './runtime.js'

const SECRET_REFERENCE = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g

export function secretFor(rt: HostRuntime, name: string, botId: string): string {
  const value = rt.canUseSecret?.(name, botId) ? rt.secretValue(name) : undefined
  if (value === undefined) throw new Error(`Secret ${name} is missing or unavailable for this Bot.`)
  return value
}

export function resolveValues(rt: HostRuntime, values: Readonly<Record<string, unknown>> | undefined, botId: string): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values ?? {})) {
    resolved[key] = String(raw).replace(SECRET_REFERENCE, (_match, name: string) => secretFor(rt, name, botId))
  }
  return resolved
}

export function resolveUrl(rt: HostRuntime, url: string | undefined, botId: string): string {
  return String(url).replace(SECRET_REFERENCE, (_match, name: string) => encodeUrlComponent(secretFor(rt, name, botId)))
}

export function resolveList(rt: HostRuntime, list: readonly string[] | undefined, botId: string): string[] {
  return (list ?? []).map(raw => String(raw).replace(SECRET_REFERENCE, (_match, name: string) => secretFor(rt, name, botId)))
}

/** The plugin config one capability mounts with. */
export function configFor(rt: HostRuntime, item: CapabilityItem, botId: string): Record<string, unknown> {
  if (item.kind === 'skill') return { name: item.name, description: item.description, content: item.content }
  if (item.transport === 'stdio') return { transport: 'stdio', serverName: item.name, command: item.command, args: resolveList(rt, item.args, botId), env: resolveValues(rt, item.env, botId), failOnStartupError: true }
  return { transport: 'streamable-http', serverName: item.name, url: resolveUrl(rt, item.url, botId), headers: resolveValues(rt, item.headers, botId), failOnStartupError: true }
}

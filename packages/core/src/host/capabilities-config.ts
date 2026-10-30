// The config a capability mounts with: an MCP server's command, arguments, environment,
// URL and headers, or a skill's text. Secret references are resolved for this Bot only.
import { encodeUrlComponent } from './secrets.ts'
import type { CapabilityItem, HostRuntime } from './runtime.js'

const SECRET_REFERENCE = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g

type ResolveSecret = (name: string) => string

/** For one Bot: only the keys that Bot may use resolve. */
const forBot =
  (rt: HostRuntime, botId: string): ResolveSecret =>
  name => {
    const value = rt.canUseSecret?.(name, botId) ? rt.secretValue(name) : undefined
    if (value === undefined) throw new Error(`Secret ${name} is missing or unavailable for this Bot.`)
    return value
  }

/** For a connection test the user asked for: any saved key may be used, and values never leave. */
const forTest =
  (rt: HostRuntime): ResolveSecret =>
  name => {
    const value = rt.secretValue(name)
    if (value === undefined) throw new Error(`Secret ${name} is not saved.`)
    return value
  }

export function secretFor(rt: HostRuntime, name: string, botId: string): string {
  return forBot(rt, botId)(name)
}

export function resolveValues(
  resolve: ResolveSecret,
  values: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values ?? {})) {
    resolved[key] = String(raw).replace(SECRET_REFERENCE, (_match, name: string) => resolve(name))
  }
  return resolved
}

export function resolveUrl(resolve: ResolveSecret, url: string | undefined): string {
  return String(url).replace(SECRET_REFERENCE, (_match, name: string) => encodeUrlComponent(resolve(name)))
}

export function resolveList(resolve: ResolveSecret, list: readonly string[] | undefined): string[] {
  return (list ?? []).map(raw => String(raw).replace(SECRET_REFERENCE, (_match, name: string) => resolve(name)))
}

function configWith(resolve: ResolveSecret, item: CapabilityItem): Record<string, unknown> {
  if (item.kind === 'skill') return { name: item.name, description: item.description, content: item.content }
  if (item.transport === 'stdio')
    return {
      transport: 'stdio',
      serverName: item.name,
      command: item.command,
      args: resolveList(resolve, item.args),
      env: resolveValues(resolve, item.env),
      failOnStartupError: true,
    }
  return {
    transport: item.transport === 'sse' ? 'sse' : 'streamable-http',
    serverName: item.name,
    url: resolveUrl(resolve, item.url),
    headers: resolveValues(resolve, item.headers),
    failOnStartupError: true,
  }
}

/** The plugin config one capability mounts with. */
export function configFor(rt: HostRuntime, item: CapabilityItem, botId: string): Record<string, unknown> {
  return configWith(forBot(rt, botId), item)
}

/** The same config for `capability-test`, before anything is saved. */
export function configForTest(rt: HostRuntime, item: CapabilityItem): Record<string, unknown> {
  return configWith(forTest(rt), item)
}

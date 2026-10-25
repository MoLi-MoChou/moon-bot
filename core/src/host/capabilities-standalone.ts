// Mounting a capability where no DSH plugin host runs (plan §阶段 6): the MCP server
// becomes one of our connectors, its tools namespaced into the registry the engine
// serves — so the policy classifies every one of them L3 — and the whole thing
// unmounts with the Bot's capability.
import { McpConnector } from '../engine/connectors/mcp.ts'
import type { ToolRegistry } from '../engine/registry.ts'

export interface StandaloneMounts {
  mount(name: string, config: Readonly<Record<string, unknown>>): Promise<() => void>
  dispose(): void
}

/** The spec a capability's config names: stdio by command, else by url. */
const specOf = (name: string, config: Readonly<Record<string, unknown>>): { id: string } & Record<string, unknown> => {
  const id = config.serverName !== undefined ? String(config.serverName) : name
  if (config.transport === 'stdio' || config.transport === undefined) {
    return {
      id,
      command: String(config.command ?? ''),
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: (config.env ?? {}) as Record<string, string>,
    }
  }
  return { id, url: String(config.url ?? ''), headers: (config.headers ?? {}) as Record<string, string> }
}

export function createStandaloneMounts(registry: ToolRegistry | undefined): StandaloneMounts {
  const mounted = new Map<string, () => void>()
  return {
    async mount(name, config) {
      if (registry === undefined) throw new Error('This runtime has no tool registry to mount into.')
      const unmount = await new McpConnector(specOf(name, config)).mount(registry)
      mounted.set(name, unmount)
      return () => {
        const entry = mounted.get(name)
        if (entry === undefined) return
        mounted.delete(name)
        entry()
      }
    },
    dispose() {
      for (const unmount of mounted.values()) unmount()
      mounted.clear()
    },
  }
}

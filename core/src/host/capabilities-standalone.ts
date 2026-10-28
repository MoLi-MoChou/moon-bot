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

/** The spec a capability's config names: stdio by command, else by url and its transport. */
const specOf = (name: string, config: Readonly<Record<string, unknown>>): { id: string } & Record<string, unknown> => {
  const id = config.serverName !== undefined ? String(config.serverName) : name
  if (config.transport === 'stdio' || config.transport === undefined) {
    return {
      id,
      transport: 'stdio',
      command: String(config.command ?? ''),
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: (config.env ?? {}) as Record<string, string>,
    }
  }
  return {
    id,
    transport: config.transport === 'sse' ? 'sse' : 'streamable-http',
    url: String(config.url ?? ''),
    headers: (config.headers ?? {}) as Record<string, string>,
  }
}

export function createStandaloneMounts(registry: ToolRegistry | undefined): StandaloneMounts {
  // One entry per live mount, not per capability name: a Bot's chat and each group
  // Session mount the same capability, and keying by name would overwrite the earlier
  // unmount — closing the wrong connector and leaking a process.
  const mounted = new Set<() => void>()
  // A server may still be starting when the runtime shuts down; close those too.
  const pending = new Set<McpConnector>()
  let closed = false
  return {
    async mount(name, config) {
      if (registry === undefined) throw new Error('This runtime has no tool registry to mount into.')
      if (closed) throw new Error('This runtime is shutting down.')
      const connector = new McpConnector(specOf(name, config))
      pending.add(connector)
      try {
        const unmount = await connector.mount(registry)
        pending.delete(connector)
        if (closed) {
          unmount()
          throw new Error('This runtime is shutting down.')
        }
        mounted.add(unmount)
        let dropped = false
        return () => {
          if (dropped) return
          dropped = true
          mounted.delete(unmount)
          unmount()
        }
      } catch (error) {
        pending.delete(connector)
        void connector.close()
        throw error
      }
    },
    dispose() {
      closed = true
      for (const connector of pending) void connector.close()
      pending.clear()
      for (const unmount of mounted) unmount()
      mounted.clear()
    },
  }
}

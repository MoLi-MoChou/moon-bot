// Capability tools: the shared MCP servers, skills and packs, and what is attached to
// which Bot. The library and the mounts are in capabilities.ts.
import { z } from 'zod'
import type { ToolContext } from '../../engine/registry.ts'
import type { CapabilityItem, HostRuntime } from '../runtime.ts'
import { errorMessage, type ToolShared } from './shared.ts'

interface SaveCapabilityArgs {
  readonly [key: string]: unknown
}

interface DeleteCapabilityArgs {
  readonly name?: string
}

interface ChangeAttachmentArgs {
  readonly name?: string
  readonly bot?: string
}

export function installCapabilityTools(_rt: HostRuntime, shared: ToolShared): void {
  const t = shared.rt
  const { state } = shared

  shared.register({
    name: 'list_capabilities',
    description: 'List shared MCP servers, skills, and packs, plus the capabilities attached to you.',
    parameters: {},
    schema: z.object({}).passthrough(),
    async execute(_args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<string> {
      await t.load()
      const self = t.selfOf(context.sessionId)
      const bot = t.botOf(self)
      if (!bot) return 'Only Bots on the team can use list_capabilities.'
      const items = Object.values(state.capabilities?.items ?? {})
      if (items.length === 0) return 'No shared capabilities are saved yet.'
      const statuses = t.capabilityStatusesView()[bot.id] ?? {}
      const lines = items.map(item => {
        const extra = item.kind === 'pack' ? `; includes ${(item.items ?? []).join(', ') || 'nothing'}`
          : item.kind === 'mcp' && item.transport === 'stdio' ? `; ${item.approved ? 'allowed' : 'needs user approval'}` : ''
        const itemStatus = statuses[item.name]
        const state = itemStatus ? ` (${itemStatus.state}${itemStatus.error ? `: ${itemStatus.error}` : ''})` : ''
        const status = bot.capabilities?.includes(item.name) ? `; attached to you${state}` : ''
        return `- ${item.name} (${item.kind})${item.description ? ` — ${item.description}` : ''}${extra}${status}`
      })
      return ['Shared capabilities:', ...lines].join('\n')
    },
  })

  shared.register({
    name: 'save_capability',
    description: 'Create or update a shared MCP server, skill, or pack. Changes apply from your next message.',
    parameters: {
      name: { type: 'string', required: true, description: 'Lowercase letters, digits, and single hyphens, up to 32 characters; "github" is reserved' },
      kind: { type: 'string', required: true, enum: ['mcp', 'skill', 'pack'] },
      description: { type: 'string', description: 'What this capability provides' },
      transport: { type: 'string', enum: ['stdio', 'streamable-http'], description: 'How to reach an MCP server: a local command or an HTTP URL' },
      command: { type: 'string', description: 'Program that starts a local MCP server' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments for command' },
      env: { type: 'object', additionalProperties: true, description: 'Environment variables for command; write $MOON_BOT_SECRET_<NAME> to insert a saved secret instead of the value' },
      url: { type: 'string', description: 'MCP server URL; write $MOON_BOT_SECRET_<NAME> in the path or query to insert a saved secret, URL-encoded. Prefer headers for keys' },
      headers: { type: 'object', additionalProperties: true, description: 'HTTP headers; write $MOON_BOT_SECRET_<NAME> to insert a saved secret instead of the value' },
      content: { type: 'string', description: 'Skill instructions' },
      items: { type: 'array', items: { type: 'string' }, description: 'MCP server and skill names in the pack' },
    },
    schema: z.object({
      name: z.string(),
      kind: z.string(),
      description: z.string().optional(),
      transport: z.string().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.object({}).passthrough().optional(),
      url: z.string().optional(),
      headers: z.object({}).passthrough().optional(),
      content: z.string().optional(),
      items: z.array(z.string()).optional(),
    }).passthrough(),
    async execute(args: SaveCapabilityArgs, context: ToolContext): Promise<string> {
      await t.load()
      const self = t.selfOf(context.sessionId)
      if (!t.botOf(self)) return 'Only Bots on the team can use save_capability.'
      try {
        const item = await t.capabilitySave(args, { botId: self })
        const approval = item.kind === 'mcp' && item.transport === 'stdio' && !item.approved
          ? ' The user must allow this MCP server in Moon Bot settings before it can work.'
          : ''
        return `Saved ${item.name}. Bots with it attached use the change from their next message.${approval}`
      } catch (error) { return errorMessage(error) }
    },
  })

  shared.register({
    name: 'delete_capability',
    description: 'Remove a shared capability and detach it from every Bot and pack.',
    parameters: { name: { type: 'string', required: true } },
    schema: z.object({ name: z.string() }).passthrough(),
    async execute(args: DeleteCapabilityArgs, context: ToolContext): Promise<string> {
      await t.load()
      const self = t.selfOf(context.sessionId)
      if (!t.botOf(self)) return 'Only Bots on the team can use delete_capability.'
      try {
        await t.capabilityDelete(args.name, { botId: self })
        return `Deleted ${args.name}; it was removed from every Bot and pack. The change applies from their next message.`
      } catch (error) { return errorMessage(error) }
    },
  })

  for (const [name, endpoint, verb] of [
    ['attach_capability', 'attach', 'Attached'],
    ['detach_capability', 'detach', 'Detached'],
  ] as const) {
    shared.register({
      name,
      description: `${verb} a shared capability to yourself, or to another Bot if you are a Main Bot.`,
      parameters: {
        name: { type: 'string', required: true, description: 'Capability name from list_capabilities' },
        bot: { type: 'string', description: 'Optional Bot name; only a Main Bot may change another Bot' },
      },
      schema: z.object({
        name: z.string(),
        bot: z.string().optional(),
      }).passthrough(),
      async execute(args: ChangeAttachmentArgs, context: ToolContext): Promise<string> {
        await t.load()
        const self = t.selfOf(context.sessionId)
        if (!t.botOf(self)) return `Only Bots on the team can use ${name}.`
        try {
          const result = await t.changeCapabilityAttachment(endpoint, args, self)
          const attached = t.own(state.capabilities.items, args.name)
          const members: CapabilityItem[] = attached?.kind === 'pack'
            ? (attached.items ?? []).map(child => t.own(state.capabilities.items, child)).filter((item): item is CapabilityItem => item !== undefined)
            : attached ? [attached] : []
          const approvals = members
            .filter(item => item.kind === 'mcp' && item.transport === 'stdio' && item.approved !== true)
            .map(item => ` The user must allow ${item.name} in Moon Bot settings before it can work.`)
            .join('')
          return `${verb} ${args.name} ${args.bot ? `to ${result.bot}` : 'to yourself'}. Changes apply from ${result.bot}'s next message.${endpoint === 'attach' ? approvals : ''}`
        } catch (error) { return errorMessage(error) }
      },
    })
  }
}

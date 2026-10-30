// Moon Bot: a team of long-lived Bots. Every Bot is one Session; the roster, rooms, and
// the bot-to-bot exchange log live in one JSON file under the team home so they survive
// restarts. This module is the plugin entry: it builds the runtime once and threads it
// through every host module's install().
//
// The standalone refactor (docs/plans/2026-10-24-standalone-personal-agent.md) keeps
// this entry while the host still hosts it; phase 3's own service loads the same modules.
import { join } from 'node:path'
import type { HostContext } from './host/host-types.js'
import * as diagnostics from './host/diagnostics.ts'
import * as store from './host/store.ts'
import * as models from './host/models.ts'
import * as providers from './host/providers.ts'
import * as permissions from './host/permissions.ts'
import * as turns from './host/turns.ts'
import * as handoffs from './host/handoffs.ts'
import * as tasksPanel from './host/tasks-panel.ts'
import * as delivery from './host/delivery.ts'
import * as roster from './host/roster.ts'
import * as folders from './host/folders.ts'
import * as agents from './host/agents.ts'
import * as prompt from './host/prompt.ts'
import * as timeContext from './host/time-context.ts'
import * as tools from './host/tools.ts'
import * as chatIndex from './host/chat-index.ts'
import * as groups from './host/groups.ts'
import * as approvals from './host/approvals.ts'
import * as resume from './host/resume.ts'
import * as memory from './host/memory.ts'
import * as parts from './host/parts.ts'
import * as images from './host/images.ts'
import * as browser from './host/browser.ts'
import * as secrets from './host/secrets.ts'
import * as connectors from './host/connectors.ts'
import * as capabilities from './host/capabilities.ts'
import * as schedules from './host/schedules.ts'
import * as usage from './host/usage.ts'
import * as update from './host/update.ts'
import * as thinking from './host/thinking.ts'
import * as channel from './host/channel.ts'
import * as feed from './host/feed.ts'
import * as workspaceFiles from './host/workspace-files.ts'

export { COLORS } from './host/constants.ts'

export const name = 'moon-bot'
export const inject = [
  'llm',
  'tools',
  'systemPrompt',
  'sessionController',
  'sessions',
  'sessionTitle',
  'workspaceRegistry',
  'connection',
]

// Each module's install(rt) registers its listeners, tools, and effects, and puts on `rt`
// the functions other modules call; they call them through `rt` at run time, never during
// install. Listeners run and tools are listed in registration order, so this order holds:
// usage meters model requests after every listener that rewrites them.
const MODULES = [
  diagnostics,
  store,
  models,
  providers,
  permissions,
  turns,
  handoffs,
  tasksPanel,
  delivery,
  roster,
  folders,
  agents,
  prompt,
  timeContext,
  tools,
  chatIndex,
  groups,
  approvals,
  resume,
  memory,
  parts,
  images,
  secrets,
  connectors,
  capabilities,
  schedules,
  browser,
  usage,
  update,
  thinking,
  feed,
  workspaceFiles,
  channel,
]

export function apply(ctx: HostContext, config: Record<string, unknown> = {}): void {
  createRuntime(ctx, config)
}

export function createRuntime(ctx: HostContext, config: Record<string, unknown> = {}) {
  const otherAppHome = folders.otherAppHomeOf(process.env.DSH_HOME)
  const home = (config.home as string | undefined) ?? join(otherAppHome, 'bot')
  const rt = {
    ctx,
    config,
    otherAppHome,
    home,
    statePath: join(home, 'state.json'),
    defaults: {
      mainName: (config.mainName as string | undefined) ?? 'Chief',
      mainRole: (config.mainRole as string | undefined) ?? 'Chief of Staff',
    },
  }
  for (const module of MODULES) module.install(rt as never)
  return rt
}

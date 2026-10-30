// The records, actions and component props the settings surfaces share. Kept apart from
// the pages so the settings dialog and the forms it shows describe one contract.
import type { ModelEntry } from './model-menu.tsx'
import type { SecretActions, SecretEntry, SecretRequest } from './secret-card.tsx'
import type { Connector, ConnectorActions } from './connectors.tsx'
import type { Capability, CapabilityStatus } from './capability-types.ts'
import type { RelayActions } from './relay-page.tsx'
import type { TaskActions } from './tasks-page.tsx'
import type { FolderMenuActions } from './folder-menu.tsx'
import type { UsagePageProps } from './usage-page.tsx'
import type { DiagnosticsReport } from './feedback.tsx'

// The team records the settings page and its forms read; the rest passes through.
export interface SettingsEngineOption {
  id: string
  label: string
  kind: string
  command?: string
  args?: readonly string[]
  key?: string
  path?: string
  version?: string
  selectable?: boolean
  reason?: string
  online?: boolean
  onDemand?: boolean
  health?: 'ready' | 'unversioned' | 'on-demand' | 'unsupported' | 'missing'
}
export interface SettingsBotEngine {
  kind: 'builtin' | 'acp' | 'acp-remote'
  command?: string
  args?: readonly string[]
  key?: string
  agentId?: string
}
export interface SettingsBot {
  id: string
  name: string
  role?: string
  hidden?: boolean
  pinned?: boolean
  color?: string
  avatar?: { shape?: string; image?: string } | null
  model?: string
  appliedModel?: string
  effort?: string
  engine?: SettingsBotEngine
  runtimeId?: string
  instructions?: string
  workDir?: string
  capabilities?: readonly string[]
}
export interface SettingsRoom {
  id: string
  name: string
  members: readonly string[]
  admin: string | null
  hidden?: boolean
}
export interface SettingsPrefs {
  theme?: string | undefined
  accent?: string | null | undefined
  motion?: string | undefined
}
export interface SettingsRoster {
  bots: SettingsBot[]
  rooms: SettingsRoom[]
  byId: Record<string, SettingsBot | undefined>
  roomsById: Record<string, SettingsRoom | undefined>
  prefs?: SettingsPrefs
  models?: readonly ModelEntry[]
  defaultModel?: string | null
  mainBotId?: string | null
  mainBotIds?: readonly string[]
  memory?: boolean
  connectors?: Connector[]
  capabilities?: readonly Capability[]
  capabilityStatuses?: Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>>
  capabilityTools?: Readonly<Record<string, readonly string[]>>
  secrets?: readonly SecretEntry[]
  secretRequests?: Record<string, readonly SecretRequest[] | undefined>
}
// A patch to one Bot; every field the forms save is optional.
export interface BotPatch {
  name?: string | undefined
  role?: string | undefined
  instructions?: string | undefined
  workDir?: string | undefined
  model?: string | undefined
  effort?: string | null | undefined
  engine?: SettingsBotEngine | null | undefined
  runtimeId?: string | null | undefined
  avatar?: { shape?: string; image?: string } | null | undefined
  color?: string | null | undefined
  pinned?: boolean | undefined
  hidden?: boolean | undefined
  permission?: string | undefined
}
export interface SettingsActions extends FolderMenuActions, SecretActions, ConnectorActions, RelayActions, TaskActions {
  closeSettings: () => void
  openSettings: (page: string, id?: string | null) => void
  setPrefs: (prefs: SettingsPrefs) => Promise<unknown>
  setMain: (id: string, main?: boolean, options?: { replace?: string; primary?: boolean }) => Promise<unknown>
  setFlags: (id: string, flags: { pinned?: boolean; hidden?: boolean }) => Promise<unknown>
  openMemory: (id: string) => void
  updateBot: (id: string, patch: BotPatch) => Promise<unknown>
  duplicateBot: (id: string) => Promise<{ id: string }>
  deleteBot: (id: string) => Promise<unknown>
  /** Resets a Bot's memory, conversation, history or settings; see docs/plans/2026-10-29-reset-bot.md. */
  /** Proactive messages: the subscriptions and the manual review (2026-10-29). */
  proactiveList?: ((botId: string) => Promise<readonly Record<string, unknown>[]>) | undefined
  proactiveAdd?: ((input: Record<string, unknown>) => Promise<unknown>) | undefined
  proactiveRemove?: ((id: string) => Promise<unknown>) | undefined
  proactiveEnable?: ((id: string, enabled: boolean) => Promise<unknown>) | undefined
  proactiveReview?: ((botId: string) => Promise<Record<string, unknown>>) | undefined
  proactiveStats?: ((days: number) => Promise<Record<string, unknown> | undefined>) | undefined
  preAuthList?: ((botId: string) => Promise<readonly Record<string, unknown>[]>) | undefined
  preAuthWrite?: ((input: Record<string, unknown>) => Promise<unknown>) | undefined
  preAuthRevoke?: ((id: string) => Promise<unknown>) | undefined
  resetBot?: ((id: string, parts: Record<string, boolean>) => Promise<{ readonly done: readonly string[]; readonly failed: readonly { readonly part: string; readonly reason: string }[] } | undefined>) | undefined
  openSession: (id: string) => void
  createBot: (payload: Record<string, unknown>) => Promise<{ id: string }>
  closeOverlay: () => void
  setTeamWorkspace: (path: string) => Promise<{ team: string }>
  refreshModels?: (() => Promise<unknown>) | undefined
  refreshEngines?: (() => Promise<{ engines: readonly SettingsEngineOption[]; of: Readonly<Record<string, string>> }>) | undefined
  providers?: (() => Promise<unknown>) | undefined
  openShellSettingsPanel?: ((page?: string) => void) | undefined
  setSurface?: ((mode: string) => void) | undefined
  usage: UsagePageProps['actions']['usage']
  diagnostics: (input: { readonly client: Record<string, string>; readonly clientErrors: unknown }) => Promise<DiagnosticsReport>
  diagnosticsLog: () => Promise<string>
  diagnosticsClear: () => Promise<unknown>
  dismissToast: (token: string) => void
  // The update surface the About page and the sidebar share: the plugin update, the host's own,
  // and the desktop app updater and engine downloader that index.js installs at start.
  checkUpdate: () => Promise<unknown>
  installUpdate: () => Promise<unknown>
  installDshUpdate: () => Promise<unknown>
  openAppUpdates: (version?: string) => void
  repoStars: () => Promise<number>
  // The schedule service: a task added from the Bot settings form, and one deleted.
  scheduleCreate: (input: { target: string; title: string; prompt: string; when: Record<string, unknown> }) => Promise<unknown>
  scheduleDelete: (sessionId: string, id: string) => Promise<unknown>
}
export type RunWork = (work: Promise<unknown>) => Promise<boolean>

// Component props shared by the dialog and the Bot settings form (kit primitives).
export type {
  InlineTextProps,
  RowProps,
  CardProps,
  SwitchProps,
  SwitchRowProps,
} from 'moon-bot-ui'

export interface CharacterLook { shape: string; color: string }
export interface CharacterGridProps {
  look: CharacterLook
  hasPhoto?: boolean | undefined
  onShape: (shape: string) => unknown
  onColor: (color: string) => unknown
}
export interface AvatarEditorProps {
  bot: SettingsBot
  actions: SettingsActions
  run: RunWork
  onClose: () => void
}
export interface BotSettingsFormProps {
  bot: SettingsBot
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}

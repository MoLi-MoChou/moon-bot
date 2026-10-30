// Public contracts surface (`moon-bot-contracts`) for host, client, service, and apps.
// Named re-exports only — no `export *` (keeps the tree-shakeable face and makes cycles obvious).
// Consumers import this barrel (prefer it over any deep path).
// This package stays pure: zod + its own files only — never React, Fastify, SQLite, Electron,
// or client/host/engine/store/service (see check-gates + shared-boundary.test.ts).

export {
  LEAN,
  GROUP_TOOLS,
  SCHEDULE_TOOLS,
  LEAN_HIDDEN_TOOLS,
} from './lean.ts'

export {
  ALL_WORDS,
  USER_NAMES,
  speakerOf,
  nameProblem,
  referenceSpans,
  mentionSpans,
} from './mentions.ts'
export type {
  MentionTarget,
  LogLineLike,
  MentionSpan,
  ReferenceSpan,
} from './mentions.ts'

export type {
  Modality,
  ModelCapability,
} from './model-catalog.ts'
export {
  registerDynamicModelSpec,
  clearDynamicModelSpecs,
  formatContextWindow,
  bareModelId,
  parseWindowMark,
  stripModelDecorations,
  normalizeDashes,
  resolveModelSpec,
} from './model-catalog.ts'

export type { ModelPreset } from './model-catalog-presets.ts'
export { MODEL_PRESETS } from './model-catalog-presets.ts'

export type {
  ConnectorCategory,
  ConnectorCatalogSecret,
  ConnectorCatalogEntry,
} from './connector-catalog.ts'
export {
  CONNECTOR_CATEGORIES,
  CONNECTOR_CATALOG,
  secretRefsOf,
  capabilityOf,
} from './connector-catalog.ts'

export type {
  OpenUiSpec,
  OpenUiResult,
} from './openui.ts'
export {
  isOpenUiSpec,
  resolveViewBlueprint,
  lowerOpenUi,
} from './openui.ts'

export type {
  RpcErrorCode,
  RpcResultBody,
  RpcError,
  ChatCursor,
  ChatItem,
  ChatPage,
  ActivityView,
  WorkBot,
  WorkView,
  RunnerStats,
  TurnFileEntry,
  StateView,
  StateRequest,
  RelayInviteView,
  TaskHold,
  BotChannelRpcMap,
  RpcEndpoint,
  RpcRequest,
  RpcResponse,
  CallHost,
} from './rpc.ts'

export {
  AvatarSchema,
  SegmentSchema,
  BotWorkspaceSchema,
  BotSkillSchema,
  BotSchema,
  RoomSchema,
  ScheduleTaskSchema,
  MemoryEntrySchema,
  MemoryLimitsSchema,
  ProducedFileSchema,
  TurnFilesSchema,
  ExchangeTurnSchema,
  BotViewSchema,
  RoomViewSchema,
  SchedulesViewSchema,
} from './schema.ts'
export type {
  Avatar,
  Segment,
  BotWorkspace,
  BotSkill,
  Bot,
  Room,
  ScheduleTask,
  MemoryEntry,
  MemoryLimits,
  ProducedFile,
  TurnFiles,
  ExchangeTurn,
  BotView,
  RoomView,
  SchedulesView,
} from './schema.ts'

export type {
  ViewComponentType,
  ViewTone,
  StackView,
  TextView,
  MetricView,
  TableView,
  OptionsView,
  ConfirmView,
  FormView,
  ProgressView,
  DiffView,
  DiagramView,
  WidgetView,
  AnyView,
  InteractiveView,
  ViewCheck,
  ShownViewCheck,
  ViewAnswerCheck,
  ShownView,
  ViewAnswer,
} from './views.ts'
export {
  VIEW_BYTE_LIMIT,
  viewBytes,
  normalizeView,
  validateView,
  checkShownView,
  viewSummary,
  validateViewAnswer,
} from './views.ts'

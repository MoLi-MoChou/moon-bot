/** Types for model-menu. */
import type { CSSProperties, ElementType } from 'react'
import type { ContextValues } from './model-context.tsx'

export interface ModelReasoningEffort {
  id: string
  name: string
}
export interface ModelReasoning {
  efforts: readonly ModelReasoningEffort[]
  defaultEffort?: string | undefined
}
export interface ModelEntry {
  ref: string
  provider?: string | undefined
  providerName?: string | undefined
  name?: string | undefined
  needsKey?: boolean | undefined
  reasoning?: ModelReasoning | undefined
}
export type ModelGroup = [string, ModelEntry[]]
export interface ModelInfo {
  ref: string
  name: string
  provider: string
  served: boolean
}
export interface EffortRow {
  effort: string | undefined
  label: string
}
export interface EffortRowsProps {
  reasoning: ModelReasoning | null | undefined
  current: string | undefined
  onPick: (effort: string | undefined) => void
}
export interface ModelRowsProps {
  roster: ModelMenuRoster
  current: string | undefined
  onPick: (ref: string) => void
}
export interface MenuPlace extends CSSProperties {
  left: number
  width: number
  top?: number | undefined
  bottom?: number | undefined
  maxHeight: number
  '--bt-origin': string
}
export interface AnchoredMenu {
  isOpen: boolean
  shownPlace: MenuPlace | null
  leaving: boolean
  button: React.RefObject<HTMLButtonElement | null>
  menu: React.RefObject<HTMLDivElement | null>
  open: () => void
  close: () => void
}
export interface SignInSource<T = unknown> {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => T
}
export interface SignInHooks {
  account: SignInSource
  theme: SignInSource
}
export interface SignInOps {
  hooks: SignInHooks
  [key: string]: unknown
}
export interface SignInEntry {
  component: ElementType
  inject?: (() => SignInOps) | undefined
}
export interface ModelMenuBot {
  id: string
  name: string
  model?: string | undefined
  appliedModel?: string | undefined
  effort?: string | undefined
}
export interface ModelMenuRoster {
  models?: readonly ModelEntry[] | undefined
  defaultModel?: string | null | undefined
}
export interface ModelMenuOptionalActions {
  updateBot?: UpdateBot | undefined
  closeOverlay?: (() => void) | undefined
  refreshModels?: (() => Promise<unknown>) | undefined
  efforts?: ((ref: string) => Promise<ModelReasoning | null | undefined>) | undefined
  runStats?: ((botId: string) => Promise<ContextValues | undefined>) | undefined
  compactChat?:
    | ((botId: string) => Promise<{ readonly compacted: boolean; readonly reason?: string | undefined }>)
    | undefined
  openModels?: (() => void) | undefined
  openShellSettingsPanel?: ((page?: string) => void) | undefined
  canSignIn?: (() => boolean) | undefined
  signIn?: (() => void) | undefined
  openShellOnboardingPanel?: ((provider?: string) => void) | undefined
  setProviderKey?: ((provider: string | undefined, value: string | null) => Promise<unknown>) | undefined
  signInEntry?: (() => SignInEntry | null) | undefined
  closeSignIn?: (() => void) | undefined
  accountT?: (() => (key: string, params?: Record<string, unknown>) => string) | undefined
}
export type UpdateBot = (
  id: string,
  patch: {
    model?: string | undefined
    effort?: string | null | undefined
  },
) => Promise<unknown>
export interface ModelMenuActions extends ModelMenuOptionalActions {
  updateBot: UpdateBot
}
export interface ModelMenuProps {
  bot: ModelMenuBot
  roster: ModelMenuRoster
  // A draft form passes its own callbacks and has no saver to run.
  run?: ((work: Promise<unknown>) => unknown) | undefined
  actions: ModelMenuOptionalActions
  wide?: boolean | undefined
  onPick?: ((ref: string) => void) | undefined
  onPickEffort?: ((effort: string | undefined) => void) | undefined
}

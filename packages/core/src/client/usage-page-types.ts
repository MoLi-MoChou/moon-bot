// Shared types and constants for the usage page.
import type { ReactElement } from 'react'
import type { LookBot } from './characters.ts'
import type { UsageRange, UsageRow } from './usage-data.ts'

export const HEAT_WEEKS = 53
export const TOP_SERIES = 7
export const RING_R = 42
export const RING = 2 * Math.PI * RING_R

export type PageRange = UsageRange & { readonly ends?: boolean | undefined }
export type UsageFocus = { readonly kind: 'owner' | 'model'; readonly key: string }
export type Glyph = () => ReactElement

export type UsageOwner =
  | { readonly key: string; readonly kind: 'other' }
  | { readonly key: string; readonly kind: 'room' | 'agent' | 'bot'; readonly id: string; readonly name: string; readonly deleted?: boolean | undefined }

export interface UsageModel {
  readonly key: string
  readonly provider: string
  readonly model: string
  readonly name: string
  readonly providerName?: string | undefined
}

export interface UsagePageView {
  readonly owners: readonly UsageOwner[]
  readonly models: readonly UsageModel[]
  readonly kinds: readonly string[]
  readonly rows: readonly UsageRow[]
  readonly now: string
  readonly scanning: boolean
}

export interface UsageBot extends LookBot {
  id?: string
  name?: string
  role?: string | null
}

export interface UsageRoom {
  readonly members: readonly string[]
}

export interface UsageRoster {
  readonly byId: Record<string, UsageBot | undefined>
  readonly roomsById: Record<string, UsageRoom | undefined>
}

export interface UsageActions {
  usage: () => Promise<UsagePageView>
  openSettings: (page: string, id?: string | null) => void
}


/** Types extracted. */
import type { MarkBot } from './mark.tsx'
import type { CreateRoster, CreateBotActions } from './create-bot.tsx'

/** A Bot as the roster lists it: the mark's shape, plus what the picker shows. */
export interface ListedBot extends MarkBot {
  readonly id: string
  name: string
  role?: string | undefined
  hidden?: boolean | undefined
}
/** The roster fields the picker reads; the rest of a roster passes through untouched. */
export interface NewChatRoster extends CreateRoster {
  bots: ListedBot[]
  byId: Record<string, ListedBot | undefined>
  agents?: readonly unknown[] | undefined
}
export interface NewChatActions extends CreateBotActions {
  openSession(id: string): void
  showDetails(id: string, page: string): void
  send(id: string, text: string): Promise<unknown>
  setFlags(
    id: string,
    flags: {
      hidden: boolean
    },
  ): Promise<unknown>
  createRoom(
    members: readonly string[],
    options?: {
      admin?: string | undefined
      greet?: boolean | undefined
    },
  ): Promise<{
    id: string
  }>
  addAgent?(): Promise<unknown>
}
export interface NewChatProps {
  mode: string
  roster: NewChatRoster
  actions: NewChatActions
}
/** The Create Bot form, opened from 'create' mode or from the list. */
export interface Draft {
  name: string
  fromList: boolean
}
/** One row of the picker. */
export interface Option {
  key: string
  label: string
  run: () => void
  icon?: unknown
  hint?: string | undefined
  bot?: ListedBot | undefined
}

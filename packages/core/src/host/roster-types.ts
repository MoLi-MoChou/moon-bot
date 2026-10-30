/** Types extracted. */
// Roster: creating, changing, and deleting Bots and group chats, the Main Bot role, and
// the first Main Bot of a new team. The Session setup lives in roster-setup.ts and the
// group chat rules in roster-rooms.ts.

export interface CreateBotOptions {
  readonly name?: unknown
  readonly role?: unknown
  readonly instructions?: unknown
  readonly color?: string | null
  readonly brief?: string
  readonly createdBy?: string
  readonly main?: boolean
  readonly avatar?: unknown
  readonly model?: string
  readonly effort?: string
  readonly workDir?: string | null
  readonly copyOf?: string
  readonly pickModel?: boolean
  readonly engine?: unknown
  readonly runtimeId?: unknown
}

export interface UpdateBotPatch {
  readonly name?: unknown
  readonly role?: unknown
  readonly instructions?: unknown
  readonly color?: string | null
  readonly avatar?: unknown
  readonly model?: string | null
  readonly effort?: string | null
  readonly permission?: string | null
  readonly workDir?: string | null
  readonly engine?: unknown
  readonly runtimeId?: unknown
}

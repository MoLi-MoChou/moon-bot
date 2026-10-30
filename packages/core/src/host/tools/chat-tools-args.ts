// The argument shapes the chat tools read. They live here so the registrations
// stay the code: the tool executor narrows from these.

export interface GroupArgs {
  readonly group?: string
}

export interface CreateGroupArgs {
  readonly members?: unknown
  readonly name?: string
  readonly notice?: string
  readonly admin?: string
  readonly mode?: string
}

export interface UpdateGroupArgs {
  readonly group?: string
  readonly name?: string
  readonly notice?: string
  readonly add_members?: unknown
  readonly remove_members?: unknown
  readonly admin?: string
  readonly mode?: string
  readonly work_dir?: unknown
}

export interface PostToGroupArgs {
  readonly group?: string
  readonly message?: unknown
  readonly report_back?: unknown
}

export interface AskUserArgs {
  readonly question?: unknown
  readonly options?: unknown
  readonly detail?: unknown
  readonly multiSelect?: unknown
  readonly allowCustom?: unknown
}

export interface ShowViewArgs {
  readonly title?: unknown
  readonly view?: unknown
  readonly await_reply?: unknown
}

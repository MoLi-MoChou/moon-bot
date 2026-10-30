/** Types extracted. */
import type { Agent } from './host-types.js'
import type { ToolContext } from '../engine/registry.ts'
// Group chats: the public surface the rest of the host imports, the group tools
// (group_relay, read_own_chat, read_group_chat). The runtime slice they use is in
// `groups/types.ts`.
//
// The room itself lives in `groups/log.ts` (the log, members' group Sessions, prompts,
// and posts), the rounds in `groups/rounds.ts`, the shared text rules in
// `groups/notice.ts`, and the shapes they all use in `groups/types.ts`.

/** The relay's context: the live agent of the group Session, whose inbox the round
 *  drains, rides a ToolContext where the host provides one (tools/the host.ts). */
export interface RelayContext extends ToolContext {
  readonly agent?: Agent
}

export interface ReadOwnChatArgs {
  readonly query?: unknown
  readonly around?: unknown
  readonly part?: unknown
}

export interface ReadGroupChatArgs {
  readonly group?: unknown
  readonly seq?: unknown
}

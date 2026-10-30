// Moon Bot patch: the slim product. DS Bot's group chats, scheduled/automation tasks,
// Agent entry and the classic Agent mode switch stay in the code but are not
// offered: not in the UI, and not in the Bots' tool lists or instructions. Flip a flag
// to bring one back (see NOTICE).
export const LEAN = { groups: true, schedules: true, dshAgent: false, classicMode: false }

export const GROUP_TOOLS: readonly string[] = ['create_group', 'update_group', 'delete_group', 'post_to_group', 'read_group_chat']
export const SCHEDULE_TOOLS: readonly string[] = ['schedule_create', 'schedule_update', 'schedule_delete', 'schedule_list']
// Tools a Bot's own chat does not get under LEAN.
export const LEAN_HIDDEN_TOOLS: readonly string[] = [...(LEAN.groups ? [] : GROUP_TOOLS), ...(LEAN.schedules ? [] : SCHEDULE_TOOLS)]

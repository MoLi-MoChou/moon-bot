import { t } from './i18n.ts'
import { toolState } from './mark.tsx'
import type { ChatBot } from './cells-bubbles.tsx'
import type { ArgReader, ToolActivity, WorkDoing } from './cells-tool-types.ts'

export const PHRASES = {
  thinking: [
    'Mulling it over',
    'Thinking about it',
    'Weighing the options',
    'Working out a plan',
    'Sorting out the details',
  ],
  working: ['Getting it done', 'On it', 'Busy with it', 'Moving ahead', 'Taking care of it', 'Making headway'],
}
export const TOOL_PHRASES: readonly (readonly [RegExp, string])[] = [
  [/web_?search|search_?web/i, 'Searching online'],
  [/fetch|browse|browser|web/i, 'Reading a page'],
  [/shell|bash|pwsh|powershell|exec|command|terminal/i, 'Running shell commands'],
  [/^(read|view|cat)\b|read_/i, 'Opening a file'],
  [/grep|glob|list_dir|^ls$|find|search/i, 'Looking through files'],
  [/write|edit|patch|apply|replace/i, 'Writing changes'],
  [/image|photo|draw/i, 'Working on an image'],
]
export const GROUP_PHRASES: Readonly<Record<string, string | undefined>> = {
  create_group: 'Creating a group',
  update_group: 'Updating the group',
  delete_group: 'Deleting the group',
  post_to_group: 'Posting in the group',
}
export function toolActivity(
  name: string | undefined,
  arg: ArgReader,
  findBot: (nameOrId?: string | undefined) => ChatBot | undefined,
  self: ChatBot | undefined,
): ToolActivity | null {
  switch (name) {
    case 'ask_user':
      return null
    case 'request_secret':
      return null
    case 'list_secrets':
      return { label: t('Checking the keys'), state: 'searching' }
    case 'ask_user_question':
      return { label: t('Waiting for your answer'), state: 'alert' }
    case 'group_relay':
      return { relay: true, state: 'orbit' }
    case 'message_bot': {
      const target = findBot(arg('to'))
      return { label: target ? t('Asking {name}', { name: target.name }) : t('Asking another Bot'), state: 'sending' }
    }
    case 'stop_bot': {
      const target = findBot(arg('bot'))
      return {
        label: target ? t('Stopping {name}', { name: target.name }) : t('Stopping another Bot'),
        state: 'sending',
      }
    }
    case 'create_bot':
      return { label: t('Creating {name}', { name: arg('name') ?? t('a Bot') }), state: 'sending' }
    case 'update_bot': {
      const target = findBot(arg('name')) ?? findBot(arg('bot')) ?? (arg('bot') ? undefined : self)
      return { label: t('Updating {name}', { name: target?.name ?? t('a Bot') }), state: 'sending' }
    }
    case 'list_bots':
      return { label: t('Checking the team'), state: 'searching' }
    case 'read_group_chat':
      return { label: t('Reading {name}', { name: arg('group') ?? t('a group chat') }), state: 'searching' }
    case 'read_own_chat':
      return { label: t('Looking back through the chat'), state: 'searching' }
    case 'remember':
      return { label: t('Saving to memory'), state: 'working' }
    case 'forget':
      return { label: t('Updating memory'), state: 'working' }
    case 'recall':
      return { label: t('Checking memory'), state: 'searching' }
    default: {
      const group = name === undefined ? undefined : GROUP_PHRASES[name]
      if (group) return { label: t(group), state: 'sending' }
      const phrase = TOOL_PHRASES.find(([pattern]) => pattern.test(String(name)))?.[1]
      return { label: phrase ? t(phrase) : null, state: toolState(String(name)) }
    }
  }
}
// What a Bot busy elsewhere is doing: what it said in the step it is on, its running
// call's own description, else the kind of tool and what it works on. `doing` is a work
// entry, or just a tool name.
export function workPhrase(doing: string | WorkDoing | undefined): string {
  const { tool, said, note, target, switching } = typeof doing === 'string' ? { tool: doing } : (doing ?? {})
  if (switching) return t('Moving to a fresh conversation')
  const own = (said || note)?.replace(/[\s.。…]+$/u, '')
  if (own) return own
  if (!tool) return t('Thinking about it')
  const label =
    toolActivity(
      tool,
      () => undefined,
      () => undefined,
      undefined,
    )?.label ?? t('On it')
  return target ? `${label} · ${target}` : label
}

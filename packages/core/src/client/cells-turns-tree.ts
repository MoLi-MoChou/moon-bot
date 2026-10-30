import { contentText } from './text.ts'

export const DRAWN = new Set([
  'message_bot',
  'stop_bot',
  'create_bot',
  'update_bot',
  'group_relay',
  'create_group',
  'update_group',
  'delete_group',
  'post_to_group',
  'ask_user',
  'request_secret',
  'ask_user_question',
  'show_view',
  'read_group_chat',
  'remember',
  'forget',
])
// Calls whose card a dock above the composer carries when the call is not drawn.
export const CARDS = new Set(['ask_user', 'request_secret', 'show_view'])
export interface ChatCall {
  name?: string
  kind?: string
  isError?: boolean
  callId?: string
  turn?: number
  argsRaw?: string
  call?: {
    name?: string
    argsRaw?: string
  }
  args?: {
    text?: (key: string) => string | undefined
    value?: (key: string) => unknown
  }
  content?: Parameters<typeof contentText>[0]
  subCalls?: readonly ChatCall[]
}
// The root and its sub-calls in dispatch order, each call once.
export function callTree(root: ChatCall): ChatCall[] {
  const calls: ChatCall[] = []
  const seen = new Set<string | ChatCall>()
  const visit = (call: ChatCall): void => {
    const id = call.callId ?? call
    if (seen.has(id)) return
    seen.add(id)
    calls.push(call)
    for (const child of call.subCalls ?? []) visit(child)
  }
  visit(root)
  return calls
}
// The newest call that is not a result: what the program is doing now.
export const lastRunning = (calls: readonly ChatCall[]): ChatCall | undefined => {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]
    if (call !== undefined && call.kind !== 'tool-result') return call
  }
  return undefined
}

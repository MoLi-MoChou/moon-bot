// The custom connector form's rules: a name becomes the capability id, the transport
// decides which fields matter, and one validation pass feeds both the inline errors and
// the request the host takes.
import type { Capability } from './capability-types.ts'

export type CustomTransport = 'stdio' | 'streamable-http' | 'sse'
export interface CustomConnectorDraft {
  name: string
  transport: CustomTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  description: string
  originalName?: string
}
export interface CustomConnectorErrors {
  name?: string
  command?: string
  envText?: string
  url?: string
  headersText?: string
}

export const blankCustomConnector = (): CustomConnectorDraft => ({
  name: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  envText: '{}',
  url: '',
  headersText: '{}',
  description: '',
})

/** The capability id the host will see: lowercase, digits and single hyphens. */
export function connectorIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export function draftFromConnector(item: Capability): CustomConnectorDraft {
  return {
    name: item.name,
    transport: item.transport === 'sse' ? 'sse' : item.transport === 'stdio' ? 'stdio' : 'streamable-http',
    command: item.command ?? '',
    argsText: (item.args ?? []).join('\n'),
    envText: JSON.stringify(item.env ?? {}, null, 2),
    url: item.url ?? '',
    headersText: JSON.stringify(item.headers ?? {}, null, 2),
    description: item.description ?? '',
    originalName: item.name,
  }
}

const jsonObject = (text: string): boolean => {
  try {
    const value = JSON.parse(text || '{}') as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

const isUrl = (text: string): boolean => {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Everything blocking a save, under the field it belongs to. */
export function customConnectorErrors(
  draft: CustomConnectorDraft,
  existing: readonly { name: string }[] = [],
): CustomConnectorErrors {
  const errors: CustomConnectorErrors = {}
  const id = connectorIdOf(draft.name)
  if (id === '') errors.name = 'Enter a name with letters or digits.'
  else if (id === 'github') errors.name = '"github" is reserved for the GitHub connector.'
  else if (id.length > 32) errors.name = 'Keep the name to 32 characters or fewer.'
  else if (existing.some(item => item.name === id && item.name !== draft.originalName))
    errors.name = 'A capability with this name already exists.'
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') errors.command = 'Enter the command that starts the server.'
    if (!jsonObject(draft.envText))
      errors.envText = 'Use a JSON object, such as {"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}.'
  } else {
    if (!isUrl(draft.url)) errors.url = 'Enter a full HTTP or HTTPS URL.'
    if (!jsonObject(draft.headersText))
      errors.headersText = 'Use a JSON object, such as {"Authorization": "Bearer $MOON_BOT_SECRET_MY_KEY"}.'
  }
  return errors
}

const parseMap = (text: string): Record<string, unknown> => {
  const value = JSON.parse(text || '{}') as unknown
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Splits the command line into the executable and the arguments typed beside it. */
export function commandParts(command: string): { readonly command: string; readonly args: string[] } {
  const [head, ...rest] = command.trim().split(/\s+/).filter(Boolean)
  return { command: head ?? '', args: rest }
}

/** The `capability-save` payload for a custom connector; callers validate first. */
export function customCapabilityOf(draft: CustomConnectorDraft): Record<string, unknown> {
  const id = draft.originalName ?? connectorIdOf(draft.name)
  const payload: Record<string, unknown> = {
    name: id,
    kind: 'mcp',
    description: draft.description.trim() || `${id} MCP server`,
    transport: draft.transport,
  }
  if (draft.transport === 'stdio') {
    const parts = commandParts(draft.command)
    payload.command = parts.command
    payload.args = [...parts.args, ...draft.argsText.split('\n').filter(line => line !== '')]
    payload.env = parseMap(draft.envText)
  } else {
    payload.url = draft.url.trim()
    payload.headers = parseMap(draft.headersText)
  }
  return payload
}

/** The `capability-test` payload: what the form has now, saved or not. */
export function customTestOf(draft: CustomConnectorDraft): Record<string, unknown> {
  return { ...customCapabilityOf(draft), name: draft.originalName ?? (connectorIdOf(draft.name) || 'test-connection') }
}

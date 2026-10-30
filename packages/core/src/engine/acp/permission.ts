// ACP permission negotiation (plan §阶段 5 / 2026-10-28 ACP alignment):
// An external agent pauses its turn to ask the client for authorization (session/request_permission).
// We map the request onto Moon Bot's host approval service, and convert the user's choice back
// to the agent's RequestPermissionOutcome.

export interface PermissionOption {
  readonly optionId: string
  readonly name?: string
  readonly kind?: string
}

export interface PermissionToolCall {
  readonly toolCallId?: string
  readonly title?: string
  readonly kind?: string
  readonly rawInput?: unknown
  readonly input?: unknown
  readonly arguments?: unknown
}

export interface PermissionRequestParams {
  readonly sessionId?: string
  readonly toolCall?: PermissionToolCall
  readonly options?: readonly PermissionOption[]
}

export type PermissionDecision = 'allowed-once' | 'allowed' | 'rejected' | 'cancelled'

export interface RequestPermissionResult {
  readonly outcome: {
    readonly outcome: 'selected'
    readonly optionId: string
  } | {
    readonly outcome: 'cancelled'
  }
}

export interface ApprovalDetailPayload {
  readonly text?: string
  readonly code?: string
}

/** Extracts readable code and text description from a tool call for approval cards. */
export function detailOfPermission(toolCall: PermissionToolCall | undefined): ApprovalDetailPayload {
  if (!toolCall) return {}
  const raw = toolCall.arguments ?? toolCall.rawInput ?? toolCall.input
  let code: string | undefined
  if (typeof raw === 'string') {
    code = raw
  } else if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const firstStr = (keys: readonly string[]) => keys.map(k => obj[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '')
    code = firstStr(['command', 'cmd', 'file_path', 'path', 'url', 'query']) ?? JSON.stringify(raw)
  }
  const text = toolCall.title ?? toolCall.kind ?? undefined
  return {
    ...(text !== undefined ? { text: text.slice(0, 300) } : {}),
    ...(code !== undefined ? { code: code.slice(0, 400) } : {}),
  }
}

/** Matches an approval outcome to the ACP options provided by the agent. */
export function matchPermissionOutcome(options: readonly PermissionOption[] | undefined, decision: PermissionDecision | string): RequestPermissionResult {
  if (decision === 'cancelled' || !options || options.length === 0) {
    return { outcome: { outcome: 'cancelled' } }
  }
  if (decision === 'allowed-once' || decision === 'allowed') {
    const matched = options.find(o =>
      o.kind === 'allow_once' || o.kind === 'allow' ||
      o.optionId === 'allow_once' || o.optionId === 'allow' ||
      o.optionId.toLowerCase().includes('allow'),
    ) ?? options[0]
    if (matched !== undefined) return { outcome: { outcome: 'selected', optionId: matched.optionId } }
    return { outcome: { outcome: 'cancelled' } }
  }
  if (decision === 'rejected') {
    const matched = options.find(o =>
      o.kind === 'reject' || o.kind === 'deny' ||
      o.optionId === 'reject' || o.optionId === 'deny' ||
      o.optionId.toLowerCase().includes('reject'),
    )
    if (matched !== undefined) return { outcome: { outcome: 'selected', optionId: matched.optionId } }
    return { outcome: { outcome: 'cancelled' } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

// Failure text: a failed turn's `LlmFailure`, the one-line form for logs, and the words a
// person reads in a group chat. Nothing here touches a Session or the stored state.

/** A failure as `failureLine`, `failureSay` and the group host read it. */
export interface FailureText {
  readonly code?: string | undefined
  readonly status?: number | string | undefined
  readonly message?: string | undefined
  readonly requestId?: string | undefined
}

/** A failed turn's failure, kept to what can be shown and logged. */
export interface TurnFailure {
  readonly code: string
  readonly message: string
  readonly status?: number | undefined
  readonly requestId?: string | undefined
}

// The fields a thrown value carries; the host raises its own error shapes, so they are read
// structurally at this boundary rather than assumed.
const failureOf = (error: unknown): FailureText =>
  error !== null && typeof error === 'object' ? (error as FailureText) : {}

// Like the host's own error row, an AUTH failure loses its message: providers may echo part of
// the key.
export function turnFailure(error: unknown): TurnFailure {
  const cause = failureOf(error)
  const code = typeof cause.code === 'string' && cause.code !== '' ? cause.code : 'UNKNOWN'
  const message = code === 'AUTH' || typeof cause.message !== 'string' ? '' : cause.message.trim().slice(0, 500)
  return {
    code,
    message,
    ...(typeof cause.status === 'number' ? { status: cause.status } : {}),
    ...(typeof cause.requestId === 'string' ? { requestId: cause.requestId } : {}),
  }
}

export const failureLine = (failure: FailureText): string =>
  `${failure.code}${failure.status ? ` ${failure.status}` : ''}${failure.message ? `: ${failure.message.slice(0, 200)}` : ''}`

// A model failure said so a person can read it: the chat line a failed member leaves in
// its group must not show a raw code. The code stays in failureLine, for the logs and the
// diagnostics the user can send.
const FAILURE_WORDS: Readonly<Record<string, { readonly en: string; readonly zh: string }>> = {
  AUTH: { en: 'the model refused the key', zh: '模型不认这把密钥' },
  RATE_LIMIT: { en: 'the model is rate limited', zh: '模型请求太频繁' },
  QUOTA: { en: 'the model is out of quota', zh: '模型的额度用完了' },
  OVERLOADED: { en: 'the model is overloaded right now', zh: '模型这会儿过载了' },
  CONTEXT_WINDOW_EXCEEDED: { en: 'the conversation is too long for the model', zh: '对话太长，超出了模型的容量' },
  INVALID_REQUEST: { en: 'the model service refused the request', zh: '模型服务拒绝了这次请求' },
  SERVER: { en: 'the model service failed', zh: '模型服务出错' },
  TIMEOUT: { en: 'the model took too long', zh: '模型响应超时' },
  TRANSPORT: { en: 'the model service could not be reached', zh: '连不上模型服务' },
  SESSION: { en: 'its group conversation could not open', zh: '群会话打不开' },
  'NO-MODEL': { en: 'no model is set for this Bot', zh: '这个 Bot 还没有可用模型' },
  SESSION_RESET: { en: 'its group conversation had to start again', zh: '群会话需要重新开始' },
}

export const failureSay = (failure: FailureText | undefined, zh = false): string => {
  const words = failure?.code === undefined ? undefined : FAILURE_WORDS[failure.code]
  return words?.[zh ? 'zh' : 'en'] ?? (zh ? '模型调用失败' : 'the model call failed')
}

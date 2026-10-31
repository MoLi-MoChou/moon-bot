import { errorCopy, hostText } from './i18n.ts'

export interface ConnectorFailure {
  readonly code?: unknown
  readonly message?: unknown
}

export function connectorErrorText(failure: unknown): string {
  const value = failure as ConnectorFailure | null
  const code = typeof value?.code === 'string' ? value.code : undefined
  const message = typeof value?.message === 'string' ? value.message : String(failure ?? '')
  if (code !== undefined) return errorCopy(code, message)
  const translated = hostText(message)
  return translated !== message ? translated : errorCopy(undefined)
}

export function connectorStatusError(code: string | undefined, message: string | undefined): string {
  return errorCopy(code, message)
}

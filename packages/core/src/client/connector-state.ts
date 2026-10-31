// How one connector's health reads in Settings: the sentence that says what happened and the
// action that clears it. Kept beside the page rather than inside it so the wording and the
// next-step choice can be tested without a renderer.
import { t } from './i18n.ts'
import { connectorErrorText } from './connector-error.ts'

/** The seven states the host reports, plus the fields it may send with them. */
export type ConnectorState = 'off' | 'connecting' | 'ready' | 'needs-auth' | 'needs-approval' | 'error' | 'unavailable'

export interface ConnectorHealthView {
  readonly state: ConnectorState
  readonly account?: string | null | undefined
  readonly error?: string | undefined
  readonly lastErrorAt?: number | undefined
  readonly lastOkAt?: number | undefined
  readonly retryAt?: number | undefined
  readonly fingerprint?: string | undefined
  readonly about?: string | undefined
}

/** The one action the row offers for this state, or null when there is nothing to do. */
export type ConnectorAction =
  | { readonly kind: 'connect' }
  | { readonly kind: 'replace-token' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'approve' }
  | { readonly kind: 'none' }

/** What the row says. The failure text already went through the host's redaction. */
export function connectorStateText(connector: ConnectorHealthView): string {
  switch (connector.state) {
    case 'connecting':
      return t('Connecting…')
    case 'ready':
      return connector.account ? t('Connected as {account}', { account: connector.account }) : t('Connected')
    case 'needs-auth':
      return t('Needs a new token. {error}', { error: connectorErrorText(connector.error) })
    case 'needs-approval':
      return t('Waiting for your approval before it can connect.')
    case 'unavailable':
      return t('Not available in this build. {error}', { error: connectorErrorText(connector.error) })
    case 'error':
      return t('Could not connect: {error}', { error: connectorErrorText(connector.error) })
    case 'off':
    default:
      return t('Not connected. {about}', { about: connector.about ?? '' })
  }
}

/**
 * The action a state offers. A rejected credential needs a new token, not a retry — waiting
 * cannot fix it. An unavailable connector needs nothing from the user in this build.
 */
export function connectorActionOf(connector: ConnectorHealthView): ConnectorAction {
  switch (connector.state) {
    case 'needs-auth':
      return { kind: 'replace-token' }
    case 'error':
      return { kind: 'retry' }
    case 'off':
      return { kind: 'connect' }
    case 'needs-approval':
      return { kind: 'approve' }
    default:
      return { kind: 'none' }
  }
}

/** Whether the row's Connect form should be open for this state. */
export function wantsTokenForm(connector: ConnectorHealthView): boolean {
  const action = connectorActionOf(connector)
  return action.kind === 'connect' || action.kind === 'replace-token'
}

/** A short note under the row: when it last worked, or when to try again. */
export function connectorMetaText(
  connector: ConnectorHealthView,
  now: number,
  format: (time: number) => string,
): string | null {
  if (connector.state === 'ready' && typeof connector.lastOkAt === 'number')
    return t('Last connected {when}', { when: format(connector.lastOkAt) })
  if (typeof connector.retryAt === 'number' && connector.retryAt > now) return t('Trying again on its own in a moment.')
  if (connector.state === 'error' && typeof connector.lastErrorAt === 'number')
    return t('Failed {when}', { when: format(connector.lastErrorAt) })
  return null
}

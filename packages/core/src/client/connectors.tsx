import { createElement as h, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useMorph } from './motion.tsx'
import { MaskedInput } from './secret-card.tsx'
import { t } from './i18n.ts'
import { ConnectorCatalog, type MarketActions } from './connector-market.tsx'
import { CustomConnectorForm, CustomConnectorList, type CustomConnectorActions } from './connector-custom.tsx'
import { blankCustomConnector, draftFromConnector, type CustomConnectorDraft } from './connector-custom.ts'
import { CONNECTOR_CATALOG } from 'moon-bot-contracts'
import type { Capability, CapabilityBot, CapabilityStatus } from './capability-types.ts'
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
// One connector as Settings shows it: what the host reports about its link.
export interface Connector {
  id: string
  name: string
  state: string
  account?: string
  error?: string
}
export interface ConnectorActions extends CustomConnectorActions {
  connectorConnect: (id: string, token: string) => Promise<unknown>
  connectorRetry: (id: string) => Promise<unknown>
  connectorDisconnect: (id: string) => Promise<unknown>
  openSettings?: (page: string) => void
}
export const GitHubMark = () => (
  <svg width={20} height={20} viewBox='0 0 16 16' fill='currentColor' aria-hidden>
    <path d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' />
  </svg>
)
const MARKS: Record<string, () => ReactElement> = { github: GitHubMark }
const ABOUT: Record<string, () => string> = { github: () => t('Repositories, issues, and pull requests') }
function statusText(connector: Connector): string {
  if (connector.state === 'connecting') return t('Connecting…')
  if (connector.state === 'error') return t('Could not connect: {error}', { error: connector.error ?? '' })
  if (connector.state === 'ready')
    return connector.account ? t('Connected as {account}', { account: connector.account }) : t('Connected')
  return t('Not connected. {about}', { about: ABOUT[connector.id]?.() ?? '' })
}
function ConnectorRow({ connector, actions }: { connector: Connector; actions: ConnectorActions }) {
  const [form, setForm] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (task: Promise<unknown>, after?: () => void): Promise<void> => {
    setBusy(true)
    setError(null)
    return task
      .then(
        () => {
          after?.()
        },
        failure => setError(failure?.message ?? String(failure)),
      )
      .finally(() => setBusy(false))
  }
  const connect = () => {
    if (busy || token.trim() === '') return
    void run(actions.connectorConnect(connector.id, token), () => {
      setToken('')
      setForm(false)
    })
  }
  const on = connector.state !== 'off'
  const Mark = MARKS[connector.id]
  const row = useRef<HTMLDivElement | null>(null)
  useMorph(row, `${form}:${error !== null}:${connector.state}`)
  return (
    <div ref={row} className='bt-connector' data-state={connector.state}>
      <div className='bt-connector-head'>
        <span className='bt-connector-mark'>{Mark ? <Mark /> : null}</span>
        <span className='bt-connector-text'>
          <span className='bt-connector-name'>{connector.name}</span>
          <span className='bt-connector-status'>{statusText(connector)}</span>
        </span>
        <span className='bt-connector-actions'>
          {connector.state === 'error' ? (
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              disabled={busy}
              onClick={() => void run(actions.connectorRetry(connector.id))}>
              {t('Try again')}
            </button>
          ) : null}
          {on ? (
            <button type='button' className='bt-soft bt-soft-sm' disabled={busy || form} onClick={() => setForm(true)}>
              {t('Replace token')}
            </button>
          ) : form ? null : (
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => setForm(true)}>
              {t('Connect')}
            </button>
          )}
          {on ? (
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              disabled={busy}
              onClick={() => void run(actions.connectorDisconnect(connector.id))}>
              {t('Disconnect')}
            </button>
          ) : null}
        </span>
      </div>
      {form ? (
        <div className='bt-connector-form'>
          <label className='bt-q-field bt-secret-field'>
            <MaskedInput value={token} onChange={setToken} onEnter={connect} label={t('GitHub token')} autoFocus />
          </label>
          <div className='bt-connector-form-row'>
            <a className='bt-connector-link' href={TOKEN_URL} target='_blank' rel='noopener noreferrer'>
              {t('Create a token on GitHub')}
            </a>
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              disabled={busy}
              onClick={() => {
                setForm(false)
                setToken('')
                setError(null)
              }}>
              {t('Cancel')}
            </button>
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              disabled={busy || token.trim() === ''}
              onClick={connect}>
              {busy ? t('Connecting…') : on ? t('Save token') : t('Connect')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className='bt-connector-error' role='alert'>
          {error}
        </div>
      ) : null}
    </div>
  )
}
// Settings → Connectors: the linked connectors, the custom MCP servers, the catalog.
export function ConnectorsPage({
  roster,
  actions,
  market,
}: {
  roster?:
    | {
        connectors?: Connector[]
        capabilities?: readonly Capability[]
        bots?: readonly CapabilityBot[]
        capabilityStatuses?: Readonly<
          Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>
        >
        capabilityTools?: Readonly<Record<string, readonly string[]>>
      }
    | undefined
  actions: ConnectorActions
  market?: MarketActions | undefined
}) {
  const list = roster?.connectors ?? []
  const capabilities = roster?.capabilities ?? []
  const custom = capabilities.filter(
    item => item.kind === 'mcp' && !CONNECTOR_CATALOG.some(entry => entry.id === item.name),
  )
  const [draft, setDraft] = useState<CustomConnectorDraft | null>(null)
  const [confirming, setConfirming] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const apply = (name: string, work: Promise<unknown>, after?: () => void): void => {
    setBusy(name)
    setError(null)
    void work
      .then(
        () => {
          after?.()
        },
        failure => setError(failure?.message ?? String(failure)),
      )
      .finally(() => setBusy(''))
  }
  const remove = (item: Capability): void => {
    if (confirming !== item.name) {
      setConfirming(item.name)
      return
    }
    apply(item.name, actions.deleteCapability(item.name), () => {
      setConfirming('')
      if (draft?.originalName === item.name) setDraft(null)
    })
  }
  const closeForm = (): void => setDraft(null)
  return (
    <section className='bt-set-section'>
      {error ? (
        <div className='bt-connector-error' role='alert'>
          {error}
        </div>
      ) : null}
      <div className='bt-set-card bt-connectors-card'>
        {list.length === 0 ? (
          <div className='bt-set-row'>
            <span className='bt-set-hint'>{t('No connectors')}</span>
          </div>
        ) : (
          list.map(connector => <ConnectorRow key={connector.id} connector={connector} actions={actions} />)
        )}
      </div>
      <div className='bt-cap-head'>
        <h3>{t('Custom connectors')}</h3>
        <div className='bt-cap-head-actions'>
          {actions.openSettings === undefined ? null : (
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.openSettings?.('capabilities')}>
              {t('Installed capabilities')}
            </button>
          )}
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => setDraft(blankCustomConnector())}>
            {t('Add custom connector')}
          </button>
        </div>
      </div>
      <p className='bt-set-hint'>
        {t(
          'Any MCP server you type yourself. Market installs also appear as capabilities; this list edits them in place.',
        )}
      </p>
      {draft ? (
        <CustomConnectorForm
          key={draft.originalName ?? 'new'}
          initial={draft}
          market={actions}
          existing={capabilities}
          onClose={closeForm}
        />
      ) : null}
      {custom.length === 0 ? (
        <div className='bt-cap-empty'>
          <span className='bt-cap-empty-title'>{t('No custom connectors yet')}</span>
          <span className='bt-set-hint'>{t('Add any MCP server by command, HTTP URL, or SSE endpoint.')}</span>
        </div>
      ) : (
        <CustomConnectorList
          items={custom}
          bots={roster?.bots ?? []}
          statuses={roster?.capabilityStatuses}
          tools={roster?.capabilityTools}
          confirming={confirming}
          busy={busy}
          onEdit={item => setDraft(draftFromConnector(item))}
          onDelete={remove}
          onCancelDelete={() => setConfirming('')}
          onRetry={item => apply(item.name, actions.retryCapability(item.name))}
          onTurnOff={(item, using) =>
            apply(item.name, Promise.all(using.map(bot => actions.setBotCapability(bot.id, item.name, false))))
          }
        />
      )}
      {market !== undefined ? (
        <ConnectorCatalog
          market={market}
          capabilities={capabilities}
          onCustom={() => setDraft(blankCustomConnector())}
        />
      ) : null}
    </section>
  )
}

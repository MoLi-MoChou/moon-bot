import { createElement as h } from 'react'
import { t } from './i18n.ts'
import { PlusIcon } from './icons.tsx'
import { DefaultConnectorLogo } from './connector-logos.tsx'
import { healthOf, toolsOf } from './capability-library.ts'
import type { Capability, CapabilityBot, CapabilityStatus } from './capability-types.ts'

export function CustomConnectorList({
  items,
  bots,
  statuses,
  tools,
  confirming,
  busy,
  onEdit,
  onDelete,
  onCancelDelete,
  onRetry,
  onTurnOff,
}: {
  items: readonly Capability[]
  bots: readonly CapabilityBot[]
  statuses: Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>> | undefined
  tools: Readonly<Record<string, readonly string[]>> | undefined
  confirming: string
  busy: string
  onEdit: (item: Capability) => void
  onDelete: (item: Capability) => void
  onCancelDelete: () => void
  onRetry: (item: Capability) => void
  onTurnOff: (item: Capability, using: readonly CapabilityBot[]) => void
}) {
  return (
    <div className='bt-set-card bt-connectors-card'>
      {items.map(item => {
        const health = healthOf(item, bots, statuses)
        const names = toolsOf(item, tools)
        const label =
          health.state === 'error'
            ? t('Failed')
            : health.state === 'ready'
              ? t('Connected')
              : health.state === 'connecting'
                ? t('Connecting…')
                : health.state === 'enabled'
                  ? t('Enabled')
                  : t('Not enabled')
        const detail =
          health.state === 'error'
            ? t('Last attempt failed: {error}', { error: health.error ?? '' })
            : health.state === 'ready'
              ? t('Connected for {name} · {count} tools', { name: health.botName ?? '', count: names.length })
              : health.state === 'enabled'
                ? t('Enabled; it connects on the Bot’s next turn.')
                : health.state === 'off'
                  ? t('Not enabled for any Bot.')
                  : t('Connecting to the server…')
        return (
          <div key={item.name} className='bt-cap-row' data-state={health.state}>
            <div className='bt-cap-summary bt-custom-summary'>
              <span className='bt-connector-mark'>
                <DefaultConnectorLogo size={22} />
              </span>
              <span className='bt-connector-text'>
                <span className='bt-connector-name'>{item.name}</span>
                <span className='bt-connector-status'>{item.description || detail}</span>
              </span>
              <span className='bt-cap-chips'>
                <span
                  className='bt-cap-chip'
                  data-tone={health.state === 'error' ? 'error' : health.state === 'ready' ? 'ready' : 'quiet'}>
                  {label}
                </span>
                <span className='bt-cap-chip'>
                  {item.transport === 'stdio' ? t('Local') : item.transport === 'sse' ? t('SSE') : t('Cloud')}
                </span>
              </span>
            </div>
            {health.state === 'error' ? (
              <div className='bt-cap-notice' data-tone='error' role='alert'>
                <span>{detail}</span>
              </div>
            ) : (
              <div className='bt-set-hint bt-custom-detail'>{detail}</div>
            )}
            {confirming === item.name ? (
              <div className='bt-cap-confirm' role='alert'>
                <span className='bt-cap-confirm-copy'>
                  {t(
                    'Delete {name}? It is removed from {count} Bots, its tools stop working, and saved keys stay. This cannot be undone.',
                    { name: item.name, count: health.using.length },
                  )}
                </span>
                <div className='bt-connector-form-row'>
                  <button
                    type='button'
                    className='bt-soft bt-soft-sm'
                    disabled={busy === item.name}
                    onClick={onCancelDelete}>
                    {t('Cancel')}
                  </button>
                  <button
                    type='button'
                    className='bt-soft bt-soft-sm bt-danger-soft'
                    disabled={busy === item.name}
                    onClick={() => onDelete(item)}>
                    {busy === item.name ? t('Deleting…') : t('Delete')}
                  </button>
                </div>
              </div>
            ) : (
              <div className='bt-connector-form-row bt-cap-actions'>
                <button type='button' className='bt-soft bt-soft-sm' onClick={() => onEdit(item)}>
                  {t('Edit')}
                </button>
                {health.state === 'error' ? (
                  <button
                    type='button'
                    className='bt-soft bt-soft-sm'
                    disabled={busy === item.name}
                    onClick={() => onRetry(item)}>
                    {busy === item.name ? t('Retrying…') : t('Try again')}
                  </button>
                ) : null}
                {health.using.length > 0 ? (
                  <button
                    type='button'
                    className='bt-soft bt-soft-sm'
                    disabled={busy === item.name}
                    onClick={() => onTurnOff(item, health.using)}>
                    {t('Turn off for all Bots')}
                  </button>
                ) : null}
                <button
                  type='button'
                  className='bt-soft bt-soft-sm bt-danger-soft'
                  disabled={busy === item.name}
                  onClick={() => onDelete(item)}>
                  {t('Delete')}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function AddCustomConnector({ onAdd }: { onAdd: () => void }) {
  return (
    <button type='button' className='bt-soft bt-soft-sm bt-market-custom-btn' onClick={onAdd}>
      <PlusIcon />
      <span>{t('Custom MCP')}</span>
    </button>
  )
}

// The connections a Bot may use, listed on the library page for access only. A connection is
// configured on the Connectors page — address, credentials, protocol, health — so this block
// shows who uses it and links to where it is actually changed. Keeping it out of
// `capability-settings.tsx` leaves that page to the items it owns: skills and packs.
import { createElement as h } from 'react'
import { t } from './i18n.ts'
import { healthOf } from './capability-library.ts'
import type { Capability, CapabilityBot, CapabilityStatus } from './capability-types.ts'

export interface CapabilityConnectionsProps {
  readonly connections: readonly Capability[]
  readonly bots: readonly CapabilityBot[]
  readonly statuses?:
    | Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>>
    | undefined
  readonly openConnectors: () => void
}

export function CapabilityConnections({ connections, bots, statuses, openConnectors }: CapabilityConnectionsProps) {
  if (connections.length === 0) return null
  return (
    <div className='bt-cap-group'>
      <div className='bt-cap-group-head'>
        <span>{t('Connections')}</span>
        <span className='bt-cap-count'>{connections.length}</span>
      </div>
      <p className='bt-set-hint'>
        {t('Configured on the Connectors page. Turning one on for a Bot happens in that Bot’s settings.')}
      </p>
      <div className='bt-set-card bt-connectors-card'>
        {connections.map(item => {
          const health = healthOf(item, bots, statuses)
          return (
            <div key={item.name} className='bt-cap-row' data-state={health.state}>
              <div className='bt-connector-head'>
                <span className='bt-connector-text'>
                  <span className='bt-connector-name'>{item.name}</span>
                  <span className='bt-connector-status'>{item.description || t('MCP server')}</span>
                </span>
                <span className='bt-cap-chips'>
                  {health.using.length === 0 ? (
                    <span className='bt-cap-chip' data-tone='quiet'>
                      {t('Not enabled')}
                    </span>
                  ) : (
                    <span className='bt-cap-chip' data-tone={health.state === 'error' ? 'error' : 'ready'}>
                      {health.using.length === 1
                        ? t('Used by 1 Bot')
                        : t('Used by {count} Bots', { count: health.using.length })}
                    </span>
                  )}
                </span>
                <span className='bt-connector-actions'>
                  <button type='button' className='bt-soft bt-soft-sm' onClick={openConnectors}>
                    {t('Open in Connectors')}
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

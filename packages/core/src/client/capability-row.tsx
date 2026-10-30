// One capability in the library: a summary row that opens into what the item does, the
// keys it needs, the tools it serves and the connection each Bot has, then its actions.
import { createElement as h } from 'react'
import { ChevronRightIcon } from './icons.tsx'
import { t } from './i18n.ts'
import { kindOf, sourceOf } from './capability-library.ts'
import type { Capability, CapabilityHealth, KeyReadiness } from './capability-types.ts'

const KIND_LABEL: Record<string, () => string> = {
  mcp: () => t('MCP server'),
  skill: () => t('Skill'),
  pack: () => t('Pack'),
}

function chipText(health: CapabilityHealth): string {
  if (health.state === 'error') return health.botName ? t('Failed for {name}', { name: health.botName }) : t('Failed')
  if (health.state === 'needs-approval') return t('Needs approval')
  if (health.state === 'connecting') return t('Connecting…')
  if (health.state === 'ready') return health.botName ? t('Ready for {name}', { name: health.botName }) : t('Ready')
  if (health.state === 'enabled') return t('Enabled')
  return t('Not enabled')
}

function connectionText(item: Capability): string {
  if (kindOf(item) === 'skill') return t('Instructions for the Bot')
  if (kindOf(item) === 'pack') return t('{count} members', { count: item.items?.length ?? 0 })
  const transport =
    item.transport === 'sse' ? t('SSE endpoint') : item.transport === 'stdio' ? t('Local command') : t('HTTP server')
  return item.command ? `${transport} · ${item.command}` : item.url ? `${transport} · ${item.url}` : transport
}

function KeyLine({ keys }: { keys: KeyReadiness }) {
  if (keys.total === 0) return null
  if (keys.missing.length === 0)
    return (
      <span className='bt-cap-chip' data-tone='ready'>
        {t('{count} keys ready', { count: keys.total })}
      </span>
    )
  return (
    <span className='bt-cap-chip' data-tone='warn'>
      {t('Missing {names}', { names: keys.missing.join(', ') })}
    </span>
  )
}

function ToolList({ item, tools }: { item: Capability; tools: readonly string[] }) {
  if (kindOf(item) === 'skill') return <span className='bt-set-hint'>{t('A skill adds instructions, not tools.')}</span>
  if (tools.length === 0)
    return <span className='bt-set-hint'>{t('No tools yet. Turn it on for a Bot to connect it.')}</span>
  return (
    <ul className='bt-cap-tools'>
      {tools.slice(0, 8).map(name => (
        <li key={name}>
          <code>{name}</code>
        </li>
      ))}
      {tools.length > 8 ? <li>{t('+{count} more', { count: tools.length - 8 })}</li> : null}
    </ul>
  )
}

export function CapabilityRow({
  item,
  health,
  keys,
  tools,
  expanded,
  confirming,
  busy,
  onExpand,
  onEdit,
  onDelete,
  onCancelDelete,
  onApprove,
  onRetry,
  onOpenSecrets,
  onOpenBots,
}: {
  item: Capability
  health: CapabilityHealth
  keys: KeyReadiness
  tools: readonly string[]
  expanded: boolean
  confirming: boolean
  busy: boolean
  onExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onApprove: () => void
  onRetry: () => void
  onOpenSecrets: () => void
  onOpenBots: () => void
}) {
  const source = sourceOf(item)
  const tab = `${item.name}:${expanded}`
  return (
    <div className='bt-cap-row' data-state={health.state} data-tab={tab}>
      <button type='button' className='bt-cap-summary' aria-expanded={expanded} onClick={onExpand}>
        <span className='bt-chevron' data-open={expanded}>
          <ChevronRightIcon />
        </span>
        <span className='bt-connector-text'>
          <span className='bt-connector-name'>{item.name}</span>
          <span className='bt-connector-status'>{item.description || connectionText(item)}</span>
        </span>
        <span className='bt-cap-chips'>
          <KeyLine keys={keys} />
          <span
            className='bt-cap-chip'
            data-tone={
              health.state === 'error'
                ? 'error'
                : health.state === 'needs-approval'
                  ? 'warn'
                  : health.state === 'ready'
                    ? 'ready'
                    : 'quiet'
            }>
            {chipText(health)}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className='bt-cap-detail'>
          <div className='bt-cap-meta'>
            <span className='bt-cap-chip'>{KIND_LABEL[kindOf(item)]?.() ?? item.kind}</span>
            <span className='bt-cap-chip' data-tone='quiet'>
              {source === 'market' ? t('Connector market') : t('Custom')}
            </span>
            <span className='bt-set-hint'>{connectionText(item)}</span>
          </div>
          <p className='bt-cap-desc'>{item.description || t('No description yet.')}</p>
          {health.state === 'error' ? (
            <div className='bt-cap-notice' data-tone='error' role='alert'>
              <span>{t('Could not connect: {error}', { error: health.error ?? '' })}</span>
              <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onRetry}>
                {t('Try again')}
              </button>
            </div>
          ) : null}
          {health.state === 'needs-approval' ||
          (item.kind === 'mcp' && item.transport === 'stdio' && item.approved !== true) ? (
            <div className='bt-cap-notice' data-tone='warn'>
              <span>{t('A local command waits for your approval before it starts.')}</span>
              <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onApprove}>
                {t('Allow')}
              </button>
            </div>
          ) : null}
          {keys.missing.length > 0 ? (
            <div className='bt-cap-notice' data-tone='warn'>
              <span>{t('This capability needs keys that are not saved yet.')}</span>
              <button type='button' className='bt-soft bt-soft-sm' onClick={onOpenSecrets}>
                {t('Open Secrets')}
              </button>
            </div>
          ) : null}
          <div className='bt-cap-section'>
            <span className='bt-cap-label'>{t('Tools it brings')}</span>
            <ToolList item={item} tools={tools} />
          </div>
          <div className='bt-cap-section'>
            <span className='bt-cap-label'>{t('Used by')}</span>
            {health.using.length === 0 ? (
              <span className='bt-set-hint'>{t('Not enabled for any Bot yet.')}</span>
            ) : (
              <span className='bt-cap-bots'>
                {health.using.map(bot => (
                  <span key={bot.id} className='bt-cap-chip'>
                    {bot.name}
                  </span>
                ))}
              </span>
            )}
            {health.using.length === 0 ? (
              <button type='button' className='bt-soft bt-soft-sm' onClick={onOpenBots}>
                {t('Choose a Bot')}
              </button>
            ) : null}
          </div>
          {confirming ? (
            <div className='bt-cap-confirm' role='alert'>
              <span className='bt-cap-confirm-copy'>
                {t(
                  'Delete {name}? Bots using it lose its tools, packs that include it drop it, and saved keys stay. This cannot be undone.',
                  { name: item.name },
                )}
              </span>
              <div className='bt-connector-form-row'>
                <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onCancelDelete}>
                  {t('Cancel')}
                </button>
                <button type='button' className='bt-soft bt-soft-sm bt-danger-soft' disabled={busy} onClick={onDelete}>
                  {busy ? t('Deleting…') : t('Delete')}
                </button>
              </div>
            </div>
          ) : null}
          {confirming ? null : (
            <div className='bt-connector-form-row bt-cap-actions'>
              <button type='button' className='bt-soft bt-soft-sm' onClick={onEdit}>
                {t('Edit')}
              </button>
              <button type='button' className='bt-soft bt-soft-sm bt-danger-soft' disabled={busy} onClick={onDelete}>
                {t('Delete')}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

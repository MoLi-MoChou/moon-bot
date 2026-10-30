import { createElement as h, useState } from 'react'
import { t } from './i18n.ts'
import { CloseIcon, PlusIcon, PlugIcon, SearchIcon } from './icons.tsx'
import { blankCapability, draftFromCapability, type CapabilityDraft } from './capability-draft.ts'
import { CapabilityForm } from './capability-form.tsx'
import { CapabilityRow } from './capability-row.tsx'
import {
  countsByKind,
  filterCapabilities,
  groupCapabilities,
  healthOf,
  keyReadiness,
  toolsOf,
  type CapabilityFilterKind,
} from './capability-library.ts'
import type { Capability, CapabilityActions, CapabilityBot, CapabilityStatus, RunWork } from './capability-types.ts'

export type { Capability, CapabilityActions, RunWork } from './capability-types.ts'
export type { CapabilityDraft } from './capability-draft.ts'

interface CapabilityRoster {
  capabilities?: readonly Capability[]
  bots?: readonly CapabilityBot[]
  secrets?: readonly { name: string }[]
  capabilityStatuses?: Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>>
  capabilityTools?: Readonly<Record<string, readonly string[]>>
}

const KIND_TABS: readonly (readonly [CapabilityFilterKind, () => string])[] = [
  ['all', () => t('All')],
  ['mcp', () => t('MCP servers')],
  ['skill', () => t('Skills')],
  ['pack', () => t('Packs')],
]
const GROUP_LABEL: Record<string, () => string> = {
  mcp: () => t('MCP servers'),
  skill: () => t('Skills'),
  pack: () => t('Packs'),
}

export function CapabilitiesPage({
  roster,
  actions,
  run,
}: {
  roster: CapabilityRoster
  actions: CapabilityActions
  run: RunWork
}) {
  const items = [...(roster.capabilities ?? [])]
  const bots = roster.bots ?? []
  const statuses = roster.capabilityStatuses
  const tools = roster.capabilityTools
  const [draft, setDraft] = useState<CapabilityDraft | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<CapabilityFilterKind>('all')
  const [expanded, setExpanded] = useState('')
  const [confirming, setConfirming] = useState('')
  const [busy, setBusy] = useState('')
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const counts = countsByKind(items)
  const shown = filterCapabilities(items, { query, kind, tools, textOf: item => t(item.description ?? '') })
  const groups = groupCapabilities(shown)
  const filtered = query.trim() !== '' || kind !== 'all'
  const openSettings = (page: string): void => {
    actions.openSettings?.(page)
  }
  const act = async (name: string, work: Promise<unknown>, after?: () => void): Promise<void> => {
    setBusy(name)
    try {
      const ok = await Promise.resolve(run(work))
      if (ok !== false && after !== undefined) after()
    } finally {
      setBusy('')
    }
  }
  const approve = async (item: Capability): Promise<void> => {
    setApproved(previous => ({ ...previous, [item.name]: true }))
    setBusy(item.name)
    try {
      const ok = await Promise.resolve(run(actions.approveCapability(item.name)))
      if (ok === false)
        setApproved(previous => {
          const next = { ...previous }
          delete next[item.name]
          return next
        })
    } finally {
      setBusy('')
    }
  }
  const remove = (item: Capability): void => {
    if (confirming !== item.name) {
      setConfirming(item.name)
      return
    }
    void act(item.name, actions.deleteCapability(item.name), () => {
      setConfirming('')
      if (draft?.originalName === item.name) setDraft(null)
    })
  }
  return (
    <section className='bt-set-section'>
      <div className='bt-cap-head'>
        <h3>{t('Shared capabilities')}</h3>
        <div className='bt-cap-head-actions'>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => openSettings('connectors')}>
            {t('Browse connector market')}
          </button>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => setDraft(blankCapability())}>
            <PlusIcon />
            {t('Add capability')}
          </button>
        </div>
      </div>
      <p className='bt-set-hint'>
        {t('Save a capability once here, then turn it on for each Bot in the Bot’s settings.')}
      </p>
      {draft ? (
        <CapabilityForm
          draft={draft}
          setDraft={setDraft}
          items={items}
          actions={actions}
          onClose={() => setDraft(null)}
        />
      ) : null}
      {items.length === 0 ? (
        <div className='bt-cap-empty'>
          <span className='bt-cap-empty-icon'>
            <PlugIcon />
          </span>
          <span className='bt-cap-empty-title'>{t('No capabilities yet')}</span>
          <span className='bt-set-hint'>
            {t('Install one from the connector market, or save an MCP server, a skill, or a pack of them yourself.')}
          </span>
          <div className='bt-connector-form-row'>
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => openSettings('connectors')}>
              {t('Browse connector market')}
            </button>
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => setDraft(blankCapability())}>
              {t('Add capability')}
            </button>
          </div>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className='bt-cap-toolbar'>
          <div className='bt-market-search'>
            <span className='bt-market-search-icon'>
              <SearchIcon />
            </span>
            <input
              type='text'
              className='bt-market-search-input'
              placeholder={t('Search capabilities…')}
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={t('Search capabilities')}
            />
            {query ? (
              <button
                type='button'
                className='bt-market-search-clear'
                onClick={() => setQuery('')}
                aria-label={t('Clear search')}>
                <CloseIcon />
              </button>
            ) : null}
          </div>
          <div className='bt-market-tabs'>
            {KIND_TABS.map(([key, text]) => (
              <button
                key={key}
                type='button'
                className={`bt-market-tab ${kind === key ? 'bt-market-tab-active' : ''}`}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}>
                {text()} ({counts[key]})
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {items.length > 0 && groups.length === 0 ? (
        <div className='bt-cap-empty'>
          <span className='bt-cap-empty-title'>{t('No capabilities match “{query}”', { query })}</span>
          <div className='bt-connector-form-row'>
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              onClick={() => {
                setQuery('')
                setKind('all')
              }}>
              {t('Clear filters')}
            </button>
          </div>
        </div>
      ) : null}
      {groups.map(group => (
        <div key={group.kind} className='bt-cap-group'>
          <div className='bt-cap-group-head'>
            <span>{GROUP_LABEL[group.kind]?.() ?? group.kind}</span>
            <span className='bt-cap-count'>{group.items.length}</span>
          </div>
          <div className='bt-set-card bt-connectors-card'>
            {group.items.map(item => (
              <CapabilityRow
                key={item.name}
                item={approved[item.name] === true ? { ...item, approved: true } : item}
                health={healthOf(item, bots, statuses)}
                keys={keyReadiness(item, roster.secrets ?? [])}
                tools={toolsOf(item, tools)}
                expanded={expanded === item.name}
                confirming={confirming === item.name}
                busy={busy === item.name}
                onExpand={() => setExpanded(expanded === item.name ? '' : item.name)}
                onEdit={() => setDraft(draftFromCapability(item))}
                onDelete={() => remove(item)}
                onCancelDelete={() => setConfirming('')}
                onApprove={() => {
                  void approve(item)
                }}
                onRetry={() => void act(item.name, actions.retryCapability?.(item.name) ?? Promise.resolve())}
                onOpenSecrets={() => openSettings('secrets')}
                onOpenBots={() => openSettings('bots')}
              />
            ))}
          </div>
        </div>
      ))}
      {filtered && shown.length > 0 ? (
        <div className='bt-set-hint'>
          {t('Showing {count} of {total}.', { count: shown.length, total: items.length })}
        </div>
      ) : null}
    </section>
  )
}

export function BotCapabilitiesCard({
  bot,
  roster,
  actions,
  run,
  Card,
  SwitchRow,
}: {
  bot: {
    id: string
    capabilities?: readonly string[]
  }
  roster: CapabilityRoster
  actions: CapabilityActions
  run: RunWork
  Card: React.ComponentType<Record<string, unknown>>
  SwitchRow: React.ComponentType<Record<string, unknown>>
}) {
  const items = [...(roster.capabilities ?? [])].sort(
    (a, b) => Number(b.kind === 'pack') - Number(a.kind === 'pack') || a.name.localeCompare(b.name),
  )
  const attached = new Set(bot.capabilities ?? [])
  const statuses = roster.capabilityStatuses?.[bot.id] ?? {}
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  if (items.length === 0) return null
  const isOn = (name: string): boolean => overrides[name] ?? attached.has(name)
  const toggle = (name: string, next: boolean): void => {
    setOverrides(previous => ({ ...previous, [name]: next }))
    setPending(previous => ({ ...previous, [name]: true }))
    const work = (async (): Promise<void> => {
      try {
        const ok = await Promise.resolve(run(actions.setBotCapability(bot.id, name, next)))
        if (ok === false) setOverrides(previous => ({ ...previous, [name]: !next }))
      } finally {
        setPending(previous => {
          const copy = { ...previous }
          delete copy[name]
          return copy
        })
      }
    })()
    void work.catch(() => {})
  }
  return h(
    Card,
    { title: t('Capabilities') },
    items.map(item => {
      const on = isOn(item.name)
      const status = statuses[item.name]
      const hint =
        pending[item.name] === true
          ? t('Saving…')
          : !on
            ? t('Off')
            : status === undefined
              ? t('On. Connects on its next turn.')
              : status.state === 'ready'
                ? t('Ready')
                : status.state === 'error'
                  ? t('Could not connect: {error}', { error: status.error ?? '' })
                  : status.state === 'needs-approval'
                    ? t('Needs approval. Open Capabilities to allow it.')
                    : t('Connecting…')
      return h(SwitchRow, {
        key: item.name,
        label: item.name,
        hint,
        disabled: pending[item.name] === true,
        on,
        onChange: (enabled: boolean) => {
          if (pending[item.name] !== true) toggle(item.name, enabled)
        },
      })
    }),
  )
}

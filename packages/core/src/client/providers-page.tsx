/** The Models page: providers the host serves, with API keys and models. */
import { createElement as h, useEffect, useState } from 'react'
import { t } from './i18n.ts'
import type { Apply, ProvidersActions, ProvidersView, RunWork } from './providers-types.ts'
import { translated } from './providers-types.ts'
import { ProviderRow } from './providers-row.tsx'
import { AddProvider } from './providers-add.tsx'

export function ProvidersPage({
  actions,
  run,
  Section,
}: {
  actions: ProvidersActions
  run: RunWork
  Section: React.ComponentType<Record<string, unknown>>
}) {
  const [view, setView] = useState<ProvidersView | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // Resolves true when the host took it; the page then shows the host's new view.
  const apply: Apply = promise =>
    run(
      translated(promise).then(next => {
        if ((next as ProvidersView | undefined)?.providers) setView(next as ProvidersView)
      }),
    )
  useEffect(() => {
    void apply(actions.providers())
  }, [])
  if (view === null) return null
  if (!view.available) return <p className='bt-set-hint'>{t('Model providers cannot be set up here.')}</p>
  return [
    h(
      Section,
      { key: 'list', title: t('Model providers · {count}', { count: view.providers.length }) },
      view.providers.map(provider => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          apply={apply}
          actions={actions}
          open={open === provider.id}
          onToggle={() => setOpen(open === provider.id ? null : provider.id)}
        />
      )),
      adding ? (
        <AddProvider key='add' view={view} apply={apply} actions={actions} onDone={() => setAdding(false)} />
      ) : null,
    ),
    adding ? null : (
      <div key='add' className='bt-actions'>
        <button type='button' className='bt-soft bt-soft-sm' onClick={() => setAdding(true)}>
          {t('Add a provider')}
        </button>
      </div>
    ),
  ]
}

export type { Provider, ProvidersView, ProvidersActions, RunWork } from './providers-types.ts'
export { PROVIDERS_CSS } from './providers-css.ts'

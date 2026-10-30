import { createElement as h, useEffect, useState } from 'react'
import { CheckIcon, TrashIcon } from './icons.tsx'
import { KeyIcon, MaskedInput } from './secret-card.tsx'
import { t } from './i18n.ts'
import type { Apply, Provider, ProvidersActions } from './providers-types.ts'
import { SHOWN_MODELS } from './providers-types.ts'

function keyState(key: Provider['key']): [string, string] | null {
  if (key === null) return null
  if (!key.configured) return ['missing', t('Needs an API key')]
  return key.writable ? ['set', t('Key set')] : ['outside', t('Key set outside Moon Bot')]
}
export function ProviderRow({
  provider,
  apply,
  actions,
  open,
  onToggle,
}: {
  provider: Provider
  apply: Apply
  actions: ProvidersActions
  open: boolean
  onToggle: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!open) setConfirm(false)
  }, [open])
  const state = keyState(provider.key)
  const shown = provider.models.slice(0, SHOWN_MODELS)
  const hint =
    provider.error ??
    (provider.models.length === 0 ? t('No models') : t('{count} models', { count: provider.models.length }))
  return (
    <div className='bt-secret-item bt-provider' data-open={open ? '' : undefined}>
      <button type='button' className='bt-set-row bt-secret-summary' aria-expanded={open} onClick={onToggle}>
        <span className='bt-set-copy'>
          <span className='bt-secret-title'>
            {provider.name}
            {provider.name !== provider.id ? <span className='bt-provider-id'>{provider.id}</span> : null}
          </span>
          <span className='bt-set-hint' data-error={provider.error ? '' : undefined}>
            {hint}
          </span>
        </span>
        {state ? (
          <span className='bt-set-control'>
            <span className='bt-provider-state' data-state={state[0]}>
              {state[1]}
            </span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div className='bt-secret-edit'>
          {provider.key?.writable ? <KeyEditor provider={provider} apply={apply} actions={actions} /> : null}
          {provider.key && !provider.key.writable ? (
            <div className='bt-set-hint'>
              {t('This key comes from outside Moon Bot, such as an environment variable, and cannot be changed here.')}
            </div>
          ) : null}
          {provider.models.length > 0 ? (
            <div className='bt-secret-edit-block'>
              <div className='bt-secret-edit-label'>{t('Models')}</div>
              <div className='bt-provider-models'>
                {shown.map(model => (
                  <span key={model.ref} className='bt-tag' title={model.ref}>
                    {model.name}
                  </span>
                ))}
                {provider.models.length > shown.length ? (
                  <span className='bt-set-hint'>
                    {t('and {count} more', { count: provider.models.length - shown.length })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {provider.removable ? (
            <div className='bt-secret-row-actions'>
              {confirm ? (
                [
                  <span key='q' className='bt-set-hint'>
                    {t('Remove {name}? Bots on its models need another model.', { name: provider.name })}
                  </span>,
                  <button key='no' type='button' className='bt-soft bt-soft-sm' onClick={() => setConfirm(false)}>
                    {t('Keep')}
                  </button>,
                  <button
                    key='yes'
                    type='button'
                    className='bt-soft bt-soft-sm bt-secret-danger'
                    onClick={() => apply(actions.removeProvider(provider.id))}>
                    {t('Remove')}
                  </button>,
                ]
              ) : (
                <button type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => setConfirm(true)}>
                  <TrashIcon />
                  {t('Remove provider')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
function KeyEditor({ provider, apply, actions }: { provider: Provider; apply: Apply; actions: ProvidersActions }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const ready = value.trim() !== ''
  const save = () => {
    if (!ready) return
    void apply(actions.setProviderKey(provider.id, value)).then(ok => {
      if (ok) {
        setValue('')
        setSaved(true)
      }
    })
  }
  const edit = (next: string) => {
    setValue(next)
    setSaved(false)
  }
  const label = t('{provider} API key', { provider: provider.name })
  return (
    <div className='bt-secret-edit-block'>
      <div className='bt-secret-edit-label'>{provider.key?.configured ? t('Replace the API key') : t('API key')}</div>
      <div className='bt-secret-inline'>
        <label className='bt-q-field bt-secret-field'>
          <KeyIcon />
          <MaskedInput value={value} onChange={edit} onEnter={save} label={label} />
        </label>
        <button type='button' className='bt-soft bt-soft-sm' disabled={!ready} onClick={save}>
          {t('Save')}
        </button>
        {provider.key?.configured ? (
          <button
            type='button'
            className='bt-soft bt-soft-sm bt-secret-danger'
            onClick={() => void apply(actions.setProviderKey(provider.id, null))}>
            {t('Remove key')}
          </button>
        ) : null}
      </div>
      {saved ? (
        <div className='bt-set-hint bt-secret-ok' role='status'>
          <CheckIcon />
          {t('Saved.')}
        </div>
      ) : null}
    </div>
  )
}

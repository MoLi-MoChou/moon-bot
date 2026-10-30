import { createElement as h, useState } from 'react'
import { CheckIcon } from './icons.tsx'
import { KeyIcon, MaskedInput } from './secret-card.tsx'
import { Segmented } from './motion.tsx'
import { t } from './i18n.ts'
import type { Apply, ProvidersActions, ProvidersView } from './providers-types.ts'
import { ENDPOINT_HINTS, PROTOCOL_NAMES } from './providers-types.ts'

export function AddProvider({
  view,
  apply,
  actions,
  onDone,
}: {
  view: ProvidersView
  apply: Apply
  actions: ProvidersActions
  onDone: () => void
}) {
  const [mode, setMode] = useState(view.addable.length > 0 ? 'known' : 'custom')
  return (
    <div className='bt-set-row bt-set-paste bt-provider-add'>
      <Segmented label={t('Kind of provider')} value={mode}>
        {(
          [
            ['known', t('Known provider')],
            ['custom', t('Custom API')],
          ] as [string, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type='button'
            aria-pressed={mode === id}
            disabled={id === 'known' && view.addable.length === 0}
            onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </Segmented>
      <div hidden={mode !== 'known'}>
        <KnownForm view={view} apply={apply} actions={actions} onDone={onDone} />
      </div>
      <div hidden={mode !== 'custom'}>
        <CustomForm view={view} apply={apply} actions={actions} onDone={onDone} />
      </div>
    </div>
  )
}
function KnownForm({
  view,
  apply,
  actions,
  onDone,
}: {
  view: ProvidersView
  apply: Apply
  actions: ProvidersActions
  onDone: () => void
}) {
  const [provider, setProvider] = useState('')
  const [key, setKey] = useState('')
  const options = [...view.addable].sort((a, b) => a.name.localeCompare(b.name))
  const add = () => {
    if (provider === '') return
    void apply(actions.addProvider({ provider, key })).then(ok => {
      if (ok) onDone()
    })
  }
  return (
    <div className='bt-provider-form'>
      <select
        className='bt-select'
        aria-label={t('Provider')}
        value={provider}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setProvider(event.target.value)}>
        <option value='' disabled>
          {t('Choose a provider')}
        </option>
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <label className='bt-q-field bt-secret-field'>
        <KeyIcon />
        <MaskedInput value={key} onChange={setKey} onEnter={add} label={t('API key')} />
      </label>
      <FormActions onCancel={onDone} onAdd={add} ready={provider !== ''} />
    </div>
  )
}
function CustomForm({
  view,
  apply,
  actions,
  onDone,
}: {
  view: ProvidersView
  apply: Apply
  actions: ProvidersActions
  onDone: () => void
}) {
  const [draft, setDraft] = useState({
    provider: '',
    name: '',
    baseURL: '',
    api: view.protocols[0] ?? '',
    key: '',
    typed: '',
  })
  const [found, setFound] = useState<
    | readonly {
        id: string
        name?: string
      }[]
    | null
  >(null)
  const [picked, setPicked] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const set = (field: keyof typeof draft, value: string) =>
    setDraft(current => ({
      ...current,
      [field]: field === 'baseURL' ? value.trim().replace(/\/chat\/completions\/?$/i, '') : value,
    }))
  const typed = draft.typed
    .split(/[\s,]+/)
    .map(id => id.trim())
    .filter(Boolean)
  const models = [
    ...(found ?? []).filter(model => picked.includes(model.id)),
    ...typed.filter(id => !picked.includes(id)).map(id => ({ id })),
  ]
  const ready = draft.provider.trim() !== '' && draft.baseURL.trim() !== '' && models.length > 0
  const fetchModels = () => {
    setAsking(true)
    void apply(
      Promise.resolve(actions.providerModels({ baseURL: draft.baseURL, api: draft.api, key: draft.key })).then(list => {
        setFound(list)
        setPicked([])
      }),
    ).finally(() => setAsking(false))
  }
  const toggle = (id: string) =>
    setPicked(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]))
  const add = () => {
    if (!ready) return
    void apply(
      actions.addProvider({
        custom: true,
        provider: draft.provider.trim(),
        name: draft.name,
        baseURL: draft.baseURL,
        api: draft.api,
        key: draft.key,
        models,
      }),
    ).then(ok => {
      if (ok) onDone()
    })
  }
  const input = (field: keyof typeof draft, label: string, placeholder: string) => (
    <input
      className='bt-input'
      aria-label={label}
      placeholder={placeholder}
      value={draft[field]}
      spellCheck={false}
      autoComplete='off'
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(field, event.target.value)}
    />
  )
  return (
    <div className='bt-provider-form'>
      <div className='bt-provider-pair'>
        {input('provider', t('Provider ID'), t('Provider ID, e.g. my-gateway'))}
        {input('name', t('Name'), t('Name (optional)'))}
      </div>
      <div className='bt-provider-pair'>
        {input('baseURL', t('Endpoint'), ENDPOINT_HINTS[draft.api] ?? 'https://gateway.example/v1')}
        <select
          className='bt-select'
          aria-label={t('Protocol')}
          value={draft.api}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => set('api', event.target.value)}>
          {view.protocols.map(api => (
            <option key={api} value={api}>
              {PROTOCOL_NAMES[api] ?? api}
            </option>
          ))}
        </select>
      </div>
      <label className='bt-q-field bt-secret-field'>
        <KeyIcon />
        <MaskedInput value={draft.key} onChange={(value: string) => set('key', value)} label={t('API key')} />
      </label>
      <div className='bt-secret-edit-block'>
        <div className='bt-provider-models-head'>
          <span className='bt-secret-edit-label'>{t('Models')}</span>
          <button
            type='button'
            className='bt-soft bt-soft-sm'
            disabled={asking || draft.baseURL.trim() === ''}
            onClick={fetchModels}>
            {asking ? t('Asking…') : t('Fetch models')}
          </button>
        </div>
        {found !== null && found.length === 0 ? (
          <div className='bt-set-hint'>{t('The endpoint lists no models. Enter their ids below.')}</div>
        ) : null}
        {found !== null && found.length > 0 ? (
          <div className='bt-secret-bots bt-provider-found'>
            {found.map(model => (
              <button
                key={model.id}
                type='button'
                className='bt-secret-bot'
                aria-pressed={picked.includes(model.id)}
                title={model.name && model.name !== model.id ? model.name : undefined}
                onClick={() => toggle(model.id)}>
                <code>{model.id}</code>
                {picked.includes(model.id) ? <CheckIcon /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {input('typed', t('Model ids'), t('Model ids, separated by commas'))}
      </div>
      <FormActions onCancel={onDone} onAdd={add} ready={ready} />
    </div>
  )
}
function FormActions({ onCancel, onAdd, ready }: { onCancel: () => void; onAdd: () => void; ready: boolean }) {
  return (
    <div className='bt-secret-row-actions'>
      <button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>
        {t('Cancel')}
      </button>
      <button type='button' className='bt-soft bt-soft-sm' disabled={!ready} onClick={onAdd}>
        {t('Add')}
      </button>
    </div>
  )
}

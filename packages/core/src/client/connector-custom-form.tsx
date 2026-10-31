import { createElement as h, Fragment, useState } from 'react'
import { t } from './i18n.ts'
import { connectorErrorText } from './connector-error.ts'
import { CheckIcon } from './icons.tsx'
import { DefaultConnectorLogo } from './connector-logos.tsx'
import { Field } from 'moon-bot-ui'
import {
  blankCustomConnector,
  commandParts,
  connectorIdOf,
  customCapabilityOf,
  customConnectorErrors,
  customTestOf,
  type CustomConnectorDraft,
  type CustomConnectorErrors,
  type CustomTransport,
} from './connector-custom.ts'
import type { Capability } from './capability-types.ts'
import type { CustomConnectorActions } from './connector-custom-actions.ts'

export function CustomConnectorForm({
  initial,
  market,
  existing,
  onClose,
}: {
  initial?: CustomConnectorDraft | undefined
  market: CustomConnectorActions
  existing: readonly Capability[]
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CustomConnectorDraft>(initial ?? blankCustomConnector())
  const [attempted, setAttempted] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [test, setTest] = useState<{ ok: boolean; text: string; tools: readonly string[]; signature: string } | null>(
    null,
  )
  const errors = customConnectorErrors(draft, existing)
  const id = connectorIdOf(draft.name)
  const set = <K extends keyof CustomConnectorDraft>(key: K, value: CustomConnectorDraft[K]): void => {
    setDraft(previous => ({ ...previous, [key]: value }))
  }
  const touch = (field: keyof CustomConnectorErrors): void => {
    setTouched(previous => (previous[field] ? previous : { ...previous, [field]: true }))
  }
  const errorOf = (field: keyof CustomConnectorErrors): string | undefined =>
    (attempted || touched[field] === true) && errors[field] !== undefined ? t(errors[field] as string) : undefined
  const ready = Object.keys(errors).length === 0
  const signature = JSON.stringify(customTestOf(draft))
  const stale = test !== null && test.signature !== signature
  const testNow = async (): Promise<void> => {
    setAttempted(true)
    if (!ready) return
    setTesting(true)
    setTest(null)
    setServerError('')
    try {
      const result = await market.testCapability(customTestOf(draft))
      setTest({
        ok: true,
        text:
          result.tools.length === 0
            ? t('Connected. The server offers no tools.')
            : t('Connected. {count} tools found.', { count: result.tools.length }),
        tools: result.tools,
        signature,
      })
    } catch (failure) {
      setTest({
        ok: false,
        text: connectorErrorText(failure),
        tools: [],
        signature,
      })
    } finally {
      setTesting(false)
    }
  }
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setAttempted(true)
    setServerError('')
    if (!ready) return
    setBusy(true)
    try {
      await market.saveCapability(customCapabilityOf(draft))
      onClose()
    } catch (failure) {
      setServerError(connectorErrorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className='bt-market-form bt-custom-form'
      onSubmit={event => {
        void submit(event)
      }}>
      <div className='bt-market-form-head'>
        <div className='bt-market-form-title-row'>
          <span className='bt-market-icon bt-market-form-icon'>
            <DefaultConnectorLogo size={28} />
          </span>
          <div className='bt-market-form-info'>
            <span className='bt-market-name'>
              {draft.originalName ? t('Edit {name}', { name: draft.originalName }) : t('Custom MCP server')}
            </span>
            <span className='bt-market-desc'>
              {draft.originalName
                ? t('Change everything except the name. The Bot reconnects on its next turn.')
                : t('Connect any community or custom MCP server by command or URL.')}
            </span>
          </div>
        </div>
      </div>
      <Field
        layout='compact'
        label={t('Name')}
        value={draft.name}
        disabled={draft.originalName !== undefined}
        onChange={value => set('name', value)}
        onBlur={() => touch('name')}
        error={errorOf('name')}
        placeholder='my-custom-tool'
        hint={
          draft.originalName === undefined && id !== '' && id !== draft.name.trim()
            ? t('Saved as {name}', { name: id })
            : undefined
        }
      />
      <label className='bt-q-field bt-secret-field'>
        <span className='bt-set-hint'>{t('Type')}</span>
        <select
          className='bt-input'
          value={draft.transport}
          onChange={event => set('transport', event.target.value as CustomTransport)}
          aria-label={t('Type')}>
          <option value='stdio'>{t('Local command (stdio)')}</option>
          <option value='streamable-http'>{t('HTTP server (streamable HTTP)')}</option>
          <option value='sse'>{t('SSE endpoint (legacy)')}</option>
        </select>
      </label>
      {draft.transport === 'stdio' ? (
        <>
          <Field
            layout='compact'
            label={t('Command')}
            value={draft.command}
            onChange={value => set('command', value)}
            onBlur={() => touch('command')}
            error={errorOf('command')}
            placeholder='npx -y any-mcp-server'
          />
          <Field
            layout='compact'
            label={t('Arguments (one per line)')}
            value={draft.argsText}
            onChange={value => set('argsText', value)}
            placeholder={t('--flag')}
          />
          <Field
            layout='compact'
            label={t('Environment (JSON)')}
            value={draft.envText}
            onChange={value => set('envText', value)}
            onBlur={() => touch('envText')}
            error={errorOf('envText')}
            multiline
          />
        </>
      ) : (
        <>
          <Field
            layout='compact'
            label={t('URL')}
            value={draft.url}
            onChange={value => set('url', value)}
            onBlur={() => touch('url')}
            error={errorOf('url')}
            placeholder={draft.transport === 'sse' ? 'https://mcp.example.com/sse' : 'https://mcp.example.com/mcp'}
          />
          <Field
            layout='compact'
            label={t('Headers (JSON)')}
            value={draft.headersText}
            onChange={value => set('headersText', value)}
            onBlur={() => touch('headersText')}
            error={errorOf('headersText')}
            multiline
          />
        </>
      )}
      <Field
        layout='compact'
        label={t('Description')}
        value={draft.description}
        onChange={value => set('description', value)}
        placeholder={t('What this tool does')}
      />
      {draft.transport === 'stdio' && draft.command.trim() !== '' ? (
        <span className='bt-set-hint'>
          {t('Runs {command}. Moon Bot asks before a local command first starts.', {
            command: commandParts(draft.command).command,
          })}
        </span>
      ) : null}
      {test !== null ? (
        <div className='bt-cap-notice' data-tone={test.ok ? 'ready' : 'error'} role='status'>
          <span>
            {test.ok ? (
              <span className='bt-cap-ok'>
                <CheckIcon />
                {test.text}
              </span>
            ) : (
              test.text
            )}
          </span>
          {test.ok && test.tools.length > 0 ? (
            <code className='bt-cap-test-tools'>
              {test.tools.slice(0, 3).join(', ')}
              {test.tools.length > 3 ? '…' : ''}
            </code>
          ) : null}
        </div>
      ) : null}
      {stale ? (
        <span className='bt-set-hint'>
          {t('The fields changed since the last test. Test again before saving if you want the result to count.')}
        </span>
      ) : null}
      {serverError ? (
        <div className='bt-connector-error' role='alert'>
          {serverError}
        </div>
      ) : null}
      <div className='bt-connector-form-row bt-custom-actions'>
        <button type='button' className='bt-soft bt-soft-sm' disabled={busy || testing} onClick={onClose}>
          {t('Cancel')}
        </button>
        <button
          type='button'
          className='bt-soft bt-soft-sm'
          disabled={busy || testing || !ready}
          onClick={() => {
            void testNow()
          }}>
          {testing ? t('Testing…') : t('Test connection')}
        </button>
        <button type='submit' className='bt-soft bt-soft-sm' disabled={busy || testing}>
          {busy ? t('Saving…') : draft.originalName ? t('Save changes') : t('Add connector')}
        </button>
      </div>
    </form>
  )
}

import { createElement as h, useId, useRef, useState } from 'react'
import { CheckIcon, CloseIcon } from './icons.tsx'
import { BotMark } from './mark.tsx'
import { t } from './i18n.ts'
import { useDockHold } from './card-hold.ts'
import type { SecretActions, SecretBot, SecretRequest, SecretRoster } from './secret-card-types.ts'
import { MIN_VALUE } from './secret-card-types.ts'
import { KeyIcon, LockIcon, WarnIcon, failureMessage, insecure, scopeLabel, MaskedInput } from './secret-card-input.tsx'

type ScopeChoice = 'all' | 'bot'
interface ScopeSwitchProps {
  value: ScopeChoice
  onChange: (value: ScopeChoice) => void
  bot: SecretBot
}
function ScopeSwitch({ value, onChange, bot }: ScopeSwitchProps) {
  const options: [ScopeChoice, string][] = [
    ['all', t('All Bots')],
    ['bot', t('Only {name}', { name: bot.name })],
  ]
  return (
    <div className='bt-secret-scope' role='radiogroup' aria-label={t('Who may use it')}>
      <span className='bt-secret-glide' data-at={value === 'all' ? 0 : 1} aria-hidden />
      {options.map(([id, text]) => (
        <button
          key={id}
          type='button'
          role='radio'
          aria-checked={value === id}
          className='bt-secret-seg'
          onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  )
}
interface SecretHeadProps {
  bot: SecretBot
  title: string
  detail?: string | undefined
  name: string
  onClose?: (() => void) | undefined
}
function SecretHead({ bot, title, detail, name, onClose }: SecretHeadProps) {
  return (
    <div className='bt-q-head bt-secret-head'>
      <span className='bt-secret-who'>
        <BotMark bot={bot} size={28} />
        <span className='bt-secret-lock'>
          <LockIcon />
        </span>
      </span>
      <div className='bt-q-text'>
        <p className='bt-q-title'>{title}</p>
        <div className='bt-q-detail'>
          <code className='bt-secret-name'>{name}</code>
          {detail ? ` · ${detail}` : ''}
        </div>
      </div>
      {onClose ? (
        <button
          type='button'
          className='bt-q-x'
          aria-label={t('Cancel the request')}
          title={t('Cancel')}
          onClick={onClose}>
          <CloseIcon />
        </button>
      ) : null}
    </div>
  )
}
export interface SecretCardProps {
  sessionId: string
  bot: SecretBot
  request: SecretRequest
  roster: SecretRoster
  actions: SecretActions
  inline?: boolean | undefined
}
export function SecretCard({ sessionId, bot, request, roster, actions, inline = false }: SecretCardProps) {
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<ScopeChoice>('all')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const hold = useDockHold(sessionId, 'secret', request.id, actions, inline)
  const noteId = useId()
  const secret = (roster.secrets ?? []).find(entry => entry.name === request.name)
  const run = (make: () => unknown): Promise<unknown> | undefined => {
    if (busyRef.current) return undefined
    hold()
    busyRef.current = true
    setBusy(true)
    setError('')
    return Promise.resolve()
      .then(make)
      .then(
        () => setValue(''),
        failure => setError(failureMessage(failure)),
      )
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  const cancel = (): Promise<unknown> | undefined => run(() => actions.secretCancel(request.id))
  const long = value.trim().length >= MIN_VALUE
  const save = (): void => {
    if (long && !busy) void run(() => actions.secretSet({ requestId: request.id, value, scope }))
  }
  const allow = (): void => {
    if (!busy) void run(() => actions.secretAllow(request.id))
  }
  const filling = request.kind === 'fill' || replacing
  const warn = insecure() ? (
    <div className='bt-secret-warn' role='note'>
      <WarnIcon />
      {t('This page is not on HTTPS: the key crosses the network unencrypted.')}
    </div>
  ) : null
  return (
    <div
      className='bt-q bt-secret'
      role='group'
      aria-describedby={noteId}
      data-kind={request.kind}
      onFocusCapture={hold}
      onPointerDownCapture={hold}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || busy) return
        event.preventDefault()
        event.stopPropagation()
        if (request.kind === 'allow' && replacing) setReplacing(false)
        else void cancel()
      }}>
      <SecretHead
        bot={bot}
        title={
          request.kind === 'allow'
            ? t('Let {bot} use {name}?', { bot: bot.name, name: request.name })
            : t('{name} needs a key', { name: bot.name })
        }
        detail={request.purpose}
        name={request.name}
        onClose={busy ? undefined : cancel}
      />
      {request.kind === 'allow' ? (
        <div className='bt-secret-saved'>
          <KeyIcon />
          {t('Saved for {scope}', { scope: scopeLabel(secret?.scope, roster) })}
        </div>
      ) : null}
      {filling ? (
        <div className='bt-secret-body'>
          <label className='bt-q-field bt-secret-field'>
            <MaskedInput
              value={value}
              onChange={next => {
                hold()
                setValue(next)
              }}
              onEnter={save}
              label={t('Value of {name}', { name: request.name })}
              autoFocus={replacing}
            />
          </label>
          {request.kind === 'fill' ? (
            <ScopeSwitch
              value={scope}
              onChange={next => {
                hold()
                setScope(next)
              }}
              bot={bot}
            />
          ) : null}
        </div>
      ) : null}
      <div className='bt-secret-note' id={noteId}>
        {t("{bot} never sees the value. It reaches {bot}'s shell as ", { bot: bot.name })}
        <code>{`$MOON_BOT_SECRET_${request.name}`}</code>.
        {filling && value !== '' && !long ? t(' At least {count} characters.', { count: MIN_VALUE }) : ''}
      </div>
      {warn}
      {error ? (
        <div className='bt-secret-error' role='alert'>
          {error}
        </div>
      ) : null}
      <div className='bt-q-foot'>
        {request.kind === 'allow' && !replacing ? (
          <button
            type='button'
            className='bt-q-btn'
            disabled={busy}
            onClick={() => {
              hold()
              setReplacing(true)
            }}>
            {t('Replace value')}
          </button>
        ) : null}
        <button type='button' className='bt-q-btn' disabled={busy} onClick={cancel}>
          {t('Cancel')}
        </button>
        {filling ? (
          <button type='button' className='bt-q-submit' disabled={!long || busy} onClick={save}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        ) : (
          <button type='button' className='bt-q-submit' disabled={busy} onClick={allow}>
            {busy ? t('Allowing…') : t('Allow')}
          </button>
        )}
      </div>
    </div>
  )
}
export function SettledSecret({
  bot,
  request,
  roster,
}: {
  bot: SecretBot
  request: SecretRequest
  roster: SecretRoster
}) {
  const canceled = request.status === 'canceled'
  const text = canceled
    ? t('{bot} asked for {name}', { bot: bot.name, name: request.name })
    : request.status === 'allowed'
      ? t('Allowed {bot} to use {name}', { bot: bot.name, name: request.name })
      : t('Saved {name}', { name: request.name })
  return (
    <div
      className='bt-q bt-q-settled bt-secret bt-secret-done'
      role='group'
      aria-label={text}
      data-status={request.status}>
      <div className='bt-q-head'>
        <span className='bt-secret-who'>
          <BotMark bot={bot} size={22} />
        </span>
        <div className='bt-q-text'>
          <p className='bt-q-title'>
            {text}
            {canceled ? null : <span className='bt-secret-scope-tag'>{` · ${scopeLabel(request.scope, roster)}`}</span>}
          </p>
        </div>
        {canceled ? (
          <span className='bt-q-badge'>{t('Canceled')}</span>
        ) : (
          <span className='bt-q-check bt-secret-check' title={t('Done')}>
            <CheckIcon />
          </span>
        )}
      </div>
    </div>
  )
}
interface RequestViewProps {
  sessionId: string
  bot: SecretBot
  request: SecretRequest
  roster: SecretRoster
  actions: SecretActions
}
export function RequestView({ sessionId, bot, request, roster, actions }: RequestViewProps) {
  return request.status === 'pending' ? (
    <SecretCard
      key={JSON.stringify([sessionId, request.id, request.kind])}
      sessionId={sessionId}
      bot={bot}
      request={request}
      roster={roster}
      actions={actions}
      inline
    />
  ) : (
    <SettledSecret bot={bot} request={request} roster={roster} />
  )
}
// What a client may pass as a call's content; only the text blocks matter here.

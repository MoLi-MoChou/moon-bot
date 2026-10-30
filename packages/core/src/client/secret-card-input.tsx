import { createElement as h } from 'react'
import { t } from './i18n.ts'
import type { SecretRoster, SecretScope } from './secret-card-types.ts'

export const KeyIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d='M7 9.5a3.5 3.5 0 1 1 0 .01z' />
    <path d='M10.4 10.6L17 10.6M14.5 10.6v2.4M16.6 10.6v1.8' />
  </svg>
)
export const LockIcon = () => (
  <svg
    width={14}
    height={14}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d='M6.5 9V7a3.5 3.5 0 0 1 7 0v2' />
    <rect x={4.5} y={9} width={11} height={8} rx={2} />
  </svg>
)
export const WarnIcon = () => (
  <svg
    width={14}
    height={14}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d='M10 3.5l7 12.5H3z' />
    <path d='M10 8.5v3.5M10 14.2h.01' />
  </svg>
)
export const failureMessage = (failure: unknown): string =>
  (
    failure as {
      message?: string
    } | null
  )?.message ?? String(failure)
// Password managers ignore a text field masked by CSS, so it never offers to save the
// key; browsers without that CSS fall back to a new-password field.
export const MASK_BY_CSS =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc')
export const insecure = (): boolean =>
  typeof location !== 'undefined' &&
  location.protocol === 'http:' &&
  !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(location.hostname)
export const scopeLabel = (scope: SecretScope | undefined, roster: SecretRoster): string => {
  if (scope === 'all') return t('All Bots')
  const names = (scope ?? []).map(id => roster.byId[id]?.name).filter((name): name is string => name !== undefined)
  return names.length === 0 ? t('No Bot') : names.join(t(' and '))
}
export interface MaskedInputProps {
  value: string
  onChange: (value: string) => void
  onEnter?: (() => void) | undefined
  label: string
  autoFocus?: boolean | undefined
}
export function MaskedInput({ value, onChange, onEnter, label, autoFocus = false }: MaskedInputProps) {
  return (
    <input
      className='bt-secret-input'
      type={MASK_BY_CSS ? 'text' : 'password'}
      data-masked={MASK_BY_CSS ? '' : undefined}
      value={value}
      autoFocus={autoFocus}
      autoComplete={MASK_BY_CSS ? 'off' : 'new-password'}
      autoCorrect='off'
      autoCapitalize='off'
      spellCheck={false}
      data-1p-ignore=''
      data-lpignore='true'
      data-bwignore=''
      data-form-type='other'
      aria-label={label}
      placeholder={t('Paste or type the key')}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        onEnter?.()
      }}
    />
  )
}

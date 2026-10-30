import { createElement as h, useRef, useState } from 'react'
import type React from 'react'
import type { ReactNode } from 'react'
import { SPRING_SHAPE, SPRING_TAP, spring } from './spring.ts'

export interface InlineTextProps {
  label: string
  value?: string | null | undefined
  placeholder?: string | undefined
  required?: boolean | undefined
  maxLength?: number | undefined
  multiline?: boolean | undefined
  onSave: (next: string) => unknown
}
export interface RowProps {
  label: ReactNode
  hint?: ReactNode
  stack?: boolean | undefined
  children?: ReactNode
}
export interface CardProps {
  title?: ReactNode
  children?: ReactNode
}
export interface SwitchProps {
  on: boolean
  label: string
  disabled?: boolean | undefined
  onChange: (on: boolean) => void
}
export interface SwitchRowProps {
  label: string
  hint?: string | undefined
  on: boolean
  disabled?: boolean | undefined
  onChange: (on: boolean) => void
}

// Settings save on blur or Enter, with no Save button; Escape puts the
// saved value back. A required field never saves empty.
export function InlineText({
  label,
  value,
  placeholder,
  required = false,
  maxLength,
  multiline = false,
  onSave,
}: InlineTextProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const reverting = useRef(false)
  const commit = (): void => {
    const next = draft?.trim()
    setDraft(null)
    if (reverting.current) {
      reverting.current = false
      return
    }
    if (next === undefined || next === (value ?? '') || (required && next === '')) return
    void onSave(next)
  }
  const shared = {
    className: multiline ? 'bt-bs-input bt-bs-area' : 'bt-bs-input',
    value: draft ?? value ?? '',
    placeholder,
    maxLength,
    required,
    'aria-label': label,
    spellCheck: false,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        reverting.current = true
        event.currentTarget.blur()
      }
      if (event.key === 'Enter' && !multiline && !event.nativeEvent.isComposing) event.currentTarget.blur()
    },
  }
  return multiline ? <textarea {...shared} /> : <input {...shared} />
}
// One labelled card row with its control on the right, or below when `stack`.
export function Row({ label, hint, stack = false, children }: RowProps) {
  return (
    <label className={stack ? 'bt-set-row bt-bs-row bt-bs-stack' : 'bt-set-row bt-bs-row'}>
      <span className='bt-set-copy'>
        <span className='bt-bs-label'>{label}</span>
        {hint ? <span className='bt-set-hint'>{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}
export function Card({ title, children }: CardProps) {
  return (
    <section className='bt-set-section'>
      {title ? <h3>{title}</h3> : null}
      <div className='bt-set-card'>{children}</div>
    </section>
  )
}
export function Switch({ on, label, disabled, onChange }: SwitchProps) {
  return (
    <button
      type='button'
      role='switch'
      className='bt-switch'
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}>
      <span className='bt-switch-knob' aria-hidden />
    </button>
  )
}
// A row with a switch. Not a label: a click on the copy must not flip it twice.
export function SwitchRow({ label, hint, on, disabled, onChange }: SwitchRowProps) {
  return (
    <div className='bt-set-row bt-bs-row'>
      <span className='bt-set-copy'>
        <span className='bt-bs-label'>{label}</span>
        {hint ? <span className='bt-set-hint'>{hint}</span> : null}
      </span>
      <Switch on={on} label={label} disabled={disabled} onChange={onChange} />
    </div>
  )
}

// Chrome styles for Row/Card/Switch/InlineText. Card/row shells also live in design/panels;
// these cover the Bot-settings chrome density and the switch control.
export const SETTINGS_CHROME_CSS = `
.bt-bs-row{min-height:48px}
label.bt-bs-row{cursor:text}
.bt-bs-row>.bt-set-copy{flex:1 1 auto;min-width:68px}
.bt-bs-label{font-size:13px;line-height:18px;font-weight:500;white-space:nowrap}
.bt-bs-input{flex:0 1 180px;width:0;min-width:80px;max-width:56%;height:30px;box-sizing:border-box;margin:-4px -6px -4px 0;padding:0 8px;border:1px solid transparent;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;text-align:right;outline:none;transition:background-color .12s ease,border-color .12s ease}
.bt-bs-input:hover{background:var(--bt-hover)}
.bt-bs-input:focus{background:var(--bt-main);border-color:var(--bt-line-2);text-align:left}
.bt-bs-input::placeholder{color:var(--bt-ink-3)}
.bt-bs-stack{flex-direction:column;align-items:stretch;gap:8px}
.bt-bs-area{flex:none;width:auto;min-height:112px;height:auto;margin:0 -6px -4px;padding:8px;line-height:19px;text-align:left;resize:vertical;background:var(--bt-hover)}
.bt-bs-area:hover{background:var(--bt-active)}
.bt-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--bt-line-2);cursor:pointer;transition:background-color .2s ease}
.bt-switch[aria-checked=true]{background:var(--bt-accent)}
.bt-switch:disabled{opacity:.45;cursor:default}
.bt-switch:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:${spring(SPRING_SHAPE, 'transform')},${spring(SPRING_TAP, 'width')}}
.bt-switch[aria-checked=true] .bt-switch-knob{transform:translateX(16px)}
.bt-switch:active:not(:disabled) .bt-switch-knob{width:21px}
.bt-switch[aria-checked=true]:active:not(:disabled) .bt-switch-knob{transform:translateX(11px)}
@media (prefers-reduced-motion:reduce){.bt-switch,.bt-switch-knob{transition:none}}
`

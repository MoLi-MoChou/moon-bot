import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import type { ThemeDefinition, ThemeMode } from './themes.ts'
import { t } from './i18n.ts'

export const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

interface SetSectionProps {
  title?: string | undefined
  className?: string | undefined
  children?: ReactNode | undefined
}

export function SetSection({ title, className = '', children }: SetSectionProps) {
  return (
    <section className={`bt-set-section ${className}`.trim()}>
      <h3>{title}</h3>
      <div className='bt-set-card'>{children}</div>
    </section>
  )
}

interface SetRowProps {
  label?: string | undefined
  hint?: string | undefined
  children?: ReactNode | undefined
}

export function SetRow({ label, hint, children }: SetRowProps) {
  return (
    <div className='bt-set-row'>
      <div className='bt-set-copy'>
        <span>{label}</span>
        {hint ? <span className='bt-set-hint'>{hint}</span> : null}
      </div>
      {children ? <div className='bt-set-control'>{children}</div> : null}
    </div>
  )
}

interface ThemePickerProps {
  themes: Record<string, ThemeDefinition>
  current: string
  onPick: (id: string) => unknown
}

/** Theme cards: light/dark surfaces side by side with accent + user bubble. */
export function ThemePicker({ themes, current, onPick }: ThemePickerProps) {
  const half = (mode: ThemeMode, side: string) => (
    <span className='bt-theme-half' data-side={side} style={{ background: mode.bg }}>
      <span className='bt-theme-side' style={{ background: mode.sidebar }} />
      <span className='bt-theme-lines'>
        <span style={{ background: mode.bubble }} />
        <span className='bt-theme-user' style={{ background: mode.user }} />
        <span className='bt-theme-dot' style={{ background: mode.accent }} />
      </span>
    </span>
  )
  return (
    <div className='bt-theme-pick' role='radiogroup' aria-label={t('Theme')}>
      {Object.entries(themes).map(([id, theme]) => (
        <button
          key={id}
          type='button'
          role='radio'
          aria-checked={id === current}
          className='bt-theme-card'
          onClick={() => onPick(id)}>
          <span className='bt-theme-preview' aria-hidden>
            {half(theme.light, 'light')}
            {half(theme.dark, 'dark')}
          </span>
          <span className='bt-theme-name'>{t(theme.label ?? '')}</span>
        </button>
      ))}
    </div>
  )
}

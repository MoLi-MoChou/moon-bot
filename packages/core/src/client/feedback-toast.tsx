import { createElement as h, useEffect, useState } from 'react'
import { CloseIcon } from './icons.tsx'
import { t } from './i18n.ts'

const TOAST_MS = 6000
interface ToastSource {
  readonly token: string
  readonly text: string
}
interface ToastActions {
  dismissToast(token: string): void
  openSettings(page: string): void
}
interface UiState {
  readonly toast?: ToastSource | null
}
interface ErrorToastProps {
  readonly useUi: <T>(select: (state: UiState) => T) => T
  readonly actions: ToastActions
}
// One failure at a time, bottom center; a newer one replaces it.
export function ErrorToast({ useUi, actions }: ErrorToastProps) {
  const toast = useUi(state => state.toast)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!toast) return undefined
    setLeaving(false)
    const fade = setTimeout(() => setLeaving(true), TOAST_MS)
    const gone = setTimeout(() => actions.dismissToast(toast.token), TOAST_MS + 200)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [toast?.token])
  if (!toast) return null
  return (
    <div className='bt-toast' role='alert' data-leaving={leaving || undefined}>
      <span className='bt-toast-text'>{toast.text}</span>
      <button
        type='button'
        className='bt-toast-link'
        onClick={() => {
          actions.dismissToast(toast.token)
          actions.openSettings('feedback')
        }}>
        {t('Details')}
      </button>
      <button
        type='button'
        className='bt-icon-btn bt-toast-close'
        aria-label={t('Dismiss')}
        onClick={() => actions.dismissToast(toast.token)}>
        <CloseIcon />
      </button>
    </div>
  )
}

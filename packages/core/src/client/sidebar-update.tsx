import { Fragment, createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloudDownloadIcon } from './icons.tsx'
import { hostText, t } from './i18n.ts'
import type { TSidebarActions, TSidebarHook, TSidebarUpdate } from './sidebar-types.js'

export function UpdateButton({
  useUpdate,
  actions,
}: {
  readonly useUpdate: TSidebarHook<TSidebarUpdate | null>
  readonly actions: Pick<TSidebarActions, 'installUpdate' | 'openAppUpdates'>
}) {
  const update = useUpdate(value => value)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{
    left: number
    top: number
  } | null>(null)
  const [error, setError] = useState('')
  const button = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        (event.target.closest('.bt-update-pop') || button.current?.contains(event.target))
      )
        return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  // Nothing to say without an update state at all: the button stays out of the sidebar.
  if (update === null) return null
  const phase = update.phase ?? 'idle'
  if (update.source === 'web') return null
  if (!update.available && phase === 'idle') return null
  const cloudPhase = phase
  const toggle = (): void => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) setBox({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.bottom + 6 })
    setOpen(value => !value)
  }
  const start = (): void => {
    setError('')
    void actions.installUpdate().catch(
      (
        failure:
          | {
              readonly message?: string
            }
          | null
          | undefined,
      ) => setError(hostText(failure?.message ?? String(failure))),
    )
  }
  const label =
    phase === 'installing'
      ? t('Updating Moon Bot…')
      : phase === 'installed'
        ? t('Moon Bot {version} is installed. Restart to use it.', { version: update.installed ?? update.latest })
        : update?.available
          ? t('Moon Bot {version} is available', { version: update.latest })
          : t('Moon Bot is up to date')
  const message = error || (phase === 'failed' ? update.error : '')
  return (
    <>
      <button
        ref={button}
        type='button'
        className='bt-round bt-update'
        data-phase={cloudPhase}
        aria-label={label}
        title={label}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={toggle}>
        <CloudDownloadIcon done={phase === 'installed'} />
        {phase === 'failed' ? <span className='bt-update-dot' aria-hidden /> : null}
      </button>
      {open && box
        ? createPortal(
            <div className='bt-update-pop' role='dialog' aria-label={t('Moon Bot update')} style={box}>
              <div className='bt-update-title'>
                {phase === 'installed' ? t('Update installed') : t('Moon Bot {version}', { version: update.latest })}
              </div>
              <div className='bt-update-text'>
                {phase === 'installed'
                  ? t('Restart to start using Moon Bot {version}.', { version: update.installed ?? update.latest })
                  : t('You have {version}.', { version: update.current })}
              </div>
              {message ? (
                <div className='bt-update-error' role='alert'>
                  {t('The update did not finish: {reason}', { reason: message })}
                </div>
              ) : null}
              <div className='bt-update-actions'>
                {update.notesUrl ? (
                  <a className='bt-update-notes' href={update.notesUrl} target='_blank' rel='noopener noreferrer'>
                    {t("What's new")}
                  </a>
                ) : null}
                {phase === 'installed' ? null : (
                  <button type='button' className='bt-update-go' disabled={phase === 'installing'} onClick={start}>
                    {phase === 'installing' ? t('Updating…') : phase === 'failed' ? t('Try again') : t('Update')}
                  </button>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
// The footer entry to the shell's plugin panel.

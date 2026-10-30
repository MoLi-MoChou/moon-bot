import { createElement as h, useEffect, useState } from 'react'
import type React from 'react'
import { whenText } from './feedback.tsx'
import { productName, t } from './i18n.ts'

export type RunWork = (work: Promise<unknown>) => Promise<boolean | undefined>
type RowLike = React.ComponentType<Record<string, unknown>>

const RELEASES_PAGE = 'https://github.com/MoLi-MoChou/moon-bot/releases'
const linkProps = (href: string): Record<string, string> => ({
  className: 'bt-soft bt-soft-sm bt-about-link',
  href,
  target: '_blank',
  rel: 'noopener noreferrer',
})

interface AppUpdateState {
  phase?: string
  version?: string
  percent?: number
  checkedAt?: number
  error?: string
  reason?: string
  current?: string
}
interface AppUpdateBridge {
  state: () => Promise<AppUpdateState | null>
  onChange: (listener: (state: AppUpdateState | null) => void) => (() => void) | undefined
  check: () => Promise<AppUpdateState | null>
  install: () => Promise<unknown>
}
interface AppEngineState {
  phase?: string
  percent?: number
  error?: string
}
interface AppEngineBridge {
  state: () => Promise<AppEngineState | null>
  onChange: (listener: (state: AppEngineState | null) => void) => (() => void) | undefined
  download: () => Promise<AppEngineState | null>
}
// The plugin's own update state, and the host's beside it.
export const appBridge = (): AppUpdateBridge | null =>
  typeof window === 'undefined' ? null : ((window.dsBotApp?.updates as AppUpdateBridge | undefined) ?? null)
export function useAppUpdate(): [
  AppUpdateBridge | null,
  AppUpdateState | null,
  React.Dispatch<React.SetStateAction<AppUpdateState | null>>,
] {
  const bridge = appBridge()
  const [state, setState] = useState<AppUpdateState | null>(null)
  useEffect(() => {
    if (!bridge) return undefined
    let live = true
    bridge.state().then(
      value => {
        if (live) setState(value)
      },
      () => {},
    )
    const off = bridge.onChange(value => {
      if (live) setState(value)
    })
    return () => {
      live = false
      off?.()
    }
  }, [bridge])
  return [bridge, state, setState]
}
function appHint(state: AppUpdateState | null): string | null {
  if (!state) return null
  switch (state.phase) {
    case 'checking':
      return t('Checking for updates…')
    case 'downloading':
      return t('Downloading {version} · {percent}%', {
        version: state.version ?? '',
        percent: Math.floor(state.percent ?? 0),
      })
    case 'downloaded':
      return t('{version} is ready. Restart to update; nothing to reinstall.', { version: state.version })
    case 'latest':
      return t('Up to date') + (state.checkedAt ? ` · ${t('Checked {time}', { time: whenText(state.checkedAt) })}` : '')
    case 'error':
      return t('Could not check for updates.') + (state.error ? ` ${state.error}` : '')
    case 'unsupported':
      return state.reason === 'portable'
        ? t(
            'The portable exe does not update itself: download the new one from the releases page and replace this file. Your data stays.',
          )
        : state.reason === 'dev'
          ? t('Updates work in the installed app.')
          : state.reason === 'package'
            ? t(
                'This package updates through its package manager; the AppImage and Windows installer update themselves.',
              )
            : t('Update checks are off.')
    default:
      return state.current ? t('Version {version}', { version: state.current }) : null
  }
}
export function AppUpdateRow({ Row, run }: { Row: RowLike; run: RunWork }) {
  const [bridge, state, setState] = useAppUpdate()
  if (!bridge) return null
  const phase = state?.phase ?? 'idle'
  const percent = state?.percent ?? 0
  const control =
    phase === 'downloaded' ? (
      <button type='button' className='bt-fb-primary' onClick={() => run(bridge.install())}>
        {t('Restart to update')}
      </button>
    ) : phase === 'downloading' ? (
      <span
        className='bt-app-progress'
        role='progressbar'
        aria-valuenow={Math.floor(percent)}
        aria-valuemin={0}
        aria-valuemax={100}>
        <span style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
      </span>
    ) : phase === 'unsupported' ? (
      state?.reason === 'portable' ? (
        <a {...linkProps(RELEASES_PAGE)}>{t('Open')}</a>
      ) : null
    ) : (
      <button
        type='button'
        className='bt-soft bt-soft-sm'
        disabled={phase === 'checking'}
        onClick={() => run(bridge.check().then(setState))}>
        {phase === 'checking' ? t('Checking…') : t('Check for updates')}
      </button>
    )
  return h(Row, { label: productName(), hint: appHint(state) }, control)
}
// Moon Bot patch: the Office preview engine is downloaded after install (app/src/engines.mjs).
export function EngineRow({ Row, run }: { Row: RowLike; run: RunWork }) {
  const bridge =
    typeof window === 'undefined' ? null : ((window.dsBotApp?.engine as AppEngineBridge | undefined) ?? null)
  const [state, setState] = useState<AppEngineState | null>(null)
  useEffect(() => {
    if (!bridge) return undefined
    let live = true
    bridge.state().then(
      value => {
        if (live) setState(value)
      },
      () => {},
    )
    const off = bridge.onChange(value => {
      if (live) setState(value)
    })
    return () => {
      live = false
      off?.()
    }
  }, [bridge])
  if (!bridge || !state || state.phase === 'unsupported') return null
  const hint =
    state.phase === 'ready'
      ? t('Ready')
      : state.phase === 'downloading'
        ? t('Downloading {percent}%', { percent: Math.floor(state.percent ?? 0) })
        : state.phase === 'unpacking'
          ? t('Unpacking…')
          : state.phase === 'error'
            ? `${t('Download failed.')} ${state.error ?? ''}`
            : t('Downloaded in the background the first time it is needed (about 70 MB).')
  const control =
    state.phase === 'idle' || state.phase === 'error' ? (
      <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(bridge.download().then(setState))}>
        {state.phase === 'error' ? t('Try again') : t('Download now')}
      </button>
    ) : null
  return h(Row, { label: t('Office file previews'), hint }, control)
}

import { Fragment, createElement as h, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PencilIcon } from './icons.tsx'
import { Caret, useAnchoredMenu } from './model-menu.tsx'
import { t } from './i18n.ts'
import type { BotPatch, SettingsBot, SettingsBotEngine, SettingsEngineOption } from './settings-types.ts'

// Engine menu: the picker for what runs a Bot's turns — the built-in runtime,
// a local ACP agent on the machine, an on-demand ACP agent via npx, or a remote
// agent invited over the relay. Same anchored menu as the model and folder pickers.
export interface EngineMenuProps {
  bot: SettingsBot
  save: (patch: BotPatch) => Promise<boolean>
  refreshEngines?:
    | (() => Promise<{ engines: readonly SettingsEngineOption[]; of: Readonly<Record<string, string>> }>)
    | undefined
  wide?: boolean
}

import { Tick, engineChoiceOf } from './engine-menu-choice.tsx'
export type { EngineChoice } from './engine-menu-choice.tsx'
export { engineChoiceOf } from './engine-menu-choice.tsx'
export function EngineMenu({ bot, save, refreshEngines, wide = false }: EngineMenuProps) {
  const [available, setAvailable] = useState<readonly SettingsEngineOption[]>([])
  const [view, setView] = useState<'list' | 'custom'>('list')
  const [draft, setDraft] = useState('')
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu(() => {
    if (view !== 'list') {
      setView('list')
      return true
    }
    return false
  })

  useEffect(() => {
    if (!refreshEngines) return undefined
    let alive = true
    void refreshEngines().then(result => {
      if (alive) setAvailable(result.engines)
    })
    return () => {
      alive = false
    }
  }, [refreshEngines, bot.id])

  const engine = bot.engine
  const currentOf = (id: string): boolean => {
    if (id === 'builtin') return engine?.kind !== 'acp' && engine?.kind !== 'acp-remote'
    if (id.startsWith('remote:')) {
      const agentId = id.slice('remote:'.length)
      return engine?.kind === 'acp-remote' && (bot.runtimeId === id || engine.agentId === agentId)
    }
    const key = bot.runtimeId ?? engine?.key ?? ''
    if (key !== '') return engine?.kind === 'acp' && key === id
    const entry = available.find(item => item.id === id)
    return (
      engine?.kind === 'acp' &&
      entry !== undefined &&
      entry.command === engine?.command &&
      (entry.args ?? []).join(' ') === (engine.args ?? []).join(' ')
    )
  }

  const toggle = (): void => {
    if (isOpen) {
      close()
      return
    }
    setView('list')
    void refreshEngines?.()
      .then(result => setAvailable(result.engines))
      .catch(() => undefined)
    open()
  }

  const choose = (id: string): void => {
    close()
    if (id === 'builtin') {
      if (engine?.kind !== 'builtin') void save({ engine: null, runtimeId: null })
      return
    }
    if (id.startsWith('remote:')) {
      const agentId = id.slice('remote:'.length)
      if (!(engine?.kind === 'acp-remote' && engine.agentId === agentId))
        void save({ engine: { kind: 'acp-remote', agentId }, runtimeId: id })
      return
    }
    const entry = available.find(item => item.id === id && item.kind === 'acp')
    if (entry?.command !== undefined) {
      const next: SettingsBotEngine = {
        kind: 'acp',
        command: entry.command,
        args: entry.args ?? [],
        key: entry.key ?? entry.id,
      }
      void save({ engine: next, runtimeId: entry.id })
    }
  }

  const typed = (): void => {
    const command = draft.trim()
    if (command === '') return
    close()
    void save({ engine: { kind: 'acp', command, args: [] }, runtimeId: null })
  }

  const local = available.filter(entry => entry.kind === 'acp' && entry.selectable !== false && !entry.onDemand)
  const ondemand = available.filter(
    entry => entry.kind === 'acp' && entry.selectable !== false && Boolean(entry.onDemand),
  )
  const remote = available.filter(entry => entry.kind === 'acp-remote')
  const unsupported = available.filter(
    entry =>
      entry.health !== 'missing' && entry.kind !== 'acp' && entry.kind !== 'acp-remote' && entry.kind !== 'builtin',
  )
  const missing = available.filter(entry => entry.health === 'missing')
  const engineKey = bot.runtimeId ?? engine?.key ?? engine?.command ?? ''
  const customCurrent =
    engine?.kind === 'acp' &&
    !available.some(
      entry =>
        entry.id === engineKey ||
        (entry.command === engine?.command && (entry.args?.join(' ') ?? '') === (engine?.args?.join(' ') ?? '')),
    )
      ? [
          {
            id: `custom:${engine.command ?? ''}`,
            label: engine.command ?? '',
            command: engine.command ?? '',
            args: engine.args ?? [],
            kind: 'acp',
          } satisfies SettingsEngineOption,
        ]
      : []
  const shown = engineChoiceOf(bot, available)

  const listView = (
    <div key='list' className='bt-engine-view'>
      <button
        type='button'
        role='menuitemradio'
        aria-checked={engine?.kind !== 'acp' && engine?.kind !== 'acp-remote'}
        onClick={() => choose('builtin')}>
        <span className='bt-engine-copy'>
          <span className='bt-menu-label'>{t('Built-in')}</span>
          <span className='bt-engine-sub'>{t('Moon Bot runtime')}</span>
        </span>
        <Tick on={engine?.kind !== 'acp' && engine?.kind !== 'acp-remote'} />
      </button>
      {local.length > 0 || customCurrent.length > 0 ? (
        <div className='bt-model-group' role='presentation'>
          {t('Local agents')}
        </div>
      ) : null}
      {customCurrent.map(entry => (
        <span
          key={entry.id}
          className='bt-engine-off'
          role='menuitemradio'
          aria-checked='true'
          aria-disabled='true'
          title={entry.command}>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>{entry.command}</span>
            <span className='bt-engine-sub'>{t('Current configuration')}</span>
          </span>
          <Tick on />
        </span>
      ))}
      {local.map(entry => (
        <button
          key={entry.id}
          type='button'
          role='menuitemradio'
          aria-checked={currentOf(entry.id)}
          title={entry.path}
          onClick={() => choose(entry.id)}>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>{entry.label}</span>
            <span className='bt-engine-sub'>{[entry.version, entry.path].filter(Boolean).join(' · ')}</span>
          </span>
          <Tick on={currentOf(entry.id)} />
        </button>
      ))}
      {ondemand.length > 0 ? (
        <div className='bt-model-group' role='presentation'>
          {t('On-demand agents (npx)')}
        </div>
      ) : null}
      {ondemand.map(entry => (
        <button
          key={entry.id}
          type='button'
          role='menuitemradio'
          aria-checked={currentOf(entry.id)}
          title={`npx ${(entry.args ?? []).join(' ')}`}
          onClick={() => choose(entry.id)}>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>{entry.label}</span>
            <span className='bt-engine-sub'>{`npx ${(entry.args ?? []).join(' ')}`}</span>
          </span>
          <Tick on={currentOf(entry.id)} />
        </button>
      ))}
      {remote.length > 0 ? (
        <div className='bt-model-group' role='presentation'>
          {t('Remote agents')}
        </div>
      ) : null}
      {remote.map(entry => (
        <button
          key={entry.id}
          type='button'
          role='menuitemradio'
          aria-checked={currentOf(entry.id)}
          onClick={() => choose(entry.id)}>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>
              <span className='bt-engine-dot' data-online={entry.online === true ? '' : undefined} aria-hidden />
              {entry.label}
            </span>
            <span className='bt-engine-sub'>{entry.online === true ? t('Connected') : t('Not connected')}</span>
          </span>
          <Tick on={currentOf(entry.id)} />
        </button>
      ))}
      {missing.length > 0 ? (
        <div className='bt-model-group' role='presentation'>
          {t('Not installed')}
        </div>
      ) : null}
      {missing.map(entry => (
        <span key={entry.id} className='bt-engine-off' role='menuitem' aria-disabled='true'>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>{entry.label}</span>
            <span className='bt-engine-sub'>{t('Not on this computer')}</span>
          </span>
        </span>
      ))}
      {unsupported.length > 0 ? (
        <div className='bt-model-group' role='presentation'>
          {t('Detected non-ACP tools')}
        </div>
      ) : null}
      {unsupported.map(entry => (
        <span key={entry.id} className='bt-engine-off' role='menuitem' aria-disabled='true' title={entry.reason}>
          <span className='bt-engine-copy'>
            <span className='bt-menu-label'>{entry.label}</span>
            <span className='bt-engine-sub'>
              {entry.version ?? ''}
              {entry.reason !== undefined && entry.version !== undefined ? ' · ' : ''}
              {entry.reason ?? ''}
            </span>
          </span>
        </span>
      ))}
      <div className='bt-menu-sep' role='separator' />
      <button
        type='button'
        role='menuitem'
        onClick={() => {
          setDraft(engine?.kind === 'acp' ? (engine.command ?? '') : '')
          setView('custom')
        }}>
        <PencilIcon />
        <span className='bt-menu-label'>{t('Custom command…')}</span>
      </button>
    </div>
  )

  const customView = (
    <div key='custom' className='bt-engine-view'>
      <input
        className='bt-folder-input'
        autoFocus
        value={draft}
        spellCheck={false}
        aria-label={t('ACP command')}
        placeholder='opencode'
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) typed()
        }}
      />
      <button type='button' role='menuitem' className='bt-folder-use' disabled={draft.trim() === ''} onClick={typed}>
        {t('Use this command')}
      </button>
    </div>
  )
  const shownView = view === 'custom' ? customView : listView

  return (
    <>
      <button
        ref={button}
        type='button'
        className='bt-model-trigger'
        data-wide={wide || undefined}
        aria-haspopup='menu'
        aria-expanded={isOpen}
        aria-label={t('Engine: {engine}', { engine: shown.name })}
        onClick={toggle}
        onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
          if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            toggle()
          }
        }}>
        <span className='bt-model-copy'>
          <span className='bt-model-name'>{shown.name}</span>
          {shown.sub !== undefined ? <span className='bt-model-provider'>{shown.sub}</span> : null}
        </span>
        <Caret />
      </button>
      {shownPlace
        ? createPortal(
            <div
              ref={menu}
              className={`bt-menu bt-model-menu bt-engine-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`}
              role='menu'
              aria-label={t('Execution engine')}
              style={shownPlace}
              data-leaving={leaving || undefined}>
              {shownView}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export { ENGINE_CSS } from './engine-menu-css.ts'

import { createElement as h, useEffect, useState } from 'react'
import { ChevronRightIcon } from './icons.tsx'
import { EngineMenu } from './engine-menu.tsx'
import { useMemoryCount } from './memory-panel.tsx'
import { t } from './i18n.ts'
import type {
  BotPatch,
  SettingsActions,
  SettingsBot,
  SettingsBotEngine,
  SettingsEngineOption,
} from './settings-types.ts'
import { Card, InlineText, Row } from 'moon-bot-ui'

export function MemoryCard({ bot, actions }: { bot: SettingsBot; actions: SettingsActions }) {
  const count = useMemoryCount(bot.id, actions as never)
  const label =
    count === null
      ? t('Loading…')
      : count === 0
        ? t('Nothing saved yet')
        : count === 1
          ? t('1 entry')
          : t('{count} entries', { count })
  return (
    <Card title={t('Memory')}>
      <button
        type='button'
        className='bt-set-row bt-bs-row'
        aria-label={t("Manage {name}'s memory", { name: bot.name })}
        onClick={() => actions.openMemory(bot.id)}>
        <span className='bt-set-copy'>
          <span className='bt-bs-label'>{label}</span>
        </span>
        <span className='bt-mem-row-go'>
          {t('Manage')}
          <ChevronRightIcon />
        </span>
      </button>
    </Card>
  )
}
function engineArgsText(engine: SettingsBotEngine | undefined): string {
  return engine?.kind === 'acp' ? (engine.args ?? []).join('\n') : ''
}
function engineFrom(command: string, argsText: string, key?: string): SettingsBotEngine {
  return {
    kind: 'acp',
    command,
    args: argsText
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean),
    ...(key ? { key } : {}),
  }
}
export function EngineCard({
  bot,
  save,
  refreshEngines,
}: {
  bot: SettingsBot
  save: (patch: BotPatch) => Promise<boolean>
  refreshEngines?:
    | (() => Promise<{ engines: readonly SettingsEngineOption[]; of: Readonly<Record<string, string>> }>)
    | undefined
}) {
  const [available, setAvailable] = useState<readonly SettingsEngineOption[]>([])
  const acp = bot.engine?.kind === 'acp'
  const command = acp ? (bot.engine?.command ?? '') : ''
  const args = engineArgsText(bot.engine)
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
  const remote = bot.engine?.kind === 'acp-remote'
  const localCount = available.filter(entry => entry.kind === 'acp' && entry.selectable !== false).length
  return (
    <Card title={t('Execution engine')}>
      <Row
        label={t('Engine')}
        hint={
          acp
            ? t('Runs this Bot through an external ACP agent.')
            : remote
              ? t('Runs this Bot through a remote agent invited over the relay.')
              : t('Runs this Bot through Moon Bot built-in runtime.')
        }>
        <EngineMenu bot={bot} save={save} refreshEngines={refreshEngines} />
      </Row>
      {acp ? (
        <Row
          label={t('ACP command')}
          hint={t('Executable available on this computer, for example opencode or claude.')}>
          <InlineText
            label={t('ACP command')}
            value={command}
            placeholder='opencode'
            required
            maxLength={400}
            onSave={next => save({ engine: engineFrom(next, args, bot.engine?.key), runtimeId: null })}
          />
        </Row>
      ) : null}
      {acp ? (
        <Row label={t('ACP arguments')} hint={t('One argument per line.')}>
          <InlineText
            label={t('ACP arguments')}
            value={args}
            multiline
            onSave={next => save({ engine: engineFrom(command, next, bot.engine?.key), runtimeId: null })}
          />
        </Row>
      ) : null}
      {remote ? (
        <Row label={t('Agent ID')} hint={t('The invite names this agent; it answers when its CLI is connected.')}>
          <code className='bt-bs-input' style={{ textAlign: 'left' }}>
            {bot.engine?.agentId ?? ''}
          </code>
        </Row>
      ) : null}
      {acp && localCount === 0 ? (
        <div className='bt-set-hint'>
          {t('No compatible local ACP agents detected. Install one and refresh the Bot settings.')}
        </div>
      ) : null}
    </Card>
  )
}
// A Bot's settings as grouped cards: who it is (avatar, name, label), what it runs on
// (model), what it does (instructions), its memory and tasks, its Main Bot role, its
// sidebar place, and copies.

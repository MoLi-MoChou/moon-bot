import { createElement as h } from 'react'
import { CheckIcon } from './icons.tsx'
import { t } from './i18n.ts'
import type { SettingsBot, SettingsEngineOption } from './settings-types.ts'

export interface EngineChoice {
  readonly name: string
  readonly sub: string | undefined
}

export const Tick = ({ on }: { on: boolean }) => (
  <span className='bt-model-tick' aria-hidden>
    {on ? <CheckIcon /> : null}
  </span>
)

// What the trigger shows for the Bot's current engine.
export function engineChoiceOf(bot: SettingsBot, available: readonly SettingsEngineOption[]): EngineChoice {
  const engine = bot.engine
  if (engine?.kind === 'acp-remote') {
    const agentId = engine.agentId ?? ''
    const entry = available.find(item => item.kind === 'acp-remote' && item.id === `remote:${agentId}`)
    return {
      name: agentId !== '' ? agentId : t('Remote agent'),
      sub:
        entry !== undefined
          ? entry.online === true
            ? t('Remote · online')
            : t('Remote · offline')
          : t('Remote agent'),
    }
  }
  if (engine?.kind !== 'acp') {
    return { name: t('Built-in'), sub: t('Moon Bot runtime') }
  }
  const key = bot.runtimeId ?? engine.key ?? engine.command ?? ''
  const entry = available.find(
    item =>
      item.kind === 'acp' &&
      (item.id === key ||
        (item.command === engine.command && (item.args ?? []).join(' ') === (engine.args ?? []).join(' '))),
  )
  if (entry !== undefined) {
    return {
      name: entry.label,
      sub: entry.onDemand ? t('On-demand (npx)') : [entry.version, t('Local ACP agent')].filter(Boolean).join(' · '),
    }
  }
  return { name: engine.command ?? '', sub: t('Custom command') }
}

import { createElement as h } from 'react'
import { useState } from 'react'
import { isMainOf } from './sources.ts'
import { ChevronRightIcon, PlusIcon } from './icons.tsx'
import { BotAvatar } from './mark.tsx'
import { Segmented } from './motion.tsx'
import { CreateBot } from './create-bot.tsx'
import { t } from './i18n.ts'
import type { RunWork, SettingsActions, SettingsBot, SettingsRoster } from './settings-types.ts'
import { SetSection, SetRow } from './settings-chrome.tsx'

interface MainBotsSectionProps {
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}
// The first Main Bot is the sidebar tile. Picking another Bot there hands it the role
// in one step; more Main Bots can sit beside it.
function MainBotsSection({ roster, actions, run }: MainBotsSectionProps) {
  const mains = (roster.mainBotIds ?? [])
    .map(id => roster.byId[id])
    .filter((bot): bot is SettingsBot => bot !== undefined)
  const [first, ...others] = mains
  const candidates = roster.bots.filter(bot => !isMainOf(roster, bot.id))
  return (
    <SetSection title={t('Main Bot')}>
      <SetRow
        label={t('Main Bot')}
        hint={
          first
            ? t('First in the sidebar. Pick another Bot to hand it the role; {name} then stops being a Main Bot.', {
                name: first.name,
              })
            : undefined
        }>
        <select
          className='bt-select'
          aria-label={t('Main Bot')}
          value={first?.id ?? ''}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
            run(actions.setMain(event.target.value, true, first ? { replace: first.id } : {}))
          }>
          {first ? null : <option value=''>{t('Choose a Bot…')}</option>}
          {roster.bots.map(bot => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </SetRow>
      {others.map(bot => (
        <SetRow key={bot.id} label={bot.name} hint={t('Also a Main Bot.')}>
          <button
            type='button'
            className='bt-soft bt-soft-sm'
            onClick={() => run(actions.setMain(bot.id, true, { primary: true }))}>
            {t('Move to first')}
          </button>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(actions.setMain(bot.id, false))}>
            {t('Remove Main Bot role')}
          </button>
        </SetRow>
      ))}
      {candidates.length > 0 ? (
        <SetRow label={t('Add a Main Bot')} hint={t('Main Bots can create and change Bots, and run every group chat.')}>
          <select
            className='bt-select'
            aria-label={t('Add a Main Bot')}
            value=''
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              if (event.target.value) void run(actions.setMain(event.target.value, true))
            }}>
            <option value=''>{t('Choose a Bot…')}</option>
            {candidates.map(bot => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </SetRow>
      ) : null}
    </SetSection>
  )
}
const MOTIONS: [string, string][] = [
  ['quiet', 'Quiet'],
  ['normal', 'Normal'],
  ['lively', 'Lively'],
]
interface MotionSectionProps {
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}
function MotionSection({ roster, actions, run }: MotionSectionProps) {
  const stored = roster.prefs?.motion
  const motion = stored === 'quiet' || stored === 'lively' ? stored : 'normal'
  return (
    <SetSection title={t('Animation')}>
      <SetRow label={t('Bot animation')}>
        <Segmented label={t('Bot animation')} value={motion} className='bt-motion-seg'>
          {MOTIONS.map(([id, label]) => (
            <button
              key={id}
              type='button'
              aria-pressed={motion === id}
              onClick={() => {
                if (motion !== id) void run(actions.setPrefs({ motion: id }))
              }}>
              {t(label)}
            </button>
          ))}
        </Segmented>
      </SetRow>
    </SetSection>
  )
}
interface BotsPageProps {
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}
export function BotsPage({ roster, actions, run }: BotsPageProps) {
  const [creating, setCreating] = useState(false)
  return [
    <MainBotsSection key='main' roster={roster} actions={actions} run={run} />,
    <MotionSection key='motion' roster={roster} actions={actions} run={run} />,
    creating ? (
      <CreateBot
        key='create'
        roster={roster}
        actions={actions}
        inline
        canGoBack={false}
        onBack={() => setCreating(false)}
        onCreated={bot => actions.openSettings('bots', bot.id)}
      />
    ) : (
      <div key='new' className='bt-actions'>
        <button type='button' className='bt-soft bt-soft-sm bt-with-icon' onClick={() => setCreating(true)}>
          <PlusIcon />
          {t('New Bot')}
        </button>
      </div>
    ),
    <SetSection key='bots' title={t('Bots · {count}', { count: roster.bots.length })}>
      {roster.bots.map(bot => (
        <button key={bot.id} type='button' className='bt-set-row' onClick={() => actions.openSettings('bots', bot.id)}>
          <span className='bt-set-bot'>
            <BotAvatar bot={bot} size={28} badge={false} live={false} />
            <span className='bt-row-title'>{bot.name}</span>
            {bot.role ? <span className='bt-tag'>{bot.role}</span> : null}
            {isMainOf(roster, bot.id) ? <span className='bt-tag'>{t('Main Bot')}</span> : null}
            {bot.hidden && !isMainOf(roster, bot.id) ? <span className='bt-tag'>{t('Hidden')}</span> : null}
          </span>
          <span className='bt-chevron'>
            <ChevronRightIcon />
          </span>
        </button>
      ))}
    </SetSection>,
  ]
}

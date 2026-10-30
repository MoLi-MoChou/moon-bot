import { createElement as h, useCallback, useEffect, useState } from 'react'
import { isMainOf } from './sources.ts'
import { PencilIcon, ChevronRightIcon } from './icons.tsx'
import { BotMark } from './mark.tsx'
import { ModelMenu } from './model-menu.tsx'
import { FolderMenu } from './folder-menu.tsx'
import { BotSchedules } from './schedules.tsx'
import { BotCapabilitiesCard } from './capability-settings.tsx'
import { t } from './i18n.ts'
import { BotResetCard, type ResetActions } from './bot-reset.tsx'
import { ProactiveCard, type ProactiveActions } from './proactive-page.tsx'
import type { BotPatch, BotSettingsFormProps } from './settings-types.ts'
import { Card, InlineText, Row, SwitchRow } from 'moon-bot-ui'
import { AvatarEditor, modelHint } from './bot-settings-avatar.tsx'
import { EngineCard, MemoryCard } from './bot-settings-engine.tsx'
import { BOT_SETTINGS_CSS } from './bot-settings-css.ts'

export { avatarImage, CharacterGrid } from './bot-settings-avatar.tsx'
export { BOT_SETTINGS_CSS }

export function BotSettingsForm({ bot, roster, actions, run }: BotSettingsFormProps) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const closeEditor = useCallback(() => setEditing(false), [])
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(timer)
  }, [confirming])
  const isMainBot = isMainOf(roster, bot.id)
  const onlyMain = isMainBot && (roster.mainBotIds ?? []).length === 1
  const isTile = roster.mainBotId === bot.id
  const save = (patch: BotPatch): Promise<boolean> => run(actions.updateBot(bot.id, patch))
  const duplicate = (): Promise<boolean> => run(actions.duplicateBot(bot.id).then(copy => actions.openSession(copy.id)))
  const remove = (): void => {
    if (confirming) void run(actions.deleteBot(bot.id))
    else setConfirming(true)
  }
  // the host settings can change the model list at any time; the hint should match it.
  useEffect(() => {
    void actions.refreshModels?.()
  }, [bot.id])
  return (
    <div className='bt-bs'>
      <div className='bt-bs-hero'>
        <div className='bt-avatar-anchor'>
          <button
            type='button'
            className='bt-avatar-trigger'
            aria-label={t('Edit Bot avatar')}
            aria-expanded={editing}
            onClick={() => setEditing(value => !value)}>
            <BotMark bot={bot} size={64} live />
            <span className='bt-avatar-pencil' aria-hidden>
              <PencilIcon />
            </span>
          </button>
          {editing ? <AvatarEditor bot={bot} actions={actions} run={run} onClose={closeEditor} /> : null}
        </div>
        <div className='bt-bs-who'>
          <span className='bt-bs-name'>{bot.name}</span>
          <span className='bt-bs-sub'>
            {[bot.role, isMainBot ? t('Main Bot') : ''].filter(Boolean).join(' · ') || t('Bot')}
          </span>
        </div>
      </div>
      <Card title={t('Profile')}>
        <Row label={t('Name')}>
          <InlineText
            label={t('Name')}
            value={bot.name}
            placeholder='Bob'
            required
            maxLength={40}
            onSave={name => save({ name })}
          />
        </Row>
        <Row label={t('Label')} hint={t('Optional. Shown under the name.')}>
          <InlineText
            label={t('Label')}
            value={bot.role}
            placeholder={t('Research, admin…')}
            maxLength={24}
            onSave={role => save({ role })}
          />
        </Row>
      </Card>
      <Card title={t('Model')}>
        <div className='bt-set-row bt-bs-row'>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Model')}</span>
            <span className='bt-set-hint'>{modelHint(bot, roster)}</span>
          </span>
          <ModelMenu bot={bot} roster={roster} actions={actions} run={run} />
        </div>
      </Card>
      <EngineCard bot={bot} save={save} refreshEngines={actions.refreshEngines} />
      <Card title={t('Working folder')}>
        <div className='bt-set-row bt-bs-row'>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Folder')}</span>
          </span>
          <FolderMenu value={bot.workDir} actions={actions} run={run} onPick={workDir => save({ workDir })} />
        </div>
      </Card>
      <Card title={t('Instructions')}>
        <Row label={t('What this Bot does')} hint={t("Its job on the team. Part of the Bot's system prompt.")} stack>
          <InlineText
            label={t('Instructions')}
            value={bot.instructions}
            multiline
            placeholder={t('What this Bot is responsible for…')}
            onSave={instructions => save({ instructions })}
          />
        </Row>
      </Card>
      <BotCapabilitiesCard
        bot={bot as never}
        roster={roster as never}
        actions={actions as never}
        run={run}
        Card={Card as never}
        SwitchRow={SwitchRow as never}
      />
      {roster.memory === false ? null : <MemoryCard bot={bot} actions={actions} />}
      <BotSchedules bot={bot} roster={roster} actions={actions} />
      <Card title={t('Main Bot')}>
        {onlyMain ? (
          <div className='bt-set-row bt-bs-row'>
            <span className='bt-set-copy'>
              <span className='bt-bs-label'>{t('Main Bot')}</span>
              <span className='bt-set-hint'>
                {t('The only Main Bot. To hand the role to another Bot, use Main Bot on the Bots page.')}
              </span>
            </span>
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.openSettings('bots')}>
              {t('Change')}
            </button>
          </div>
        ) : (
          <SwitchRow
            label={t('Main Bot')}
            hint={t('Can create and change Bots, and runs every group chat.')}
            on={isMainBot}
            onChange={on => run(actions.setMain(bot.id, on))}
          />
        )}
      </Card>
      {
        // The Main Bot tile is always first and always shown, like in the context menu.
        isTile ? null : (
          <Card title={t('Sidebar')}>
            <SwitchRow
              label={t('Pin')}
              hint={t('Kept above the other chats.')}
              on={bot.pinned === true}
              onChange={pinned => run(actions.setFlags(bot.id, { pinned }))}
            />
            {isMainBot ? null : (
              <SwitchRow
                label={t('Hide from sidebar')}
                hint={t('Search still finds it.')}
                on={bot.hidden === true}
                onChange={hidden => run(actions.setFlags(bot.id, { hidden }))}
              />
            )}
          </Card>
        )
      }
      {actions.resetBot === undefined ? null : (
        <BotResetCard bot={bot} actions={actions as unknown as ResetActions} run={run} />
      )}
      {actions.proactiveList === undefined ? null : (
        <ProactiveCard botId={bot.id} actions={actions as unknown as ProactiveActions} />
      )}
      <Card title={t('Manage')}>
        <button type='button' className='bt-set-row bt-bs-row' onClick={duplicate}>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Duplicate')}</span>
            <span className='bt-set-hint'>{t('A copy with the same job and model, and fresh memory.')}</span>
          </span>
          <span className='bt-chevron'>
            <ChevronRightIcon />
          </span>
        </button>
        {isMainBot ? null : (
          <button
            type='button'
            className='bt-set-row bt-bs-row bt-bs-danger'
            data-confirm={confirming || undefined}
            onClick={remove}>
            <span className='bt-set-copy'>
              <span className='bt-bs-label'>
                {confirming ? t('Delete {name}?', { name: bot.name }) : t('Delete Bot')}
              </span>
              <span className='bt-set-hint'>
                {confirming ? t('Click again to delete. Its chats are archived.') : t('Removes the Bot from the team.')}
              </span>
            </span>
            <span className='bt-chevron'>
              <ChevronRightIcon />
            </span>
          </button>
        )}
      </Card>
    </div>
  )
}

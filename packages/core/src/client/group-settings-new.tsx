import { createElement as h, useState } from 'react'
import { AdminStar, BotAvatar } from './mark.tsx'
import { t } from './i18n.ts'
import type { GroupActions, GroupBot, GroupRoster, RunWork } from './group-settings-types.ts'

export function NewGroupForm({
  roster,
  actions,
  run,
  onCreated,
  onCancel,
}: {
  roster: GroupRoster
  actions: GroupActions
  run: RunWork
  onCreated: (room: { id: string; name: string; members: readonly string[] }) => void
  onCancel: () => void
}) {
  const [admin, setAdmin] = useState<string | null>(null)
  const [members, setMembers] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) =>
    setMembers(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]))
  const pickAdmin = (id: string) => {
    setAdmin(id)
    setMembers(list => list.filter(item => item !== id))
  }
  const create = async () => {
    if (busy || admin === null || members.length === 0) return
    setBusy(true)
    let room:
      | {
          id: string
          name: string
          members: readonly string[]
        }
      | undefined
    const done = await run(
      actions
        .createRoom([admin, ...members], { admin, greet: true, ...(name.trim() ? { name: name.trim() } : {}) })
        .then(value => {
          room = value
        }),
    )
    if (done && room) onCreated(room)
    else setBusy(false)
  }
  const chip = (bot: GroupBot, on: boolean, onClick: () => void, role: string) => (
    <button key={bot.id} type='button' role={role} className='bt-ng-chip' aria-checked={on} onClick={onClick}>
      <BotAvatar bot={bot} size={22} badge={false} live={false} />
      <span className='bt-ng-name'>{bot.name}</span>
      {on && role === 'radio' ? <AdminStar /> : null}
    </button>
  )
  return (
    <div className='bt-set-card bt-ng'>
      <div className='bt-set-row bt-bs-row bt-bs-stack'>
        <span className='bt-set-copy'>
          <span className='bt-bs-label bt-ng-label'>
            <AdminStar />
            {t('Choose the group admin')}
          </span>
        </span>
        <div className='bt-ng-picks' role='radiogroup' aria-label={t('Group admin')}>
          {roster.bots.map(bot => chip(bot, admin === bot.id, () => pickAdmin(bot.id), 'radio'))}
        </div>
      </div>
      {admin === null ? null : (
        <div className='bt-set-row bt-bs-row bt-bs-stack bt-ng-step'>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Who to chat with…')}</span>
          </span>
          <div className='bt-ng-picks' role='group' aria-label={t('Members')}>
            {roster.bots
              .filter(bot => bot.id !== admin)
              .map(bot => chip(bot, members.includes(bot.id), () => toggle(bot.id), 'checkbox'))}
          </div>
        </div>
      )}
      {admin === null || members.length === 0 ? null : (
        <label className='bt-set-row bt-bs-row bt-ng-step'>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Name')}</span>
          </span>
          <input
            className='bt-bs-input'
            value={name}
            maxLength={60}
            placeholder={t('Name after members')}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
        </label>
      )}
      <div className='bt-set-row bt-task-foot'>
        <button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button
          type='button'
          className='bt-send bt-soft-sm'
          disabled={busy || admin === null || members.length === 0}
          onClick={() => void create()}>
          {t('Create group chat')}
        </button>
      </div>
    </div>
  )
}

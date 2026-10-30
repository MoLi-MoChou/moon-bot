import { createElement as h } from 'react'
import { useState } from 'react'
import { ChevronRightIcon, PeopleIcon, PlusIcon } from './icons.tsx'
import { EmptyState } from 'moon-bot-ui'
import { AdminStar, RoomAvatar } from './mark.tsx'
import { useEscape } from './overlay-hooks.ts'
import { NewGroupForm } from './group-settings.tsx'
import { t } from './i18n.ts'
import type { RunWork, SettingsActions, SettingsRoster } from './settings-types.ts'
import { SetSection } from './settings-chrome.tsx'

interface GroupsPageProps {
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}
export function GroupsPage({ roster, actions, run }: GroupsPageProps) {
  const [creating, setCreating] = useState(false)
  useEscape(() => setCreating(false), creating)
  return [
    creating ? (
      <NewGroupForm
        key='create'
        roster={roster as never}
        actions={actions as never}
        run={run}
        onCancel={() => setCreating(false)}
        onCreated={(room: { id: string }) => actions.openSettings('groups', room.id)}
      />
    ) : (
      <div key='new' className='bt-actions'>
        <button
          type='button'
          className='bt-soft bt-soft-sm bt-with-icon'
          disabled={roster.bots.length < 2}
          title={roster.bots.length < 2 ? t('A group chat needs at least two Bots') : undefined}
          onClick={() => setCreating(true)}>
          <PlusIcon />
          {t('Create group chat')}
        </button>
      </div>
    ),
    <SetSection key='groups' title={t('Group chats · {count}', { count: roster.rooms.length })}>
      {roster.rooms.length === 0 ? (
        <EmptyState
          icon={<PeopleIcon />}
          title={t('No group chats yet.')}
          hint={t('A group chat lets several Bots work on one thing with you.')}
          action={
            roster.bots.length >= 2
              ? { icon: <PlusIcon />, label: t('Create group chat'), onClick: () => setCreating(true) }
              : { icon: <PlusIcon />, label: t('Create Bot'), onClick: () => actions.openSettings('bots') }
          }
        />
      ) : (
        roster.rooms.map(room => {
          const admin = room.admin ? roster.byId[room.admin] : undefined
          return (
            <button
              key={room.id}
              type='button'
              className='bt-set-row'
              onClick={() => actions.openSettings('groups', room.id)}>
              <span className='bt-set-bot'>
                <RoomAvatar room={room} roster={roster} size={28} />
                <span className='bt-row-title'>{room.name}</span>
                <span className='bt-tag'>{t('{count} members', { count: room.members.length })}</span>
                {admin ? (
                  <span className='bt-tag bt-tag-admin'>
                    <AdminStar />
                    {admin.name}
                  </span>
                ) : null}
                {room.hidden ? <span className='bt-tag'>{t('Hidden')}</span> : null}
              </span>
              <span className='bt-chevron'>
                <ChevronRightIcon />
              </span>
            </button>
          )
        })
      )}
    </SetSection>,
  ]
}

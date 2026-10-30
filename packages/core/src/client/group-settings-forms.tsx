import { createElement as h, useEffect, useState } from 'react'
import { isMainOf } from './sources.ts'
import { PlusIcon, ChevronRightIcon } from './icons.tsx'
import { BotAvatar, BotMark, RoomAvatar } from './mark.tsx'
import { Card, Row, InlineText, SwitchRow } from 'moon-bot-ui'
import { Segmented } from './motion.tsx'
import { FolderMenu } from './folder-menu.tsx'
import { PermissionPicker } from './permission-picker.tsx'
import { t } from './i18n.ts'
import {
  type GroupActions,
  type GroupBot,
  type GroupRoom,
  type GroupRoster,
  type RunWork,
  ROOM_MODES,
  roomSubtitle,
  shownMode,
} from './group-settings-types.ts'

// One preset for every member in the group, or each member's own. Turning it on starts
// from the host's default preset.
function GroupPermission({
  room,
  catalog,
  update,
}: {
  room: GroupRoom
  catalog: GroupRoster['permissions']
  update: (patch: Record<string, unknown>) => unknown
}) {
  if (!catalog?.options?.length) return null
  const shared = room.permission !== undefined
  return (
    <Card title={t('Permissions')}>
      <SwitchRow
        label={t('Same for every member')}
        hint={t("Replaces each member's own permissions in this group.")}
        on={shared}
        onChange={(on: boolean) =>
          update({ permission: on ? (catalog?.defaultPreset ?? catalog?.options[0]?.value ?? null) : null })
        }
      />
      {shared ? (
        <div className='bt-set-row bt-bs-row bt-bs-stack bt-gs-perm bt-veil'>
          <PermissionPicker
            catalog={catalog}
            saved={room.permission ?? ''}
            onPick={(permission: string) => update({ permission })}
          />
        </div>
      ) : null}
    </Card>
  )
}
// A group chat's settings as grouped cards: its name and notice, who answers, its
// members and admin, its permissions, its sidebar place, and deleting it. The user may
// change all of it; the host enforces what Bots may change.
export function GroupSettingsForm({
  room,
  roster,
  actions,
  run,
  onDeleted,
}: {
  room: GroupRoom
  roster: GroupRoster
  actions: GroupActions
  run: RunWork
  onDeleted?: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(timer)
  }, [confirming])
  const members = room.members.map(id => roster.byId[id]).filter((bot): bot is GroupBot => bot !== undefined)
  const outside = roster.bots.filter(bot => !room.members.includes(bot.id))
  const admin = room.admin ? roster.byId[room.admin] : undefined
  const mode = shownMode(room, roster)
  const modeHint: string = ROOM_MODES.find(([id]) => id === mode)?.[2] ?? ''
  const update = (patch: Record<string, unknown>) => run(actions.updateRoom(room.id, patch))
  const openBot = (id: string) => {
    actions.closeSettings()
    actions.openSession(id)
  }
  const remove = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    void Promise.resolve(run(actions.deleteRoom(room.id))).then(done => {
      if (done) onDeleted?.()
    })
  }
  return (
    <div className='bt-bs'>
      <div className='bt-bs-hero'>
        <RoomAvatar room={room} roster={roster} size={64} />
        <div className='bt-bs-who'>
          <span className='bt-bs-name'>{room.name}</span>
          <span className='bt-bs-sub'>{roomSubtitle(room, roster)}</span>
        </div>
      </div>
      <Card title={t('Profile')}>
        <Row label={t('Name')} hint={t('Leave it empty to name the group after its members.')}>
          <InlineText
            label={t('Group name')}
            value={room.named ? room.name : ''}
            placeholder={t('Name after members')}
            maxLength={60}
            onSave={name => update({ name })}
          />
        </Row>
        <Row label={t('Notice')} hint={t('Every member reads it before speaking in this group.')} stack>
          <InlineText
            label={t('Group notice')}
            value={room.notice ?? ''}
            multiline
            maxLength={2000}
            placeholder={t('Shared instructions every member reads before speaking…')}
            onSave={notice => update({ notice })}
          />
        </Row>
      </Card>
      <Card title={t('Who answers')}>
        <div className='bt-set-row bt-bs-row bt-bs-stack'>
          <Segmented label={t('Who answers')} value={mode}>
            {ROOM_MODES.map(([id, label]) => (
              <button
                key={id}
                type='button'
                aria-pressed={mode === id}
                disabled={id === 'admin' && !admin}
                title={id === 'admin' && !admin ? t('Choose an admin first') : undefined}
                onClick={() => {
                  if (mode !== id) void update({ mode: id })
                }}>
                {t(label)}
              </button>
            ))}
          </Segmented>
          <span
            key={mode}
            className='bt-set-hint bt-veil'>{`${t(modeHint)} ${t('@mentions always pick who answers.')}`}</span>
        </div>
      </Card>
      <Card title={t('Working folder')}>
        <div className='bt-set-row bt-bs-row'>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>{t('Folder')}</span>
          </span>
          <FolderMenu
            value={room.workDir}
            group
            actions={actions as never}
            run={run}
            onPick={(workDir: string) => update({ workDir })}
          />
        </div>
      </Card>
      <GroupPermission room={room} catalog={roster.permissions} update={update} />
      <Card title={t('Members · {count}', { count: members.length })}>
        {members.map(member => {
          const leads = room.admin === member.id
          return (
            <div key={member.id} className='bt-set-row bt-bs-row bt-gs-member'>
              <button
                type='button'
                className='bt-gs-who'
                title={t("Open {name}'s chat", { name: member.name })}
                onClick={() => openBot(member.id)}>
                <BotAvatar bot={member} size={26} main={isMainOf(roster, member.id)} admin={leads} live={false} />
                <span className='bt-row-title'>{member.name}</span>
                {leads ? <span className='bt-tag'>{t('Admin')}</span> : null}
              </button>
              {leads ? (
                <button
                  type='button'
                  className='bt-mini'
                  title={t('Leave the group without an admin')}
                  onClick={() => update({ admin: null })}>
                  {t('Unset')}
                </button>
              ) : (
                <button type='button' className='bt-mini' onClick={() => update({ admin: member.id })}>
                  {t('Make admin')}
                </button>
              )}
              {members.length > 2 ? (
                <button
                  type='button'
                  className='bt-x'
                  aria-label={t('Remove {name} from the group', { name: member.name })}
                  title={t('Remove from group')}
                  onClick={() => update({ remove: [member.id] })}>
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
        {adding ? (
          [
            ...outside.map(bot => (
              <button
                key={bot.id}
                type='button'
                className='bt-set-row bt-bs-row bt-gs-pick'
                onClick={() => {
                  setAdding(false)
                  void update({ add: [bot.id] })
                }}>
                <BotMark bot={bot} size={22} />
                <span className='bt-set-copy'>
                  <span className='bt-bs-label'>{bot.name}</span>
                </span>
                <span className='bt-set-hint'>{t('Add')}</span>
              </button>
            )),
            <button
              key='cancel'
              type='button'
              className='bt-set-row bt-bs-row bt-gs-add'
              onClick={() => setAdding(false)}>
              {t('Cancel')}
            </button>,
          ]
        ) : outside.length > 0 ? (
          <button type='button' className='bt-set-row bt-bs-row bt-gs-add' onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('Add member')}
          </button>
        ) : null}
        <div className='bt-set-row bt-gs-note'>
          <span className='bt-set-hint'>
            {
              // The host checks for two members on every change, even a rename.
              members.length < 2
                ? t('Add a Bot first: a group chat needs at least two.')
                : admin
                  ? t('{name} leads this group: it can call members with @Name, change the group, and post here.', {
                      name: admin.name,
                    })
                  : t('No admin yet. An admin can call members with @Name, change the group, and post here.')
            }
          </span>
        </div>
      </Card>
      <Card title={t('Sidebar')}>
        <SwitchRow
          label={t('Pin')}
          hint={t('Kept above the other chats.')}
          on={room.pinned === true}
          onChange={pinned => run(actions.setFlags(room.id, { pinned }))}
        />
        <SwitchRow
          label={t('Hide from sidebar')}
          hint={t('Search still finds it.')}
          on={room.hidden === true}
          onChange={hidden => run(actions.setFlags(room.id, { hidden }))}
        />
      </Card>
      <Card title={t('Manage')}>
        <button
          type='button'
          className='bt-set-row bt-bs-row'
          onClick={() => {
            const archive = actions.archiveRoom
            if (archive !== undefined) void run(archive(room.id, room.archivedAt === undefined))
          }}>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>
              {room.archivedAt === undefined ? t('Archive group') : t('Restore group')}
            </span>
            <span className='bt-set-hint'>
              {room.archivedAt === undefined
                ? t('Stops new rounds. The chat, members and memory stay.')
                : t('The group returns to the sidebar and can speak again.')}
            </span>
          </span>
        </button>
        <button
          type='button'
          className='bt-set-row bt-bs-row bt-bs-danger'
          data-confirm={confirming || undefined}
          onClick={remove}>
          <span className='bt-set-copy'>
            <span className='bt-bs-label'>
              {confirming ? t('Delete {name}?', { name: room.name }) : t('Delete group')}
            </span>
            <span className='bt-set-hint'>
              {confirming
                ? t('Click again to delete. Its history is archived.')
                : t('Removes the group chat. Its members stay on the team.')}
            </span>
          </span>
          <span className='bt-chevron'>
            <ChevronRightIcon />
          </span>
        </button>
      </Card>
    </div>
  )
}
// A new group chat from Settings: its admin first, then the other members, then a name
// if the member names will not do.

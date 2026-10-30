import { Fragment, createElement as h, useEffect, useRef, useState } from 'react'
import type { RunStatsValues } from './text.ts'
import { runStatsOf } from './text.ts'
import { BotMark } from './mark.tsx'
import type { ForwardedHook } from './browser-pane.tsx'
import { useMorph } from './motion.tsx'
import { MemberApprovals, MemberState, StopMemberWork, useMemberWork, workState } from './member-status.tsx'
import type { MemberEntry } from './member-status.tsx'
import { PermissionPicker, presetDanger, presetName } from './permission-picker.tsx'
import { ROOM_MODES, shownMode } from './group-settings.tsx'
import { MemoryRow } from './memory-panel.tsx'
import type { DetailsDrawerActions, DetailsDrawerRoster, DrawerBot, DrawerRoom } from './details-drawer-types.ts'
import { t } from './i18n.ts'
import type { I18nKey } from './i18n.ts'

interface PermissionRowProps {
  bot: DrawerBot
  roster: DetailsDrawerRoster
  actions: DetailsDrawerActions
  run: (work: Promise<unknown>) => Promise<boolean>
}

/** The Bot's permission preset, from the presets DeepSeek Harness offers. */
export function PermissionRow({ bot, roster, actions, run }: PermissionRowProps) {
  const catalog = roster.permissions
  if (!catalog?.options?.length) return null
  return (
    <div className='bt-drawer-permission'>
      <div className='bt-section-title'>{t('Permissions')}</div>
      {
        // A Bot without its own preset may run on another one set in the host, so its first pick always applies.
        <PermissionPicker
          catalog={catalog}
          saved={bot.permission ?? catalog.defaultPreset}
          repick={bot.permission === undefined}
          onPick={permission => run(actions.updateBot(bot.id, { permission }))}
        />
      }
    </div>
  )
}

interface RunStatsProps {
  bot: DrawerBot
  part: string
  running: boolean
  actions: DetailsDrawerActions
}

/** The current part's turns, speed, cache hits and context, for a window without the host's status bar. */
export function RunStats({ bot, part, running, actions }: RunStatsProps) {
  const [values, setValues] = useState<RunStatsValues | null>(null)
  useEffect(() => {
    if (!actions.runStats) return undefined
    let current = true
    actions.runStats(bot.id).then(
      next => {
        if (current) setValues(next)
      },
      // The line stays as it was until the next read works.
      () => {},
    )
    return () => {
      current = false
    }
  }, [bot.id, part, running])
  const shown = runStatsOf(values ?? undefined)
  if (shown.length === 0) return null
  return (
    <div className='bt-run-stats'>
      {shown.map((entry, index) => (
        <>
          {index > 0 ? (
            <span className='bt-run-sep' aria-hidden>
              ·
            </span>
          ) : null}
          <span title={entry.title}>{entry.text}</span>
        </>
      ))}
    </div>
  )
}

/** About: a Bot's instructions or a group's notice in the overview, folded to five lines. */
export function About({ text, title = 'About' }: { text: string; title?: I18nKey }) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > 5 || text.length > 240
  const body = useRef<HTMLDivElement | null>(null)
  useMorph(body, open)
  return (
    <div>
      <div className='bt-section-title'>{t(title)}</div>
      <div ref={body} className='bt-about' data-open={open || undefined}>
        {text}
      </div>
      {long ? (
        <button type='button' className='bt-more' onClick={() => setOpen(value => !value)}>
          {open ? t('Show less') : t('Show more')}
        </button>
      ) : null}
    </div>
  )
}

const PILE_MAX = 4

/** A group's face in its details: its first members side by side. */
export function MemberPile({ room, roster }: { room: DrawerRoom; roster: DetailsDrawerRoster }) {
  const members = room.members.map(id => roster.byId[id]).filter((bot): bot is DrawerBot => bot !== undefined)
  const shown = members.length > PILE_MAX ? members.slice(0, PILE_MAX - 1) : members
  const more = members.length - shown.length
  return (
    <span className='bt-pile' aria-hidden>
      {shown.map((bot, index) => (
        <span key={bot.id} className='bt-pile-face' style={{ animationDelay: `${index * 40}ms` }}>
          <BotMark bot={bot} size={44} live />
        </span>
      ))}
      {more > 0 ? (
        <span key='more' className='bt-pile-face bt-pile-more' style={{ animationDelay: `${shown.length * 40}ms` }}>
          {`+${more}`}
        </span>
      ) : null}
    </span>
  )
}

const markOf = (entry: MemberEntry | undefined): string =>
  entry?.state === 'ask' ? 'alert' : entry?.state === 'work' ? workState(entry.doing) : 'idle'

/** One member: its mark, name and what it is doing. */
function MemberRow({
  member,
  entry,
  room,
  roster,
  actions,
}: {
  member: DrawerBot
  entry: MemberEntry | undefined
  room: DrawerRoom
  roster: DetailsDrawerRoster
  actions: DetailsDrawerActions
}) {
  return (
    <div role='listitem' className='bt-member'>
      <div className='bt-member-row'>
        <button
          type='button'
          className='bt-member-open'
          title={t("Open {name}'s chat", { name: member.name })}
          onClick={() => actions.openSession(member.id)}>
          <BotMark bot={member} size={32} state={markOf(entry)} />
          <span className='bt-member-text'>
            <span className='bt-member-line'>
              <span className='bt-member-name'>{member.name}</span>
              {room.admin === member.id ? <span className='bt-tag'>{t('Admin')}</span> : null}
            </span>
            {h(MemberState, { entry, bot: member, room, roster })}
          </span>
        </button>
        <StopMemberWork entry={entry} bot={member} room={room} actions={actions} />
      </div>
      <MemberApprovals entry={entry} bot={member} actions={actions} />
    </div>
  )
}

export interface GroupOverviewProps {
  room: DrawerRoom
  roster: DetailsDrawerRoster
  actions: DetailsDrawerActions
  usage: string
  useWork: ForwardedHook
  openSettings: () => void
}

/** A group's overview: what members read, who is in it, who answers, and what it remembers. */
export function GroupOverview({ room, roster, actions, usage, useWork, openSettings }: GroupOverviewProps) {
  const members = room.members.map(id => roster.byId[id]).filter((bot): bot is DrawerBot => bot !== undefined)
  const { entries } = useMemberWork(room, useWork as never)
  return [
    room.notice ? (
      <About key='notice' title='Notice' text={room.notice} />
    ) : (
      <button key='notice' type='button' className='bt-more' onClick={openSettings}>
        {t('Add a notice in group settings')}
      </button>
    ),
    <div key='members'>
      <div className='bt-section-title'>{t('Members · {count}', { count: members.length })}</div>
      <div className='bt-members' role='list'>
        {members.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            entry={entries.find((item: { id: string }) => item.id === member.id)}
            room={room}
            roster={roster}
            actions={actions}
          />
        ))}
      </div>
    </div>,
    <div key='mode'>
      <div className='bt-section-title'>{t('Who answers')}</div>
      <div className='bt-kv'>
        <span>{t(ROOM_MODES.find(([id]) => id === shownMode(room as never, roster as never))?.[1] ?? 'Everyone')}</span>
      </div>
    </div>,
    room.permission ? (
      <div key='permission'>
        <div className='bt-section-title'>{t('Permissions')}</div>
        <div className='bt-kv'>
          <span className={presetDanger(room.permission) ? 'bt-perm-danger' : undefined}>
            {presetName(room.permission, roster.permissions)}
          </span>
        </div>
      </div>
    ) : null,
    roster.memory === false ? null : (
      <MemoryRow key='memory' owner={{ id: room.id, name: room.name, group: true }} actions={actions} />
    ),
    usage ? (
      <div key='usage'>
        <div className='bt-section-title'>{t('Usage')}</div>
        <div className='bt-kv'>
          <span>{room.name}</span>
          <span>{usage}</span>
        </div>
      </div>
    ) : null,
  ]
}

// Sidebar agent and agent-session rows.
import { createElement as h, useLayoutEffect, useRef } from 'react'
import { FishLogo } from './primitives.tsx'
import { relativeShort } from './text.ts'
import { PlusIcon } from './icons.tsx'
import { t } from './i18n.ts'
import type { TSidebarActions, TSidebarAgent, TSidebarRowProps } from './sidebar-types.js'
import { useMarkedUnread } from './sidebar-rows-helpers.tsx'

export interface AgentSessionView {
  readonly id: string
  readonly title: string
  readonly at: number
  readonly active: boolean
  readonly running?: boolean | undefined
  readonly unread?: boolean | undefined
}
export function AgentSessionRow({
  session,
  agent,
  actions,
  renaming,
  index,
}: {
  readonly session: AgentSessionView
  readonly agent: TSidebarAgent
  readonly actions: TSidebarActions
  readonly renaming: boolean
  readonly index: number
}) {
  const input = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
  }, [renaming])
  if (renaming) {
    const commit = (keep: boolean): void => {
      const value = input.current?.value ?? ''
      if (!keep || value.trim() === '' || value.trim() === session.title) {
        actions.endAgentRename()
        return
      }
      // The editor closes only after the rename landed; a failure keeps it open.
      void (async () => {
        try {
          await actions.renameAgentSession(agent.id, session.id, value)
          actions.endAgentRename()
        } catch (error) {
          actions.reportError(error, 'agent-rename')
        }
      })()
    }
    return (
      <div className='bt-agent-sub-row bt-agent-edit' style={{ '--i': index }}>
        <input
          ref={input}
          defaultValue={session.title}
          aria-label={t('Rename')}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') commit(true)
            else if (event.key === 'Escape') commit(false)
          }}
          onBlur={() => commit(true)}
        />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='bt-agent-sub-row'
      aria-current={session.active ? 'page' : undefined}
      style={{ '--i': index }}
      onClick={() => actions.openAgentSession(session.id)}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        actions.openMenu({
          kind: 'agent-session',
          id: session.id,
          agentId: agent.id,
          x: event.clientX,
          y: event.clientY,
        })
      }}>
      <span className='bt-agent-sub-title'>{session.title}</span>
      <span className='bt-agent-sub-time'>{session.at > 0 ? relativeShort(session.at) : ''}</span>
    </button>
  )
}
// The Agent row: a plain session Session list lives in the Bot workspace, so it
// sits among the Bots with the harness's own whale mark.
export function AgentRow({
  agent,
  actions,
  useSessions,
  useSessionStatus,
  useUi,
  wide,
  marked,
}: Omit<TSidebarRowProps, 'roster' | 'useSessionRetainInfo' | 'useActivity' | 'useWork'> & {
  readonly agent: TSidebarAgent
  readonly marked: boolean | undefined
}) {
  const info = useSessions(list =>
    JSON.stringify(
      agent.sessions
        .map((id): AgentSessionView => {
          const row = list.byId[id]
          return {
            id,
            // A blank Session's title is the workspace folder name; show the label instead.
            title: row?.blank === true ? '' : (row?.displayTitle ?? row?.title ?? ''),
            at: row?.updatedAt ?? 0,
            running: row?.running === true,
            active: (row?.retainedBy?.mainView ?? 0) > 0,
          }
        })
        .sort((a, b) => b.at - a.at),
    ),
  )
  const statusInfo = useSessionStatus(map =>
    JSON.stringify(
      agent.sessions.map(id => ({
        id,
        running: map.get(id)?.running === true,
        unread: map.get(id)?.completionUnread === true,
      })),
    ),
  )
  const statuses = Object.fromEntries(
    (
      JSON.parse(statusInfo) as {
        id: string
        running: boolean
        unread: boolean
      }[]
    ).map(entry => [entry.id, entry]),
  ) as Record<
    string,
    {
      running: boolean
      unread: boolean
    }
  >
  const sessions = (JSON.parse(info) as AgentSessionView[]).map(session => ({
    ...session,
    running: statuses[session.id]?.running ?? session.running,
    unread: statuses[session.id]?.unread ?? false,
    title: session.title === '' ? t('New session') : session.title,
  }))
  const renaming = useUi(value => value.renameAgent)
  const active = sessions.some(session => session.active)
  const running = sessions.some(session => session.running)
  const unread = sessions.some(session => session.unread === true) || (marked === true && !active)
  useMarkedUnread(agent.id, active, marked, actions)
  const preview = sessions[0]?.title ?? t('New session')
  const label = ['Agent', running ? t('Working') : '', unread ? t('Unread activity') : ''].filter(Boolean).join(', ')
  const open = active && wide
  return (
    <div className='bt-agent'>
      <button
        type='button'
        className={running ? 'bt-row bt-busy' : 'bt-row'}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-agent-id={agent.id}
        title={wide ? undefined : 'Agent'}
        onClick={() => actions.openAgent(agent.id)}
        onContextMenu={event => {
          event.preventDefault()
          actions.openMenu({ kind: 'agent', id: agent.id, x: event.clientX, y: event.clientY })
        }}>
        <span className={`bt-agent-ava${running ? ' bt-run' : ''}`}>{h(FishLogo, { size: 22 })}</span>
        {wide ? (
          <span className='bt-row-body'>
            <span className='bt-row-name'>{t('Agent')}</span>
            {preview ? <span className='bt-row-preview'>{preview}</span> : null}
          </span>
        ) : null}
        {wide && unread && !active ? <span className='bt-unread' aria-hidden /> : null}
      </button>
      <div className='bt-agent-sub' data-open={open || undefined}>
        <div className='bt-agent-sub-in'>
          <button
            type='button'
            className='bt-agent-sub-row bt-agent-new'
            style={{ '--i': 0 }}
            onClick={() => {
              void actions.newAgentSession(agent.id).catch(error => actions.reportError(error, 'agent-session'))
            }}>
            <PlusIcon />
            <span className='bt-agent-sub-title'>{t('New session')}</span>
          </button>
          {sessions.map((session, index) => (
            <AgentSessionRow
              key={session.id}
              session={session}
              agent={agent}
              actions={actions}
              index={index + 1}
              renaming={renaming === session.id}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

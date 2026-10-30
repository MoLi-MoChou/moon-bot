import { createElement as h, useLayoutEffect, useState } from 'react'
import { BotMark } from './mark.tsx'
import { Elapsed } from './cells.ts'
import { t } from './i18n.ts'
import type { ReactNode } from 'react'
import type { MarkBot } from './mark.tsx'

/** What a Bot is doing, as the shell's work table keeps it. */
export interface WorkDoing {
  readonly botId?: string | undefined
  readonly roomId?: string | undefined
  readonly since?: number | undefined
  readonly speaking?: boolean | undefined
  readonly switching?: boolean | undefined
  readonly tool?: string | undefined
}
/** A tool call a group turn waits on before it goes on. */
export interface Approval {
  readonly id: string
  readonly botId: string
  readonly at?: number | undefined
  readonly tool?: string | undefined
  readonly reason?: string | undefined
  readonly answerable?: boolean | undefined
  readonly detail?:
    | {
        readonly text?: string | undefined
        readonly code?: string | undefined
      }
    | undefined
}
/** The shell's work table: what each Bot and each group is busy with right now. */
export interface WorkTable {
  readonly bots?: Record<string, WorkDoing | undefined> | undefined
  readonly rooms?: Record<string, readonly WorkDoing[] | undefined> | undefined
  readonly approvals?: readonly Approval[] | undefined
}
export interface Room {
  readonly id: string
  readonly name: string
  readonly members: readonly string[]
}
export interface MemberBot extends MarkBot {
  readonly id: string
  name: string
  role?: string | null | undefined
}
export interface Roster {
  readonly byId: Record<string, MemberBot | undefined>
  readonly roomsById?: Record<string, Room | undefined> | undefined
}
export type StoreHook<T> = <R>(select: (state: T) => R) => R
/** One member of a group, with what it is doing and what it waits on. */
export interface MemberEntry {
  readonly id: string
  readonly approvals: Approval[]
  readonly doing: WorkDoing | undefined
  readonly here: boolean
  readonly state: 'ask' | 'work' | 'idle'
}
export interface BusyEntry extends MemberEntry {
  readonly bot: MemberBot
}
/** What the capsule outlives the work with, as plain data. */
export interface DockModel {
  readonly open: {
    readonly details?: string | undefined
    readonly session?: string | undefined
  }
  readonly faces: readonly {
    readonly id: string
    readonly ask: boolean
    readonly state: string
  }[]
  readonly waiting: string
  readonly doing: string
}
export interface ApprovalActions {
  answerApproval: (id: string, choice: string) => Promise<unknown>
  openSession: (id: string) => void
  reportError: (error: unknown, where?: string) => void
}
export interface MemberActions {
  showDetails: (id: string) => void
  openSession: (id: string) => void
  answerApproval: (id: string, choice: string) => Promise<unknown>
  stopMemberWork: (roomId: string, botId: string) => Promise<unknown>
  reportError: (error: unknown, where?: string) => void
}
// -------------------------------------------------------------------------
// What a group's members are doing: above the group's composer, one capsule for the
// members at work or waiting for an approval; above a Bot's own composer, one for the
// groups it is at work in; and per member in the details panel, where the approvals
// their group turns wait on are answered.
export const NO_WORK: WorkTable = { bots: {}, rooms: {}, approvals: [] }
export const FACES_MAX = 3
export const DOCK_EXIT_MS = 160
// The capsule leaves out the round's current speaker, which its round shows.
export const dockMembers = (busy: readonly BusyEntry[]): BusyEntry[] =>
  busy.filter(entry => !(entry.state === 'work' && entry.here && entry.doing?.speaking === true))
export function Face({ bot, ask, state }: { bot: MemberBot; ask: boolean; state: string }) {
  return (
    <span className='bt-mw-face' data-ask={ask || undefined}>
      <BotMark bot={bot} size={20} state={ask ? 'alert' : state} />
    </span>
  )
}
// The capsule springs to the width of what it says; it is measured, so the spring runs
// between two real widths. A capsule that comes back starts from its own width.
export function useFitWidth(inner: React.RefObject<HTMLSpanElement | null>, key: string | null): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    setWidth(key && inner.current ? inner.current.offsetWidth : null)
  }, [key])
  return width
}
// The clock stays whole at the end; only what comes before it is cut.
export const stateLine = (className: string, at: number | undefined, ...what: readonly ReactNode[]): ReactNode => (
  <span className={className}>
    <span className='bt-member-what'>{...what}</span>
    {typeof at === 'number' ? <Elapsed at={at} className='bt-member-time' /> : null}
  </span>
)
export function ApprovalCard({
  approval,
  bot,
  actions,
}: {
  approval: Approval
  bot: MemberBot
  actions: ApprovalActions
}) {
  const [busy, setBusy] = useState(false)
  const answer = (choice: string): void => {
    setBusy(true)
    void Promise.resolve(actions.answerApproval(approval.id, choice))
      .catch(error => actions.reportError(error, 'approval'))
      .finally(() => setBusy(false))
  }
  return (
    <div
      className='bt-mw-card'
      role='group'
      aria-label={t('{name} is waiting for your approval', { name: bot.name })}
      onKeyDown={event => {
        if (event.key === 'Escape' && approval.answerable && !busy) {
          event.preventDefault()
          event.stopPropagation()
          answer('reject')
        }
      }}>
      <div className='bt-mw-tool'>{approval.tool}</div>
      {approval.detail?.text ? <div className='bt-mw-text'>{approval.detail.text}</div> : null}
      {approval.reason ? <div className='bt-mw-reason'>{approval.reason}</div> : null}
      {approval.detail?.code ? (
        <code className='bt-mw-code' title={approval.detail.code}>
          {approval.detail.code}
        </code>
      ) : null}
      {approval.answerable ? (
        <div className='bt-mw-actions'>
          <button type='button' className='bt-q-btn' disabled={busy} onClick={() => answer('reject')}>
            {t('Reject')}
          </button>
          <button type='button' className='bt-q-submit' disabled={busy} onClick={() => answer('allow')}>
            {t('Allow once')}
          </button>
        </div>
      ) : (
        <div className='bt-mw-actions'>
          <button type='button' className='bt-q-btn' onClick={() => actions.openSession(bot.id)}>
            {t("Open {name}'s chat", { name: bot.name })}
          </button>
        </div>
      )}
    </div>
  )
}

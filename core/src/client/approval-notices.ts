import { t } from './i18n.ts'

interface ApprovalEntry { id: string; at?: number; tool?: string; botId: string; roomId?: string; sessionId?: string }
export interface ApprovalWork { getSnapshot(): { approvals?: readonly ApprovalEntry[] }; subscribe(listener: () => void): () => void }
export interface ApprovalRoster {
  getSnapshot(): {
    byId?: Record<string, { name?: string } | undefined>
    roomsById?: Record<string, { name?: string } | undefined>
  }
}

export interface ApprovalNoticeOptions {
  work: ApprovalWork
  roster: ApprovalRoster
  shownSession: () => string | null | undefined
  openSession: (id: string) => void
  since?: number
}

// A system notification for each approval that starts waiting while this window is in
// the background or shows another conversation. Only where the platform already allows
// notifications: DS Bot never asks for the permission.
export function noticeApprovals({ work, roster, shownSession, openSession, since = Date.now() }: ApprovalNoticeOptions): () => void {
  const told = new Set<string>()
  const notify = (): void => {
    const approvals = work.getSnapshot().approvals ?? []
    for (const id of told) {
      if (!approvals.some(entry => entry.id === id)) told.delete(id)
    }
    if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
    for (const entry of approvals) {
      if (told.has(entry.id)) continue
      told.add(entry.id)
      // Waiting before this window opened is no news: the sidebar shows it.
      if ((entry.at ?? 0) < since) continue
      const place = entry.roomId ?? entry.sessionId
      if (document.visibilityState === 'visible' && shownSession() === place) continue
      const snapshot = roster.getSnapshot()
      const room = entry.roomId !== undefined ? snapshot.roomsById?.[entry.roomId] : undefined
      const note = new Notification(t('{name} is waiting for your approval', { name: snapshot.byId?.[entry.botId]?.name ?? t('A Bot') }), {
        body: [room?.name, entry.tool].filter(Boolean).join(' · '),
        tag: `moon-bot-approval-${entry.id}`,
      })
      note.onclick = () => {
        window.focus()
        openSession(entry.roomId ?? entry.botId)
        note.close()
      }
    }
  }
  notify()
  return work.subscribe(notify)
}

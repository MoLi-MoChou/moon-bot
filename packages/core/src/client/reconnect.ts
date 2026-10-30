// Keeping the window honest about a lost connection. The roster poll is the only way the
// window learns what the team does, so a run of failed polls means the page is stale; the
// notice says so at the top, and disappears once a poll succeeds again.
import { t } from './i18n.ts'

// One missed poll is ordinary (a restart, a laptop waking); two in a row means something
// is really down, and only then is the user told.
export const RETRY_AFTER = 2
const NOTICE_ID = 'bt-reconnect'

// What the top notice says after `failures` failed polls in a row, or null when there is
// nothing worth telling.
export function retryNotice(failures: number): string | null {
  if (failures < RETRY_AFTER) return null
  return `${t('Reconnecting…')} ${t('Chats stay saved; this window catches up when the connection is back.')}`
}

// Shows `text` in the notice, or removes the notice when `text` is null. Rendering nothing
// outside a browser keeps the poll usable from a test or a headless run.
export function showReconnectNotice(text: string | null): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(NOTICE_ID)
  if (text === null) {
    existing?.remove()
    return
  }
  if (existing !== null) {
    if (existing.textContent !== text) existing.textContent = text
    return
  }
  const notice = document.createElement('div')
  notice.id = NOTICE_ID
  notice.className = 'bt-reconnect'
  notice.setAttribute('role', 'status')
  notice.setAttribute('aria-live', 'polite')
  notice.textContent = text
  document.body.appendChild(notice)
}

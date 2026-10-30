// Create one Electron webview guest for a Bot browser tab.
import { BLOCKED, blockedAddress } from './bot-browsers-address.ts'
import type { BrowserPage, GuestEntry } from './bot-browsers-types.ts'

export interface CreateGuestDeps {
  // Desktop browser bridge — typed loosely so the ambient DshBrowserBridge assigns.
  bridge: {
    acquire: (key: string) => Promise<{ lease: string; partition: string }>
    release: (lease: string) => Promise<unknown>
    onOpenRequested: (lease: string, cb: (url: string) => void) => () => void
  }
  doc: Document
  views: Map<string, GuestEntry>
  owner: Map<string, string>
  pages: { getSnapshot: () => Record<string, BrowserPage | undefined> }
  publish: (tabId: string, patch: Partial<BrowserPage>) => void
  savedTab: (botId: string | undefined, tabId: string) => { url: string } | undefined
  observe: (entry: GuestEntry) => void
  preview: (tabId: string) => Promise<boolean>
  openTab: (botId: string, url?: string) => string
  ensureLayer: () => HTMLDivElement
  place: (entry: GuestEntry) => void
  release: (tabId: string) => Promise<void>
  getDisposed: () => boolean
}

export async function createGuest(tabId: string, deps: CreateGuestDeps): Promise<GuestEntry | undefined> {
  const {
    bridge, doc, views, owner, pages, publish, savedTab, observe, preview, openTab, ensureLayer, place, release, getDisposed,
  } = deps

  const botId = owner.get(tabId) ?? ''
  const reservation = await bridge.acquire(`bot:${botId}`)
  if (getDisposed()) { await bridge.release(reservation.lease).catch(() => {}); return undefined }
  const element = doc.createElement('webview')
  // The shell forwards app shortcuts from a focused webview that carries these
  // attributes, as it does for its own Sidebar browser.
  element.dataset.sidebarBrowserFrame = 'webview'
  Object.assign(element.style, { position: 'fixed', display: 'flex', border: '0', pointerEvents: 'auto', background: '#fff' })
  element.dataset.btBrowser = tabId
  element.setAttribute('name', reservation.lease)
  element.setAttribute('partition', reservation.partition)
  element.setAttribute('allowpopups', '')
  element.setAttribute('src', `about:blank#${reservation.lease}`)
  const lifetime = new AbortController()
  const entry: GuestEntry = {
    botId, tabId, element, lease: reservation.lease, ready: false, fresh: true,
    pending: pages.getSnapshot()[tabId]?.url || savedTab(botId, tabId)?.url, usedAt: Date.now(),
    stop: () => lifetime.abort(),
  }
  const { signal } = lifetime
  // A page that asks for a new window gets a new tab in the same Bot, activated.
  const unsubscribe = bridge.onOpenRequested(reservation.lease, url => void openTab(botId, url))
  signal.addEventListener('abort', unsubscribe, { once: true })
  element.addEventListener('dom-ready', () => {
    entry.ready = true
    observe(entry)
    if (entry.pending) {
      const url = entry.pending
      entry.pending = undefined
      void element.loadURL(url).catch(() => {})
    }
  }, { signal })
  for (const name of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) {
    element.addEventListener(name, () => observe(entry), { signal })
  }
  element.addEventListener('did-stop-loading', () => { void preview(tabId) }, { signal })
  element.addEventListener('page-favicon-updated', (event) => {
    const favicon = event.favicons?.[0]
    // The tab strip renders in the outer renderer, outside the Bot's webview
    // partition; only self-contained icons may load there, the rest stay globes.
    if (typeof favicon === 'string' && favicon.startsWith('data:')) publish(tabId, { favicon })
  }, { signal })
  element.addEventListener('did-start-navigation', (event) => {
    if (!event.isMainFrame) return
    if (blockedAddress(event.url)) {
      element.stop()
      publish(tabId, { loading: false, error: BLOCKED })
      return
    }
    publish(tabId, { loading: true, error: null })
  }, { signal })
  element.addEventListener('did-fail-load', (event) => {
    // -3 is an aborted load: another navigation replaced it.
    if (event.isMainFrame && event.errorCode !== -3) publish(tabId, { loading: false, error: event.errorDescription || `Error ${event.errorCode}` })
  }, { signal })
  element.addEventListener('render-process-gone', () => {
    // A gone renderer while the entry is still live is a crash: drop the guest
    // and leave a retryable error, since the open effect will not fire again
    // for an unchanged tab. (Closing a tab removes the entry first, so its own
    // teardown never lands here.)
    if (views.get(tabId) === undefined) return
    void release(tabId)
    publish(tabId, { loading: false, error: 'The page crashed.' })
  }, { signal })
  views.set(tabId, entry)
  ensureLayer().append(element)
  place(entry)
  publish(tabId, { live: true, loading: Boolean(entry.pending) })
  return entry
}

// One acquisition at a time per tab.

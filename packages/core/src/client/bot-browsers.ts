// Bot browsers in the Desktop app: per Bot, a tab strip of pages.
import { READ_PAGE_SCRIPT } from './read-page.ts'
import { setEntry, sharedMap } from './shared-map.ts'
import type {
  BotBrowsers, BrowserPage, BrowserPages, BrowserRead, BrowserTabsMap, CreateBotBrowsersOptions,
  GuestEntry, PanelRect, SavedBot, SavedBots, SavedTab,
} from './bot-browsers-types.ts'
import {
  BLOCKED, EMPTY, MAX_LIVE, PREVIEW_SCRIPT, PREVIEW_TIMEOUT_MS, READ_TIMEOUT_MS,
  RESIZE_LATER_MS, STORE_KEY, blockedAddress, browserAddress,
} from './bot-browsers-address.ts'
import { createGuest } from './bot-browsers-guest.ts'
export { READ_PAGE_SCRIPT } from './read-page.ts'
export type {
  BotBrowsers, BrowserPage, BrowserPages, BrowserRead, BrowserReadItem, BrowserReadRequest,
  BrowserReadAnswer, BrowserTabs, BrowserTabsMap, CreateBotBrowsersOptions, PanelRect,
} from './bot-browsers-types.ts'
export { PREVIEW_SCRIPT, blockedAddress, browserAddress } from './bot-browsers-address.ts'
export { serveBrowserReads } from './bot-browsers-serve.ts'
export type { ServeBrowserReadsOptions } from './bot-browsers-serve.ts'
export function createBotBrowsers({ bridge, createSource, storage = globalThis.localStorage, document: doc = globalThis.document }: CreateBotBrowsersOptions): BotBrowsers {
  const views = new Map<string, GuestEntry>()
  /** tabId -> owning Bot id */
  const owner = new Map<string, string>()
  // Per Bot: { ids: [tabId...], active: tabId | null }.
  const tabs = createSource<BrowserTabsMap>({})
  // Per tab: { url, title, favicon, loading, canGoBack, canGoForward, error, live, readAt?, excerpt }
  const pages = createSource<BrowserPages>({})
  // Per Bot, what survives a reload: { tabs: [{id,url,title}], active }. Another window
  // saves its own Bots' tabs into the same object.
  const store = sharedMap<SavedBots>(STORE_KEY, storage)
  let saved = store.read()
  let layer: HTMLDivElement | undefined
  let shown: string | null = null
  // The last panel rectangle sizes every guest, shown or not; `visible` says whether the
  // shown tab's guest is on screen.
  let rect: PanelRect | null = null
  let visible = false
  let resizeLater: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let serial = 0
  const savedTab = (botId: string | undefined, tabId: string): SavedTab | undefined => (botId === undefined ? undefined : saved[botId]?.tabs.find(entry => entry.id === tabId))
  const publish = (tabId: string, patch: Partial<BrowserPage>): void => pages.set((state) => {
    const botId = owner.get(tabId)
    return { ...state, [tabId]: { ...EMPTY, ...savedTab(botId, tabId), ...state[tabId], ...patch } }
  })
  const save = (botId: string, entry: SavedBot | undefined): void => { saved = store.update(stored => setEntry(stored, botId, entry), saved) }
  const persist = (botId: string): void => {
    const state = tabs.getSnapshot()[botId]
    const snapshot = pages.getSnapshot()
    save(botId, state && {
      tabs: state.ids.map(id => ({ id, url: snapshot[id]?.url ?? '', title: snapshot[id]?.title ?? '' })),
      active: state.active,
    })
  }

  // Saved tabs come back as placeholders: they show in the strip and open their
  // guest only when the panel puts them on screen.
  const ensureTabs = (botId: string): void => {
    if (tabs.getSnapshot()[botId] !== undefined) return
    const entries = saved[botId]?.tabs ?? []
    const ids = entries.map(entry => entry.id)
    const savedActive = saved[botId]?.active ?? null
    const active = savedActive !== null && ids.includes(savedActive) ? savedActive : (ids.at(-1) ?? null)
    for (const entry of entries) owner.set(entry.id, botId)
    tabs.set(state => ({ ...state, [botId]: { ids, active } }))
    for (const entry of entries) publish(entry.id, { url: entry.url ?? '', title: entry.title ?? '', live: false })
  }

  const ensureLayer = (): HTMLDivElement => {
    const current = layer
    if (current?.isConnected) return current
    layer = doc.createElement('div')
    layer.className = 'bt-browser-layer'
    // Inline, not in BROWSER_CSS: Agent mode withdraws the Bot styles, and the
    // webviews must stay out of the page flow then too.
    Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '41', pointerEvents: 'none' })
    doc.body.append(layer)
    return layer
  }

  const place = (entry: GuestEntry): void => {
    const box = rect ?? { left: 0, top: 0, width: 800, height: 600 }
    Object.assign(entry.element.style, {
      left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      visibility: shown === entry.tabId && visible && rect ? 'visible' : 'hidden',
    })
  }

  // A settled page leaves a short excerpt for the drawer cards, shown or hidden; a
  // failed or empty read keeps the excerpt the tab already has.
  async function preview(tabId: string): Promise<boolean> {
    const entry = views.get(tabId)
    if (entry === undefined || !entry.ready || !/^https?:/i.test(entry.element.getURL())) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), PREVIEW_TIMEOUT_MS) })
    try {
      const excerpt = await Promise.race([entry.element.executeJavaScript<string>(PREVIEW_SCRIPT), timeout])
      if (typeof excerpt !== 'string' || excerpt === '' || views.get(tabId) !== entry) return false
      publish(tabId, { excerpt })
      return true
    } catch { return false } finally { clearTimeout(timer) }
  }

  const observe = (entry: GuestEntry): void => {
    const { element } = entry
    if (!entry.ready) return
    const url = element.getURL()
    if (url.startsWith('about:blank#')) return
    if (entry.fresh) {
      // The lease-bearing bootstrap document is not a history entry.
      element.clearHistory()
      entry.fresh = false
    }
    const title = element.getTitle()
    publish(entry.tabId, { url, title, loading: element.isLoading(), canGoBack: element.canGoBack(), canGoForward: element.canGoForward(), live: true })
    persist(entry.botId)
  }

  async function create(tabId: string): Promise<GuestEntry | undefined> {
    return createGuest(tabId, {
      bridge, doc, views, owner, pages, publish, savedTab, observe, preview, openTab, ensureLayer, place, release,
      getDisposed: () => disposed,
    })
  }

  const opening = new Map<string, Promise<GuestEntry | undefined>>()
  function open(tabId: string): Promise<GuestEntry | undefined> {
    const entry = views.get(tabId)
    if (entry) return Promise.resolve(entry)
    let job = opening.get(tabId)
    if (job === undefined) {
      // A refused lease (the Desktop's browser service is not up yet, or the
      // acquire failed) leaves the tab with an error it can retry from; the
      // job resolves undefined instead of rejecting, so no caller drops one.
      job = create(tabId)
        .catch((error: unknown) => {
          console.warn('[moon-bot] browser acquire', error)
          const failure = error as { message?: unknown }
          publish(tabId, { loading: false, error: String(failure?.message ?? error) })
          return undefined
        })
        .finally(() => { opening.delete(tabId) })
      opening.set(tabId, job)
      void job.then(() => trim())
    }
    return job
  }

  // Release the least recently shown guests beyond the limit, never the one on screen.
  function trim(): void {
    const idle = [...views.values()].filter(entry => entry.tabId !== shown).sort((a, b) => a.usedAt - b.usedAt)
    while (views.size > MAX_LIVE && idle.length > 0) {
      const entry = idle.shift()
      if (entry !== undefined) void release(entry.tabId)
    }
  }

  async function release(tabId: string): Promise<void> {
    const entry = views.get(tabId)
    if (entry === undefined) return
    views.delete(tabId)
    entry.stop()
    entry.element.remove()
    publish(tabId, { live: false, loading: false })
    await bridge.release(entry.lease).catch(error => console.warn('[moon-bot] browser release', error))
  }

  function openTab(botId: string, url?: string): string {
    ensureTabs(botId)
    const tabId = `t${Date.now().toString(36)}-${++serial}`
    owner.set(tabId, botId)
    tabs.set((state) => {
      const own = state[botId] ?? { ids: [], active: null }
      return { ...state, [botId]: { ids: [...own.ids, tabId], active: tabId } }
    })
    publish(tabId, { url: '', title: '', live: false })
    if (typeof url === 'string' && url !== '') void navigate(tabId, url)
    persist(botId)
    return tabId
  }

  async function closeTab(botId: string, tabId: string): Promise<void> {
    const state = tabs.getSnapshot()[botId]
    if (state === undefined || !state.ids.includes(tabId)) return
    await opening.get(tabId)?.catch(() => {})
    if (shown === tabId) await show(null)
    await release(tabId)
    // The waits above can overlap a new tab or an active-tab switch; drop the
    // target from the latest state, not the snapshot taken before them.
    tabs.set((snapshot) => {
      const current = snapshot[botId]
      if (current === undefined || !current.ids.includes(tabId)) return snapshot
      const at = current.ids.indexOf(tabId)
      const ids = current.ids.filter(id => id !== tabId)
      // The tab after the closed one takes over; closing the last picks the new last.
      const active = current.active === tabId ? (ids[Math.min(at, ids.length - 1)] ?? null) : current.active
      const next = { ...snapshot }
      if (ids.length === 0) delete next[botId]
      else next[botId] = { ids, active }
      return next
    })
    owner.delete(tabId)
    pages.set((snapshot) => {
      if (snapshot[tabId] === undefined) return snapshot
      const { [tabId]: _dropped, ...rest } = snapshot
      return rest
    })
    persist(botId)
  }

  function activate(botId: string, tabId: string): void {
    ensureTabs(botId)
    const state = tabs.getSnapshot()[botId]
    if (state === undefined || !state.ids.includes(tabId) || state.active === tabId) return
    tabs.set(snapshot => ({ ...snapshot, [botId]: { ...state, active: tabId } }))
    persist(botId)
  }

  const activeTab = (botId: string): string | null => tabs.getSnapshot()[botId]?.active ?? null

  /**
   * Select the tab whose guest goes on screen, or none with `null`. With a `box`
   * (viewport pixels) its guest is placed there; without one it stays hidden, as
   * while the panel slides in or shows its own empty or error state.
   */
  async function show(tabId: string | null, box: PanelRect | null = null): Promise<void> {
    // The shown guest only moved (the panel is being dragged): it follows at once, the
    // hidden ones take the new size once the rectangle stops changing.
    if (tabId !== null && tabId === shown && visible && box !== null) {
      rect = box
      const entry = views.get(tabId)
      if (entry) place(entry)
      clearTimeout(resizeLater)
      resizeLater = setTimeout(() => { for (const other of views.values()) place(other) }, RESIZE_LATER_MS)
      return
    }
    shown = tabId
    if (box) rect = box
    visible = tabId !== null && box !== null
    for (const entry of views.values()) place(entry)
    if (tabId === null) return
    const entry = await open(tabId)
    if (entry === undefined || shown !== tabId) return
    entry.usedAt = Date.now()
    place(entry)
  }

  async function navigate(tabId: string, input: string): Promise<boolean> {
    const url = browserAddress(input)
    if (url === null || blockedAddress(url)) {
      publish(tabId, { error: url === null ? 'Only http and https addresses open here.' : BLOCKED })
      return false
    }
    const entry = await open(tabId)
    if (entry === undefined) return false
    publish(tabId, { url, loading: true, error: null })
    persist(owner.get(tabId) ?? '')
    if (!entry.ready) entry.pending = url
    else void entry.element.loadURL(url).catch(() => {})
    return true
  }

  /** A deleted Bot: close its tabs and drop its saved strip. */
  async function forget(botId: string): Promise<void> {
    ensureTabs(botId)
    for (const tabId of tabs.getSnapshot()[botId]?.ids ?? []) {
      await opening.get(tabId)?.catch(() => {})
      if (shown === tabId) await show(null)
      await release(tabId)
      owner.delete(tabId)
      pages.set((snapshot) => {
        if (snapshot[tabId] === undefined) return snapshot
        const { [tabId]: _dropped, ...rest } = snapshot
        return rest
      })
    }
    tabs.set((snapshot) => {
      if (snapshot[botId] === undefined) return snapshot
      const { [botId]: _dropped, ...rest } = snapshot
      return rest
    })
    save(botId, undefined)
  }

  return {
    tabs,
    pages,
    ensureTabs,
    openTab,
    closeTab,
    activate,
    preview,
    show,
    navigate,
    command(tabId: string, name: string): void {
      const entry = views.get(tabId)
      if (!entry?.ready) return
      if (name === 'back' && entry.element.canGoBack()) entry.element.goBack()
      else if (name === 'forward' && entry.element.canGoForward()) entry.element.goForward()
      else if (name === 'reload') entry.element.reload()
      else if (name === 'stop') entry.element.stop()
    },
    focus(tabId: string): void { views.get(tabId)?.element.focus() },
    openPages(): Record<string, { url: string; title: string }> {
      const open: Record<string, { url: string; title: string }> = {}
      const snapshot = pages.getSnapshot()
      for (const [botId, state] of Object.entries(tabs.getSnapshot())) {
        const tabId = state.active
        const entry = tabId ? views.get(tabId) : undefined
        const page = tabId ? snapshot[tabId] : undefined
        if (entry?.ready && page?.url) open[botId] = { url: page.url, title: page.title }
      }
      return open
    },
    async read(botId: string): Promise<BrowserRead> {
      const tabId = activeTab(botId)
      const entry = tabId ? views.get(tabId) : undefined
      if (!entry?.ready) throw new Error('This Bot has no browser page open.')
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The page took too long to read.')), READ_TIMEOUT_MS) })
      try {
        return await Promise.race([entry.element.executeJavaScript<BrowserRead>(READ_PAGE_SCRIPT), timeout])
      } finally {
        clearTimeout(timer)
      }
    },
    noteRead(botId: string): void {
      const tabId = activeTab(botId)
      if (tabId) publish(tabId, { readAt: Date.now() })
    },
    release,
    forget,
    retain(botIds: readonly string[]): Promise<unknown> {
      const keep = new Set(botIds)
      const known = new Set<string>([...Object.keys(tabs.getSnapshot()), ...Object.keys(saved), ...owner.values()])
      for (const entry of views.values()) known.add(entry.botId)
      return Promise.all([...known].filter(botId => !keep.has(botId)).map(forget))
    },
    dispose(): void {
      disposed = true
      clearTimeout(resizeLater)
      for (const entry of views.values()) void release(entry.tabId)
      layer?.remove()
    },
  }
}


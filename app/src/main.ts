// Electron main process: one window for the Bot team, served by the app's own DSH Host.
// The window loads the Host's loopback address as DSH Web does: DSH's sign-in sends the page's
// origin as the address the browser comes back to, and accepts only a loopback one.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { release } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import electronUpdater from 'electron-updater'
import { chooseLocations, localeText, programFolder, saveLocations, text } from './first-run.ts'
import type { SavedPlaces } from './first-run.ts'
import { hostPort } from './host-port.ts'
import { HostProcess } from './host-process.ts'
import { copySessions, findTeam, importTeam, teamInUse, userDshHome, type ImportChoice } from './import.ts'
import { copyData, moveProblem, type MoveProblem } from './move-data.ts'
import { CHECK_PROFILE, PROFILE } from './profile.ts'
import { UPDATE_TEXT, watchReleases, watchUpdates, type UpdateFound, type UpdateWatch } from './updates.ts'
import { needsNoSandbox } from './sandbox.ts'
import { engineFor, engineReady, enginesModules, ensureEngine, type EngineProgress } from './engines.ts'
import { CAPTION_HEIGHT, cssColor, micaAvailable, nativeThemeSource } from './window-frame.ts'

const IPC = {
  caption: 'ds-bot:caption-colors', nativeTheme: 'ds-bot:native-theme', fullscreen: 'ds-bot:fullscreen',
  dataLocation: 'ds-bot:data-location', moveData: 'ds-bot:move-data', teamWorkspace: 'ds-bot:team-workspace',
  updateState: 'ds-bot:update-state', updateCheck: 'ds-bot:update-check', updateInstall: 'ds-bot:update-install', updateChanged: 'ds-bot:update-changed',
  engineState: 'ds-bot:engine-state', engineDownload: 'ds-bot:engine-download', engineChanged: 'ds-bot:engine-changed',
} as const
const MOVE_PROBLEMS: Readonly<Record<Exclude<MoveProblem, 'dsh'>, 'moveDrive' | 'moveNested' | 'moveWorkspace' | 'inProgram' | 'moveNotEmpty'>> = { drive: 'moveDrive', nested: 'moveNested', workspace: 'moveWorkspace', program: 'inProgram', notEmpty: 'moveNotEmpty' }
const UPDATE_CHECK_WAIT_MS = 15_000
const UPDATE_DOWNLOAD_WAIT_MS = 15 * 60_000

const here = dirname(fileURLToPath(import.meta.url))
// This file ships bundled into dist-main; the source-run Hosts, the preload script and the
// window resources stay where the sources are.
const srcDir = join(here, '..', 'src')
// Drawn by scripts/icon.mjs. Windows takes the .ico for its several sizes.
const iconFile = join(here, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
// Windows 11 draws Mica behind the page; mica.css lets it through the sidebar.
const mica = micaAvailable(process.platform, release())
if (process.env.DS_BOT_SHELL_DATA) app.setPath('userData', process.env.DS_BOT_SHELL_DATA)
if (needsNoSandbox()) app.commandLine.appendSwitch('no-sandbox')

let mainWindow: BrowserWindow | undefined
let host: HostProcess | undefined
// The Host's loopback origin, which the window loads.
let origin: string
let hostStop: Promise<void> | undefined
let updates: UpdateWatch | undefined
let stopping = false
let stopped = false
let failed = false
let places: { dataDir: string; workspace: string | undefined }
// Quitting while a first-run dialog is open stops the first run, and during the copy (of the
// first run or of a data move) it waits for the copy to stop at a safe point, so that it leaves
// no half team and no temporary copy.
let choosing: AbortController | undefined
let copying: Promise<unknown> | undefined
const copyAbort = new AbortController()

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', focusWindow)
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (choosing !== undefined) {
      event.preventDefault()
      choosing.abort()
      return
    }
    if (copying !== undefined) {
      event.preventDefault()
      if (copyAbort.signal.aborted) return
      copyAbort.abort()
      void copying.finally(() => { copying = undefined; app.quit() })
      return
    }
    if (stopped || host === undefined) return
    event.preventDefault()
    if (stopping) return
    void stopHost().then(() => { app.quit() })
  })
  app.whenReady().then(start).catch(fail)
}

function stopHost(): Promise<void> {
  stopping = true
  hostStop ??= (host?.stop() ?? Promise.resolve()).catch((error: unknown) => { console.error(error) }).finally(() => { stopped = true })
  return hostStop
}

async function start(): Promise<void> {
  choosing = new AbortController()
  const where = await chooseLocations(choosing.signal).finally(() => { choosing = undefined })
  if ('quit' in where) { app.exit(0); return }
  places = { dataDir: where.dataDir, workspace: where.workspace }
  const port = await hostPort(join(app.getPath('userData'), 'host-port.json'))
  origin = `http://127.0.0.1:${String(port)}`
  const pnpm = join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  const profileDir = join(where.dataDir, 'profiles', PROFILE)
  mkdirSync(profileDir, { recursive: true })
  // The window's Host is Moon Bot's own service: same ready/fatal/shutdown protocol,
  // no DSH profile. The team data dir is its home; the workspace rides along as before.
  const newHost = (): HostProcess => new HostProcess({
    entry: join(srcDir, 'service-host.ts'),
    cwd: profileDir,
    env: { ...process.env, ...engineEnv(), MOON_BOT_DATA: where.dataDir, MOON_BOT_WEB_PORT: String(port), ...(where.workspace !== undefined ? { MOON_BOT_WORKSPACE: where.workspace } : {}) },
    pnpm,
    onFailure: fail,
  })
  // A failed check is not a failed start: start() rejects, and the copy goes on unchecked.
  const newCheck = (home: string, list: string): HostProcess => {
    const cwd = join(home, 'profiles', CHECK_PROFILE)
    mkdirSync(cwd, { recursive: true })
    return new HostProcess({ entry: join(srcDir, 'host.ts'), cwd, env: { ...process.env, DSH_HOME: home, DS_BOT_CHECK: list }, pnpm, onFailure: () => {} })
  }
  const ready = (async (): Promise<unknown> => {
    let copied: unknown
    if (where.import !== undefined) {
      copying = copyTeam(where, where.import, newHost, newCheck, copyAbort.signal)
      copied = await copying
      copying = undefined
    }
    if (copied === 'quit') app.exit(0)
    // The window may be waiting for the Host; it goes away with the app.
    if (copied !== undefined) return new Promise(() => {})
    // Not during the import, which a restart would cut short; before the Host, so that an
    // update can still come when this version's Host does not start.
    updates = startUpdates()
    host = newHost()
    // Moon Bot patch: fetch the Office engine once the app is up.
    setTimeout(() => { void downloadEngine() }, 20_000).unref?.()
    return host.start()
  })()
  void ready.catch(fail)
  // A throwaway run (DS_BOT_HOME) keeps its folders where it was told.
  const fixed = Boolean(process.env.DS_BOT_HOME)
  ipcMain.handle(IPC.engineState, (event) => { assertWindow(event); return engineState })
  ipcMain.handle(IPC.engineDownload, async (event) => { assertWindow(event); await downloadEngine(); return engineState })
  // Moon Bot patch: Settings > About drives the app's own updater.
  ipcMain.handle(IPC.updateState, (event) => { assertWindow(event); return updates?.state?.() ?? { phase: 'unsupported', current: app.getVersion(), reason: updateUnsupported() } })
  ipcMain.handle(IPC.updateCheck, async (event) => { assertWindow(event); if (updates?.check === undefined) return { phase: 'unsupported', current: app.getVersion(), reason: updateUnsupported() }; await updates.check(); return updates.state?.() })
  ipcMain.handle(IPC.updateInstall, async (event) => { assertWindow(event); if (updates?.state?.().phase === 'downloaded') await updates.install?.() })
  ipcMain.handle(IPC.dataLocation, (event) => {
    assertWindow(event)
    return { path: places.dataDir, fixed }
  })
  ipcMain.handle(IPC.moveData, (event, workspace: unknown) => {
    assertWindow(event)
    return fixed ? false : moveData(typeof workspace === 'string' && isAbsolute(workspace) ? workspace : places.workspace)
  })
  // The plugin keeps the team workspace; the app remembers it for its own checks.
  ipcMain.on(IPC.teamWorkspace, (event, path: unknown) => {
    if (fixed || !fromWindow(event) || typeof path !== 'string' || !isAbsolute(path)) return
    places = { ...places, workspace: path }
    saveLocations(places)
  })
  if (process.platform === 'win32') {
    // Windows ignores the alpha of the caption buttons' color, so they take the opaque color
    // of the surface under them, which the page measures.
    ipcMain.on(IPC.caption, (event, color: unknown, symbolColor: unknown) => {
      if (fromWindow(event) && cssColor(color) && cssColor(symbolColor)) mainWindow?.setTitleBarOverlay({ color, symbolColor })
    })
    // Mica and the caption buttons follow the app's theme, not only the system's.
    ipcMain.on(IPC.nativeTheme, (event, source: unknown) => {
      const value = nativeThemeSource(source)
      if (fromWindow(event) && value !== undefined) nativeTheme.themeSource = value
    })
  }

  setMenu()
  // A packaged app has the icon in its bundle; Electron's own run shows Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconFile)
  createWindow()
  // The launch URL trades its token for the Host's cookie and goes on to the page.
  void ready.then((started) => {
    if (typeof started === 'object' && started !== null && 'url' in started) mainWindow?.loadURL((started as { url: string }).url)
  }).catch(() => {})
}

// The Host starts once on the new data location first: DSH then sets up its project list
// without the copied Sessions' folders, so the old team's folders are not offered as projects.
// Before that, the app's own DSH reads every chat of the team once: a newer DSH can write
// records that this one refuses while the log format stays the same. Such a chat stops the
// copy, as a newer log format does; 'quit' means the user updates Moon Bot first, and
// 'stopped' that the app quit during the copy.
async function copyTeam(where: SavedPlaces, importing: ImportChoice, newHost: () => HostProcess, newCheck: (home: string, list: string) => HostProcess, signal: AbortSignal): Promise<'quit' | 'stopped' | undefined> {
  const unreadable = await checkTeam(importing, newCheck, signal)
  if (signal.aborted) return 'stopped'
  if (unreadable > 0) {
    const t = text()
    const { response } = await dialog.showMessageBox({ type: 'warning', title: 'Moon Bot', noLink: true, message: t.newer(unreadable), buttons: [t.quit, t.startEmpty], defaultId: 0, cancelId: 0, signal })
    if (signal.aborted) return 'stopped'
    if (response === 0) return 'quit'
    saveLocations(where)
    return undefined
  }
  const warm = newHost()
  host = warm
  const stopWarm = () => { void warm.stop() }
  signal.addEventListener('abort', stopWarm, { once: true })
  try {
    await warm.start()
    if (signal.aborted) return 'stopped'
    mainWindow?.setProgressBar(2)
    await warm.stop()
    host = undefined
    const summary = await importTeam({ ...importing, to: where.dataDir, workspace: where.workspace, dsh: getDshRuntimeVersion(), signal })
    console.log(`Moon Bot: copied ${String(summary.bots)} Bots and ${String(summary.sessions)} Sessions from ${summary.from}`)
  } catch (error) {
    if (signal.aborted) return 'stopped'
    console.error(error)
    await dialog.showMessageBox({ type: 'warning', title: 'Moon Bot', message: text().failed(error instanceof Error ? error.message : String(error)), signal })
    if (signal.aborted) return 'stopped'
  } finally {
    signal.removeEventListener('abort', stopWarm)
    mainWindow?.setProgressBar(-1)
  }
  saveLocations(where)
  return undefined
}

// A copy of the chats in a DSH home of its own, so that nothing of the check stays in the data.
async function checkTeam(importing: ImportChoice, newCheck: (home: string, list: string) => HostProcess, signal: AbortSignal): Promise<number> {
  // A run that was killed can leave its temporary check home behind.
  for (const name of readdirSync(places.dataDir).filter(entry => /^\.import-check-\d+$/u.test(entry))) {
    await rm(join(places.dataDir, name), { recursive: true, force: true }).catch((error: unknown) => { console.error(error) })
  }
  const home = join(places.dataDir, `.import-check-${String(Date.now())}`)
  try {
    const found = findTeam(importing.from)
    const ids = found === undefined ? [] : await copySessions(importing.from, found.team, home, signal)
    if (ids.length === 0) return 0
    mainWindow?.setProgressBar(2)
    const list = join(home, 'check.json')
    writeFileSync(list, JSON.stringify(ids))
    const check = newCheck(home, list)
    const stop = () => { void check.stop() }
    signal.addEventListener('abort', stop, { once: true })
    try {
      signal.throwIfAborted()
      const started = await check.start()
      if (!('unreadable' in started)) return 0
      const unreadable = started.unreadable
      if (unreadable.length > 0) console.warn(`Moon Bot: this DSH cannot read ${unreadable.join(', ')}`)
      return unreadable.length
    } finally {
      signal.removeEventListener('abort', stop)
      await check.stop()
    }
  } catch (error) {
    if (!signal.aborted) console.error('Moon Bot: the chats were not checked before the copy:', error)
    return 0
  } finally {
    mainWindow?.setProgressBar(-1)
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch((error: unknown) => { console.error(error) })
  }
}

// The data moves as a copy while the Host is stopped, and the app starts again on the new
// folder; after a failed copy it starts again on the old one. The old folder stays.
async function moveData(workspace: string | undefined): Promise<boolean> {
  if (copying !== undefined || stopping || mainWindow === undefined) return false
  const t = text()
  const owner = mainWindow
  const { canceled, filePaths } = await dialog.showOpenDialog(owner, { title: t.pickMove, defaultPath: dirname(places.dataDir), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
  if (canceled || filePaths[0] === undefined) return false
  const to = resolve(filePaths[0])
  const dshHome = userDshHome()
  // The team workspace can move while a dialog is open; the window tells the latest one.
  const refused = async (): Promise<boolean> => {
    for (const current of new Set([workspace, places.workspace])) {
      const problem = moveProblem({ from: places.dataDir, to, workspace: current, dshHome, program: app.isPackaged ? programFolder() : undefined })
      if (problem === undefined) continue
      await dialog.showMessageBox(owner, { type: 'warning', title: 'Moon Bot', message: problem === 'dsh' ? t.inDsh(dshHome) : t[MOVE_PROBLEMS[problem]], buttons: ['OK'] })
      return true
    }
    return false
  }
  if (await refused()) return false
  const { response } = await dialog.showMessageBox(owner, { type: 'question', title: 'Moon Bot', noLink: true, message: t.moveConfirm(to), detail: t.moveDetail(places.dataDir), buttons: [t.move, t.cancel], defaultId: 0, cancelId: 1 })
  if (response !== 0 || stopping || await refused()) return false
  const signal = copyAbort.signal
  copying = (async () => {
    // The settings go away first, so that nothing moves the team workspace from here on.
    void mainWindow?.loadURL(notePage(t.moving))
    await stopHost()
    // The app may have heard of a team workspace change while the Host stopped.
    if (await refused()) {
      app.relaunch()
      return
    }
    // Another DSH on the same data would go on writing while the copy is made.
    if (teamInUse(places.dataDir)) {
      await dialog.showMessageBox({ type: 'warning', title: 'Moon Bot', message: t.moveInUse })
      app.relaunch()
      return
    }
    mainWindow?.setProgressBar(2)
    try {
      await copyData(places.dataDir, to, signal)
      try {
        saveLocations({ dataDir: to, workspace: places.workspace ?? workspace })
      } catch (error) {
        // Unused, the copy would only keep the folder from being chosen again.
        await rm(to, { recursive: true, force: true, maxRetries: 5 }).catch((failure: unknown) => { console.error(failure) })
        throw error
      }
    } catch (error) {
      if (signal.aborted) return
      console.error(error)
      await dialog.showMessageBox({ type: 'warning', title: 'Moon Bot', message: t.moveFailed(error instanceof Error ? error.message : String(error)) })
    } finally {
      mainWindow?.setProgressBar(-1)
    }
    app.relaunch()
  })()
  await copying
  copying = undefined
  app.quit()
  return true
}

const notePage = (message: string): string => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<body style="margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText">${message.replace(/[&<>]/gu, char => `&#${String(char.charCodeAt(0))};`)}</body>`)}`

// Windows updates itself; macOS asks to download the new version. Throwaway runs check only a
// given feed and never ask.
function startUpdates(): UpdateWatch | undefined {
  const feed = process.env.DS_BOT_UPDATE_URL || undefined
  const throwaway = Boolean(process.env.DS_BOT_HOME)
  if (!app.isPackaged || (throwaway && feed === undefined)) return undefined
  if (process.platform === 'darwin') {
    return watchReleases({
      current: app.getVersion(), arch: process.arch, feed, ask: throwaway ? undefined : askDownload, open: url => shell.openExternal(url),
    })
  }
  // Moon Bot patch: the Linux AppImage updates itself in place too.
  if ((process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) || (process.platform === 'linux' && process.env.APPIMAGE)) {
    // Moon Bot releases are GitHub pre-releases, which /releases/latest skips.
    electronUpdater.autoUpdater.allowPrerelease = true
    return watchUpdates({
      updater: electronUpdater.autoUpdater, feed, ask: throwaway ? undefined : askRestart, beforeInstall: stopHost,
      onState: (state) => { if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.updateChanged, state) },
    })
  }
  return undefined
}

// Moon Bot patch: the Office-to-PDF engine is downloaded, not installed (engines.ts).
const enginesRoot = (): string => join(app.getPath('userData'), 'engines')
const engine = engineFor()
// In development, and in a build that still carries it, the engine is already there.
const engineBundled = (): boolean => engine !== undefined && existsSync(join(app.getAppPath(), 'node_modules', engine.name, 'package.json'))
const engineEnv = (): Record<string, string | undefined> => (engine === undefined || engineBundled() ? {} : { NODE_PATH: [enginesModules(enginesRoot()), process.env.NODE_PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') })
type EngineState = Partial<Omit<EngineProgress, 'phase'>> & {
  phase: EngineProgress['phase'] | 'unsupported' | 'idle' | 'error'
  error?: string | undefined
}
let engineState: EngineState = { phase: engine === undefined ? 'unsupported' : 'idle' }
let engineRun: Promise<void> | undefined
function setEngineState(patch: Partial<EngineState>): void {
  engineState = { ...engineState, ...patch }
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.engineChanged, engineState)
}
function downloadEngine(): Promise<void> {
  if (engine === undefined) return Promise.resolve()
  if (engineBundled() || engineReady(enginesRoot(), engine)) { setEngineState({ phase: 'ready', error: undefined }); return Promise.resolve() }
  engineRun ??= ensureEngine({ root: enginesRoot(), engine, onProgress: setEngineState })
    .then(() => setEngineState({ phase: 'ready', error: undefined }))
    .catch((error: unknown) => { console.error(`Moon Bot: ${error instanceof Error ? error.message : String(error)}`); setEngineState({ phase: 'error', error: error instanceof Error ? error.message.slice(0, 200) : String(error) }) })
    .finally(() => { engineRun = undefined })
  return engineRun
}

function updateUnsupported(): string {
  if (!app.isPackaged) return 'dev'
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) return 'portable'
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'package'
  if (process.platform === 'darwin') return 'mac'
  return 'off'
}

async function askRestart(version: string): Promise<boolean> {
  // After a failed start, fail() installs the update itself.
  if (failed) return false
  const t = localeText(UPDATE_TEXT)
  const options: Electron.MessageBoxOptions = { type: 'info', title: 'Moon Bot', message: t.ready(version), detail: t.readyDetail, buttons: [t.restart, t.later], defaultId: 0, cancelId: 1, noLink: true }
  const { response } = await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
  return response === 0
}

async function askDownload(version: string): Promise<boolean> {
  if (failed) return false
  const t = localeText(UPDATE_TEXT)
  const options: Electron.MessageBoxOptions = { type: 'info', title: 'Moon Bot', message: t.available(version), detail: t.availableDetail, buttons: [t.download, t.later], defaultId: 0, cancelId: 1, noLink: true }
  const { response } = await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
  return response === 0
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  const win32 = process.platform === 'win32'
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 720, minHeight: 480,
    title: 'Moon Bot', show: false, icon: iconFile,
    backgroundColor: mica ? '#00000000' : dark ? '#1b1b1c' : '#ffffff',
    // Frameless as in DSH Desktop: the caption buttons overlay the page's band. They keep the
    // sidebar's colors until the page sends the colors of the surface under them.
    ...(win32 ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: CAPTION_HEIGHT, color: dark ? '#1b1b1c' : '#f9fafb', symbolColor: dark ? '#f9fafb' : '#0f1115' },
      ...(mica ? { backgroundMaterial: 'mica' } : {}),
    } : {}),
    webPreferences: {
      preload: join(srcDir, 'preload.cjs'), contextIsolation: true, sandbox: true,
      additionalArguments: [`--ds-bot-origin=${origin}`, ...(win32 ? [`--ds-bot-caption=${String(CAPTION_HEIGHT)}`, ...(mica ? ['--ds-bot-mica'] : [])] : [])],
    },
  })
  mainWindow.once('ready-to-show', () => { mainWindow?.show() })
  mainWindow.on('page-title-updated', (event) => { event.preventDefault() })
  mainWindow.on('closed', () => { mainWindow = undefined })
  const contents = mainWindow.webContents
  if (win32) {
    // Fullscreen hides the caption buttons, and the page drops its band meanwhile. A reload
    // registers the page's listener again, so the state goes out after every load too.
    const sendFullscreen = () => { if (mainWindow !== undefined) contents.send(IPC.fullscreen, mainWindow.isFullScreen()) }
    mainWindow.on('enter-full-screen', sendFullscreen)
    mainWindow.on('leave-full-screen', sendFullscreen)
    contents.on('did-finish-load', sendFullscreen)
  }
  if (mica) {
    const css = readFileSync(join(srcDir, 'mica.css'), 'utf8')
    contents.on('dom-ready', () => { void contents.insertCSS(css) })
  }
  contents.setWindowOpenHandler(({ url }) => {
    // DSH's sign-in opens a blank window during the click and sends it to the sign-in page later.
    if (url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: { sandbox: true } } }
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) => {
    const away = (event: Electron.Event, url: string): void => {
      if (url === 'about:blank') return
      event.preventDefault()
      openOutside(url)
      child.destroy()
    }
    child.webContents.on('will-navigate', away)
    child.webContents.on('will-redirect', away)
  })
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${origin}/`)) return
    event.preventDefault()
    openOutside(url)
  })
  if (!app.isPackaged) {
    contents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) contents.toggleDevTools()
    })
  }
  void mainWindow.loadURL(notePage(text().starting))
}

function setMenu(): void {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
}

function focusWindow(): void {
  if (mainWindow === undefined || failed) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function assertWindow(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const contents = mainWindow?.webContents
  if (contents === undefined || event.sender !== contents || event.senderFrame !== contents.mainFrame
    || !event.senderFrame.url.startsWith(`${origin}/`)) throw new Error('Moon Bot: rejected IPC from an unknown page')
}

function fromWindow(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  try { assertWindow(event); return true } catch { return false }
}

function openOutside(url: string): void {
  if (/^https?:\/\//iu.test(url)) void shell.openExternal(url)
}

// A new version may fix what keeps this one from starting.
async function fail(error: unknown): Promise<void> {
  console.error(error)
  if (failed || stopping) return
  failed = true
  const found: UpdateFound | null = await Promise.race([updates?.latest() ?? null, sleep(UPDATE_CHECK_WAIT_MS).then(() => null)])
  const throwaway = Boolean(process.env.DS_BOT_HOME)
  const t = localeText(UPDATE_TEXT)
  const page = found !== null && 'page' in found ? found.page : undefined
  const next = found !== null ? `\n\n${page !== undefined ? t.onFailurePage(found.version) : t.onFailure(found.version)}` : ''
  dialog.showErrorBox('Moon Bot', `${text().notStarted}\n\n${error instanceof Error ? error.message : String(error)}${next}`)
  if (found !== null && 'page' in found) {
    if (!throwaway) await shell.openExternal(found.page)
    app.quit()
    return
  }
  if (found !== null) {
    mainWindow?.hide()
    if (await Promise.race([found.downloaded, sleep(UPDATE_DOWNLOAD_WAIT_MS).then((): false => false)])) {
      await updates?.install?.()
      return
    }
  }
  app.quit()
}

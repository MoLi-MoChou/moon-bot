// Windows downloads and installs updates; macOS asks before opening the release page.
import type { AppUpdater } from 'electron-updater'

export interface UpdateText {
  readonly ready: (version: string) => string
  readonly readyDetail: string
  readonly restart: string
  readonly later: string
  readonly onFailure: (version: string) => string
  readonly available: (version: string) => string
  readonly availableDetail: string
  readonly download: string
  readonly onFailurePage: (version: string) => string
}

export const UPDATE_TEXT: Readonly<Record<'en' | 'zh', UpdateText>> = {
  en: {
    ready: version => `Moon Bot ${version} is ready to install.`,
    readyDetail: 'Restart now to update, or it is installed the next time you quit.',
    restart: 'Restart now',
    later: 'Later',
    onFailure: version => `Moon Bot ${version} is installed when its download is done, and then Moon Bot opens again.`,
    available: version => `Moon Bot ${version} is available.`,
    availableDetail:
      'This version cannot update itself. Download the new version from its release page, then replace Moon Bot in Applications.',
    download: 'Download',
    onFailurePage: version => `Moon Bot ${version} is available. After this box, its download page opens.`,
  },
  zh: {
    ready: version => `Moon Bot ${version} 已经下载好。`,
    readyDetail: '现在重启就能更新；不重启的话，下次退出时安装。',
    restart: '立即重启',
    later: '稍后',
    onFailure: version => `Moon Bot ${version} 下载完会自动安装，然后重新打开。`,
    available: version => `Moon Bot ${version} 已经发布。`,
    availableDetail: '这个版本不能自己更新。请到发布页下载新版，再用它替换「应用程序」里的 Moon Bot。',
    download: '下载',
    onFailurePage: version => `Moon Bot ${version} 已经发布。关掉这个对话框后，会打开它的下载页面。`,
  },
}

const CHECK_EVERY_MS = 4 * 60 * 60_000
export const RELEASES_URL = 'https://api.github.com/repos/MoLi-MoChou/moon-bot/releases?per_page=20'

interface ParsedVersion {
  readonly core: readonly [bigint, bigint, bigint]
  readonly pre: readonly string[] | null
}

const coreOf = (parts: readonly string[]): [bigint, bigint, bigint] => {
  const value = (index: 0 | 1 | 2): bigint => {
    const part = parts[index]
    return part === undefined ? 0n : BigInt(part)
  }
  return [value(0), value(1), value(2)]
}

function parseVersion(version: string): ParsedVersion | null {
  if (typeof version !== 'string') return null
  const value = version.replace(/^v/u, '')
  const separator = value.indexOf('-')
  const coreText = separator < 0 ? value : value.slice(0, separator)
  const pre = separator < 0 ? null : value.slice(separator + 1).split('.')
  const parts = coreText.split('.')
  if (parts.length > 3 || parts.some(part => !/^\d+$/u.test(part)) || pre?.some(part => part === '')) return null
  return { core: coreOf(parts), pre }
}

export function isNewer(candidate: string, current: string): boolean {
  const newer = parseVersion(candidate)
  const older = parseVersion(current)
  if (newer === null || older === null) return false
  for (const index of [0, 1, 2] as const) {
    const next = newer.core[index]
    const previous = older.core[index]
    if (next !== previous) return next > previous
  }
  if (newer.pre === null) return older.pre !== null
  if (older.pre === null) return false
  for (let index = 0; index < Math.max(newer.pre.length, older.pre.length); index += 1) {
    const left = newer.pre[index]
    const right = older.pre[index]
    if (left === undefined) return false
    if (right === undefined) return true
    if (left === right) continue
    const leftNumeric = /^\d+$/u.test(left)
    const rightNumeric = /^\d+$/u.test(right)
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right)
    if (leftNumeric !== rightNumeric) return !leftNumeric
    return left > right
  }
  return false
}

function isHttpsPage(page: unknown): page is string {
  if (typeof page !== 'string') return false
  try {
    return new URL(page).protocol === 'https:'
  } catch {
    return false
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

/** What the macOS release watch found: the version and its page. */
export interface ReleaseFound {
  readonly version: string
  readonly page: string
}
/** What the in-app updater found: the version and a promise that its download finished. */
export interface DownloadFound {
  readonly version: string
  readonly downloaded: Promise<boolean>
}
export type UpdateFound = ReleaseFound | DownloadFound

export interface WatchLog {
  info(line: string): void
  error(line: string): void
}

export interface ReleaseWatchOptions {
  readonly current: string
  readonly arch: string
  readonly fetch?: typeof fetch | undefined
  readonly ask?: ((version: string) => Promise<boolean>) | undefined
  readonly open: (url: string) => void
  readonly feed?: string | undefined
  readonly log?: WatchLog | undefined
}

export interface ReleaseWatch {
  stop(): void
  latest(): Promise<ReleaseFound | null>
}

export function watchReleases({
  current,
  arch,
  fetch = globalThis.fetch,
  ask,
  open,
  feed = RELEASES_URL,
  log = console,
}: ReleaseWatchOptions): ReleaseWatch {
  let asked: string | undefined
  let latest: Promise<ReleaseFound | null> = Promise.resolve(null)
  const check = () => {
    latest = (async () => {
      try {
        const response = await fetch(feed, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': `DeepSeek-Bot/${current}` },
        })
        if (!response.ok) {
          log.error(`Moon Bot: update check failed: HTTP ${String(response.status)}`)
          return null
        }
        const body: unknown = await response.json()
        if (!Array.isArray(body)) {
          log.error('Moon Bot: update check failed: releases response is not an array')
          return null
        }
        const currentVersion = parseVersion(current)
        const allowPrerelease = currentVersion !== null && currentVersion.pre !== null
        let found: ReleaseFound | undefined
        for (const entry of body) {
          const release = record(entry)
          if (release === undefined || release.draft === true || (release.prerelease === true && !allowPrerelease))
            continue
          const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/u, '') : ''
          if (!isNewer(version, current)) continue
          const assets = release.assets
          const nameOf = (asset: unknown): unknown => record(asset)?.name
          if (!Array.isArray(assets) || !assets.some(asset => nameOf(asset) === `Moon-Bot-${version}-mac-${arch}.zip`))
            continue
          if (!isHttpsPage(release.html_url)) {
            log.error('Moon Bot: update check failed: release page URL is not HTTPS')
            continue
          }
          if (found === undefined || isNewer(version, found.version)) found = { version, page: release.html_url }
        }
        if (found === undefined) return null
        log.info(`Moon Bot: update ${found.version} available`)
        if (ask !== undefined && asked !== found.version) {
          asked = found.version
          const picked = found
          void Promise.resolve()
            .then(() => ask(picked.version))
            .then(yes => (yes ? open(picked.page) : undefined))
            .catch((error: unknown) => {
              log.error(
                `Moon Bot: update ${picked.version} not opened: ${error instanceof Error ? error.message : String(error)}`,
              )
            })
        }
        return found
      } catch (error) {
        log.error(`Moon Bot: update check failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })()
  }
  check()
  const timer = setInterval(check, CHECK_EVERY_MS)
  return {
    stop: () => {
      clearInterval(timer)
    },
    latest: () => latest,
  }
}

/** What the About page follows live: check, progress, ready, failure. */
export interface UpdateState {
  readonly phase: 'idle' | 'checking' | 'downloading' | 'downloaded' | 'latest' | 'error'
  readonly current?: string | undefined
  readonly version?: string | undefined
  readonly percent?: number | undefined
  readonly transferred?: number | undefined
  readonly total?: number | undefined
  readonly bytesPerSecond?: number | undefined
  readonly error?: string | undefined
  readonly checkedAt?: number | undefined
  readonly at?: number | undefined
}

export interface UpdateWatchOptions {
  readonly updater: AppUpdater
  readonly beforeInstall: () => Promise<void>
  readonly ask?: ((version: string) => Promise<boolean>) | undefined
  readonly feed?: string | undefined
  readonly log?: WatchLog | undefined
  readonly onState?: ((state: UpdateState) => void) | undefined
}

/** Either watch, as far as the shell asks of it. `latest` is what the newest check found. */
export interface UpdateWatch {
  stop(): void
  latest(): Promise<UpdateFound | null>
  state?(): UpdateState
  check?(): Promise<UpdateFound | null>
  install?(): Promise<void>
}

export function watchUpdates({
  updater,
  beforeInstall,
  ask,
  feed,
  log = console,
  onState,
}: UpdateWatchOptions): UpdateWatch {
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  // Differential download: electron-updater fetches only the blocks of the new installer
  // (its .blockmap) that differ from the installed one.
  updater.disableDifferentialDownload = false
  // One range per request, as the GitHub provider does: GitHub's CDN answers 501 to multi-range.
  if (feed) updater.setFeedURL({ provider: 'generic', url: feed, useMultipleRangeRequest: false })
  // Moon Bot patch: the About page follows this state live (check, progress, ready).
  let state: UpdateState = { phase: 'idle', current: updater.currentVersion?.version }
  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch, at: Date.now() }
    onState?.(state)
  }
  const install = async (): Promise<void> => {
    await beforeInstall()
    updater.quitAndInstall(true, true)
  }
  let asked: string | undefined
  updater.on('checking-for-update', () => {
    if (state.phase !== 'downloading' && state.phase !== 'downloaded') set({ phase: 'checking', error: undefined })
  })
  updater.on('update-available', ({ version }) => set({ phase: 'downloading', version, percent: 0 }))
  updater.on('update-not-available', () => {
    if (state.phase !== 'downloaded') set({ phase: 'latest', checkedAt: Date.now() })
  })
  updater.on('download-progress', ({ percent, transferred, total, bytesPerSecond }) =>
    set({ phase: 'downloading', percent, transferred, total, bytesPerSecond }),
  )
  updater.on('update-downloaded', ({ version }) => {
    set({ phase: 'downloaded', version, percent: 100 })
    log.info(`Moon Bot: update ${version} downloaded`)
    if (ask === undefined || asked === version) return
    asked = version
    void ask(version)
      .then(now => (now ? install() : undefined))
      .catch((error: unknown) => {
        log.error(
          `Moon Bot: update ${version} not installed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  })
  updater.on('error', (error: Error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (state.phase !== 'downloaded') set({ phase: 'error', error: (message.split('\n')[0] ?? '').slice(0, 200) })
    log.error(`Moon Bot: update failed: ${message}`)
  })
  let latest: Promise<UpdateFound | null> = Promise.resolve(null)
  // A failed check or download also comes as an 'error' event.
  const check = (): Promise<UpdateFound | null> => {
    if (state.phase === 'downloading' || state.phase === 'downloaded') return latest
    latest = updater.checkForUpdates().then(
      result =>
        result?.isUpdateAvailable && result.downloadPromise
          ? {
              version: result.updateInfo.version,
              downloaded: result.downloadPromise.then(
                () => true,
                () => false,
              ),
            }
          : null,
      () => null,
    )
    return latest
  }
  check()
  const timer = setInterval(check, CHECK_EVERY_MS)
  return {
    stop: () => {
      clearInterval(timer)
    },
    latest: () => latest,
    install,
    check,
    state: () => state,
  }
}

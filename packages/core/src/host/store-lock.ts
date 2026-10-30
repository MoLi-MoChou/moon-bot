// The lock that keeps a second the host host on the same data from writing it, and the read
// of state.json that goes with it. One writer per plugin home: the host Web and the desktop app
// share ~/.the host, and each host keeps the team in memory and writes state.json whole.
import { copyFile, readFile } from 'node:fs/promises'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homeLock } from './home-lock.ts'
import type { HomeLock, HomeLockHolder, UnknownHolder } from './home-lock.ts'

export interface StoreLock {
  /** The other host that holds state.lock, or undefined while this host may write. */
  holder(): HomeLockHolder | UnknownHolder | undefined | null
  /** Why the team file could not be read, while it cannot be. */
  stuck(): string | undefined
  /** True when the lock file system refuses to lock at all. */
  broken(): boolean
  claim(): void
  owns(): boolean
  release(): void
  /** The line to show while another host holds the team, or undefined. */
  readOnly(): string | undefined
  /** What state.json holds now; undefined when there is none or it is unusable. */
  readFileState(): Promise<unknown>
  /** mtime and size of the state.json this host last read or wrote. */
  seen(): string
  warned(): boolean
  markWarned(): void
}

interface StoreLockOptions {
  readonly home: string
  readonly statePath: string
  warn(template: string, ...args: readonly unknown[]): void
}

export function createStoreLock({ home, statePath, warn }: StoreLockOptions): StoreLock {
  let holder: HomeLockHolder | UnknownHolder | undefined | null
  let lockBroken = false
  let stuck: string | undefined
  let warnedReadOnly = false
  let seen = ''

  const stamp = (): string => {
    try {
      const { mtimeMs, size } = statSync(statePath)
      return `${mtimeMs}:${size}`
    } catch {
      return ''
    }
  }
  const lock: HomeLock = homeLock(join(home, 'state.lock'))
  const claim = (): void => {
    if (lockBroken) return
    try {
      mkdirSync(home, { recursive: true })
      holder = lock.claim()
    } catch (error) {
      // An unusable lock (a read-only or odd file system) must not stop the team; a
      // save that then cannot write still rejects.
      lockBroken = true
      holder = undefined
      warn('moon-bot: cannot lock %s, so another instance on the same data could undo changes: %s', home, error)
    }
  }
  const readOnly = (): string | undefined => {
    if (stuck !== undefined) return `The Bot team file ${statePath} could not be read (${stuck}). Moon Bot does not change it; fix or move the file and reload.`
    if (holder === undefined) return undefined
    const where = holder?.pid ? `pid ${holder.pid}${holder.host ? ` on ${holder.host}` : ''}` : 'unknown process'
    return `The Bot team in ${home} is open in another Moon Bot (Web or Desktop, ${where}). This window shows the team but cannot change it; close the other one and reload.`
  }

  const readFileState = async (): Promise<unknown> => {
    let contents
    try {
      contents = await readFile(statePath, 'utf8')
    } catch (error) {
      seen = stamp()
      const code = (error as { readonly code?: string } | undefined)?.code
      if (code === 'ENOENT') {
        stuck = undefined
        return undefined
      }
      stuck = code ?? (error instanceof Error ? error.message : String(error))
      warn('moon-bot: unreadable state %s: %s', statePath, error)
      return undefined
    }
    seen = stamp()
    let parsed
    try {
      parsed = JSON.parse(contents)
    } catch (error) {
      const backup = `${statePath}.broken-${Date.now()}`
      try {
        await copyFile(statePath, backup)
        stuck = undefined
        warn('moon-bot: unreadable state %s: %s; backed up as %s', statePath, error, backup)
      } catch (copyError) {
        stuck = (copyError as { readonly code?: string } | undefined)?.code
          ?? (copyError instanceof Error ? copyError.message : String(copyError))
        warn('moon-bot: unreadable state %s: %s; backup failed: %s', statePath, error, copyError)
      }
      return undefined
    }
    if ((parsed as { readonly version?: unknown } | undefined)?.version === 1) {
      stuck = undefined
      return parsed
    }
    stuck = 'saved by a newer Moon Bot; update Moon Bot'
    return undefined
  }

  return {
    holder: () => holder,
    stuck: () => stuck,
    broken: () => lockBroken,
    claim,
    owns: () => lock.owns(),
    release: () => lock.release(),
    readOnly,
    readFileState,
    seen: () => seen,
    warned: () => warnedReadOnly,
    markWarned: () => { warnedReadOnly = true },
  }
}

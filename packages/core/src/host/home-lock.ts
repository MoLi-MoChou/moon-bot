// One writer per plugin home. the host Web and the desktop app share ~/.the host, and each host keeps
// the team in memory and writes state.json whole, so two hosts at once would undo each
// other's changes. The first host to load takes `state.lock`; a second one only reads.
//
// The lock is a small JSON file (pid, host, a random token) whose mtime the holder bumps
// on a timer. On the same host, its process decides whether it is live; `staleMs` only
// covers other hosts and unreadable files. A reused pid after a crash keeps the second
// host read-only until that process ends. The token, not the pid, decides ownership: a
// holder that finds another token has lost the lock.
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { clearInterval, setInterval } from 'node:timers'

export interface HomeLockHolder {
  readonly pid: number
  readonly host: string
  readonly token: string
  readonly since?: number
}

export interface HomeLockOptions {
  readonly staleMs?: number
  readonly beatMs?: number
  readonly host?: string
  readonly pid?: number
  readonly isAlive?: (pid: number) => boolean
  readonly now?: () => number
}

/** A holder the file describes but whose details are unreadable: present means held. */
export type UnknownHolder = Readonly<Record<string, never>>

export interface HomeLock {
  /** Takes the lock when it is free or its holder is gone; returns the holder otherwise. */
  claim(): HomeLockHolder | UnknownHolder | undefined | null
  owns(): boolean
  release(): void
  read(): HomeLockHolder | null | undefined
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { readonly code?: string }).code : undefined

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return codeOf(error) === 'EPERM'
  }
}

export function homeLock(
  path: string,
  {
    staleMs = 60_000,
    beatMs = 15_000,
    host = hostname(),
    pid = process.pid,
    isAlive = pidAlive,
    now = Date.now,
  }: HomeLockOptions = {},
): HomeLock {
  const token = randomUUID()
  let timer: ReturnType<typeof setInterval> | undefined

  // undefined: no lock file; null: a file that does not parse (being written right now).
  const read = (): HomeLockHolder | null | undefined => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as HomeLockHolder
    } catch (error) {
      return codeOf(error) === 'ENOENT' ? undefined : null
    }
  }
  const age = (): number => {
    try {
      return now() - statSync(path).mtimeMs
    } catch {
      return Infinity
    }
  }
  const live = (holder: HomeLockHolder | null | undefined): boolean => {
    if (holder === undefined) return false
    if (holder === null) return age() < staleMs
    if (holder.host === host) return holder.pid !== pid && isAlive(holder.pid)
    return age() < staleMs
  }
  const owns = (): boolean => read()?.token === token

  const beat = (): void => {
    if (!owns()) {
      stop()
      return
    }
    const time = new Date(now())
    try {
      utimesSync(path, time, time)
    } catch {
      /* the lock file is gone: the next beat stops */
    }
  }
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Take the lock if it is free or its holder is gone. Returns undefined when this
  // process holds it, else what the lock file says about the holder.
  function claim(): HomeLockHolder | UnknownHolder | undefined | null {
    if (owns()) return undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(path, JSON.stringify({ pid, host, token, since: now() }), { flag: 'wx' })
        stop()
        timer = setInterval(beat, beatMs)
        timer.unref()
        return undefined
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error
      }
      const holder = read()
      if (live(holder)) return holder ?? {}
      const current = read()
      const unchanged =
        holder === null
          ? current === null
          : holder?.token !== undefined
            ? current?.token === holder.token
            : JSON.stringify(current) === JSON.stringify(holder)
      if (unchanged) {
        try {
          unlinkSync(path)
        } catch {
          /* someone else removed it first */
        }
      }
    }
    return read() ?? {}
  }

  function release(): void {
    stop()
    if (owns()) {
      try {
        unlinkSync(path)
      } catch {
        /* someone else removed it first */
      }
    }
  }

  return { claim, owns, release, read }
}

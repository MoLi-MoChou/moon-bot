// Moving the app's data to another folder. The copy is put together in a folder beside the new
// one and takes its name only once it is whole, so a copy that stopped or failed leaves nothing
// that looks like data. The old folder stays as it was.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { copyTree, real, within } from './copy-tree.ts'

// The Host's lock on the team belongs to the old folder; the temporary folders that an
// earlier build's first run left behind are not part of the data either.
const LEFT_BEHIND = [/^bot[\\/]state\.lock$/u, /^\.import(-check)?-\d+$/u]
// Marks a staging folder as this app's, so that only those are removed.
const MARK = '.ds-bot-moving'
const LOCK_STALE_MS = 60_000

/** The folder that an update or uninstall replaces: on macOS the whole .app bundle. */
export function installFolder(exe: string, platform: string = process.platform): string {
  if (platform === 'darwin') {
    for (let at = dirname(exe); dirname(at) !== at; at = dirname(at)) if (at.endsWith('.app')) return at
  }
  return dirname(exe)
}

/** The data folder of the other app that Moon Bot keeps its own data apart from (DSH_HOME, else ~/.dsh). */
export function userDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DSH_HOME?.trim()
  if (!value) return join(homedir(), '.dsh')
  return resolve(value === '~' ? homedir() : /^~[\\/]/u.test(value) ? join(homedir(), value.slice(2)) : value)
}

export interface TeamInUseCheck {
  readonly host?: string | undefined
  readonly now?: number | undefined
}

/** Whether a running Host holds the team's lock, as the core's home-lock writes it. */
export function teamInUse(from: string, { host = hostname(), now = Date.now() }: TeamInUseCheck = {}): boolean {
  // The standalone runtime locks the data folder itself; the app's earlier layout kept the
  // team under bot/, so a lock there still counts while such data is moved.
  return lockHeld(join(from, 'state.lock'), host, now) || lockHeld(join(from, 'bot', 'state.lock'), host, now)
}

function lockHeld(path: string, host: string, now: number): boolean {
  if (!existsSync(path)) return false
  const fresh = now - statSync(path).mtimeMs < LOCK_STALE_MS
  let holder: Record<string, unknown> | undefined
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    holder = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return fresh
  }
  if (holder?.host !== host) return fresh
  try {
    const pid = holder.pid
    if (typeof pid !== 'number') throw new TypeError('no pid in the lock')
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === 'object' && error !== null ? (error as { readonly code?: string }).code === 'EPERM' : false
  }
}

export type MoveProblem = 'drive' | 'nested' | 'workspace' | 'dsh' | 'program' | 'notEmpty'

export interface MovePlaces {
  readonly from: string
  readonly to: string
  readonly workspace?: string | undefined
  readonly otherAppHome: string
  readonly program?: string | undefined
}

/** What keeps `to` from being the new data location, or undefined. */
export function moveProblem(places: MovePlaces): MoveProblem | undefined {
  const from = real(places.from)
  const to = real(places.to)
  const otherAppHome = real(places.otherAppHome)
  const workspace = places.workspace === undefined ? undefined : real(places.workspace)
  const program = places.program === undefined ? undefined : real(places.program)
  if (dirname(to) === to) return 'drive'
  if (within(to, from) || within(from, to)) return 'nested'
  if (workspace !== undefined && (within(to, workspace) || within(workspace, to))) return 'workspace'
  if (within(to, otherAppHome) || within(otherAppHome, to)) return 'dsh'
  if (program !== undefined && within(to, program)) return 'program'
  if (existsSync(to) && (!statSync(to).isDirectory() || readdirSync(to).length > 0)) return 'notEmpty'
  return undefined
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/**
 * Copy the data in `from` to `to`, an empty or new folder. The signal stops it between files.
 */
export async function copyData(from: string, to: string, signal?: AbortSignal | undefined): Promise<void> {
  const parent = dirname(resolve(to))
  await mkdir(parent, { recursive: true })
  // A run that was killed can leave its staging folder behind.
  const staging = new RegExp(`^\\.${escaped(basename(to))}\\.moving-\\d+$`, 'u')
  for (const name of readdirSync(parent).filter(entry => staging.test(entry) && existsSync(join(parent, entry, MARK)))) {
    await rm(join(parent, name), { recursive: true, force: true, maxRetries: 5 })
  }
  const stage = join(parent, `.${basename(to)}.moving-${String(Date.now())}`)
  await mkdir(stage)
  try {
    await writeFile(join(stage, MARK), '')
    // Anything left out would be missing from the data the app moves on to, so it stops the move.
    await copyTree(from, stage, { as: to, leave: path => LEFT_BEHIND.some(pattern => pattern.test(path)), signal })
    signal?.throwIfAborted()
    if (existsSync(to)) await rmdir(to)
    await rename(stage, to)
  } catch (error) {
    await rm(stage, { recursive: true, force: true, maxRetries: 5 })
    throw error
  }
  // Only now: a staging folder cut short before its rename keeps the mark that lets it go.
  await rm(join(to, MARK), { force: true })
}

// Where the Host runs inside the desktop app: `<data>/profiles/<name>`.
//
// The folder used to be named after the app as it was before the rename. An install from
// then keeps its folder when it updates: the old one is moved to the new name once, so a
// Host that wrote there finds its files where it left them.
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILE = 'moon-bot'
export const LEGACY_PROFILE = 'ds-bot'

export interface ProfileOps {
  readonly exists?: ((path: string) => boolean) | undefined
  readonly rename?: ((from: string, to: string) => void) | undefined
}

/**
 * The profile folder under `data`, moving an install's old one to the new name first.
 * Returns the folder to use; the caller creates it. A move that fails (a file held open,
 * another filesystem) leaves the old folder in place and uses it, so the app still starts.
 */
export function profileDirOf(dataDir: string, ops: ProfileOps = {}): string {
  const exists = ops.exists ?? existsSync
  const rename = ops.rename ?? renameSync
  const next = join(dataDir, 'profiles', PROFILE)
  const legacy = join(dataDir, 'profiles', LEGACY_PROFILE)
  if (exists(next) || !exists(legacy)) return next
  try {
    rename(legacy, next)
    return next
  } catch {
    return legacy
  }
}

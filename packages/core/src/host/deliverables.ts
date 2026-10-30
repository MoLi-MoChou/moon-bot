// Turn-end deliverable collection (2026-10-28 files-and-library): when a turn ends,
// the files it left behind in the Bot's workspace become the turn's deliverables. The
// scan is a walk with the plan's exclusions — temp files and dependency trees are not
// deliverables — bounded in depth and count so a runaway workspace cannot flood the
// store. It runs for every engine alike: the emit fanout calls it, not the engine.
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface CollectedFile {
  readonly name: string
  /** Workspace-relative, POSIX separators: the interface never sees an absolute path. */
  readonly path: string
  readonly size: number
}

export interface CollectOptions {
  /** Files must have changed in [since, until]; the clock skew allowance is a second. */
  readonly since: number
  readonly until: number
  readonly maxFiles?: number
  readonly maxDepth?: number
}

const SKEW_MS = 1_000
const DEFAULT_MAX_FILES = 50
const DEFAULT_MAX_DEPTH = 8
/** Dependency trees and editor leftovers are work, not deliverables. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv'])
const EXCLUDED_SUFFIXES = ['.tmp', '.part', '.crdownload', '.swp', '.lock']

export async function collectDeliverables(
  root: string,
  options: CollectOptions,
): Promise<{ readonly files: readonly CollectedFile[]; readonly truncated: boolean }> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const since = options.since - SKEW_MS
  const until = options.until + SKEW_MS
  const files: CollectedFile[] = []
  let truncated = false

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (files.length >= maxFiles) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // a folder that cannot be read has nothing to deliver
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth <= 0 || EXCLUDED_DIRS.has(entry.name)) continue
        await walk(path, depth - 1)
      } else if (entry.isFile()) {
        if (EXCLUDED_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue
        let info
        try {
          info = await stat(path)
        } catch {
          continue
        }
        const changed = info.mtimeMs
        if (changed < since || changed > until) continue
        files.push({ name: entry.name, path: relative(root, path).split('\\').join('/'), size: info.size })
      }
    }
  }

  await walk(root, options.maxDepth ?? DEFAULT_MAX_DEPTH)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, truncated }
}

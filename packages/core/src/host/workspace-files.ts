// Moon Bot: downloads from the workspace file panel. the host's panel previews files but
// has no way to save one, and in the web build "Show file location" opens nothing on
// the user's computer. The browser asks here for a file's bytes (or a folder as a
// zip) over the same api/bot channel as everything else, so it works through the web
// build's password proxy. Only files inside a folder the team works in are served.
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import type { HostRuntime } from './runtime.js'

// Larger files are refused rather than pushed through one JSON reply.
export const DOWNLOAD_LIMIT = 64 * 1024 * 1024
const ZIP_ENTRY_LIMIT = 5000

const MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
}
export const mimeOf = (name: string): string => MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'

// `inner` is `outer` or inside it (both already real paths).
export const isInside = (outer: string, inner: string): boolean => {
  const rel = relative(outer, inner)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel))
}

const DOS_EPOCH = Date.UTC(1980, 0, 1)
const dosTime = (date: Date): { readonly time: number; readonly date: number } => {
  const at = new Date(Math.max(date.getTime(), DOS_EPOCH))
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

// A zip archive (deflate, UTF-8 names) of `entries`: { name, data: Buffer, mtime?: Date }.
// A name ending in "/" is a folder entry.
export interface ZipEntry {
  readonly name: string
  readonly data?: Buffer
  readonly mtime?: Date
}

export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const folder = entry.name.endsWith('/')
    const raw = folder ? Buffer.alloc(0) : entry.data ?? Buffer.alloc(0)
    const packed = folder ? raw : deflateRawSync(raw)
    const stored = folder || packed.length >= raw.length
    const body = stored ? raw : packed
    const crc = folder ? 0 : crc32(raw)
    const { time, date } = dosTime(entry.mtime ?? new Date())
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(stored ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(folder ? 0x10 : 0, 38); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const tooLarge = () => Object.assign(new Error(`Too large to download here (over ${DOWNLOAD_LIMIT / 1024 / 1024} MB)`), { code: 'bot/refused' })

// Every file under `dir` as zip entries named from `base`, folders included.
async function collect(dir: string, base: string, out: ZipEntry[], budget: { used: number }): Promise<ZipEntry[]> {
  const items = await readdir(dir, { withFileTypes: true })
  items.sort((a, b) => a.name.localeCompare(b.name))
  if (items.length === 0) out.push({ name: `${base}/`, data: Buffer.alloc(0) })
  for (const item of items) {
    if (out.length >= ZIP_ENTRY_LIMIT) throw Object.assign(new Error(`This folder has more than ${ZIP_ENTRY_LIMIT} files`), { code: 'bot/refused' })
    const path = join(dir, item.name)
    const name = `${base}/${item.name}`
    if (item.isDirectory()) await collect(path, name, out, budget)
    else if (item.isFile()) {
      const info = await stat(path)
      budget.used += info.size
      if (budget.used > DOWNLOAD_LIMIT) throw tooLarge()
      out.push({ name, data: await readFile(path), mtime: info.mtime })
    }
  }
  return out
}

// What the browser saves: { name, mime, size, data (base64) }.
export async function readForDownload(path: string): Promise<{
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly folder?: boolean
  readonly data: string
}> {
  const info = await stat(path)
  if (info.isDirectory()) {
    const name = basename(path) || 'folder'
    const data = zip(await collect(path, name, [], { used: 0 }))
    return { name: `${name}.zip`, mime: 'application/zip', size: data.length, folder: true, data: data.toString('base64') }
  }
  if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'bot/refused' })
  if (info.size > DOWNLOAD_LIMIT) throw tooLarge()
  const name = basename(path)
  return { name, mime: mimeOf(name), size: info.size, data: (await readFile(path)).toString('base64') }
}

export async function describe(path: string): Promise<{
  readonly name: string
  readonly size: number
  readonly folder: boolean
  readonly mime: string
  readonly modified: string
  readonly downloadable: boolean
}> {
  const info = await stat(path)
  const name = basename(path)
  return { name, size: info.size, folder: info.isDirectory(), mime: info.isDirectory() ? 'inode/directory' : mimeOf(name), modified: info.mtime.toISOString(), downloadable: info.isDirectory() || info.size <= DOWNLOAD_LIMIT }
}

export function install(rt: HostRuntime): void {
  const { ctx, state } = rt
  // Folders the team works in: the host's workspaces, the team folder and every Bot's and
  // group's own folder.
  const roots = async (): Promise<string[]> => {
    const paths = new Set<string>()
    for (const workspace of ctx.workspaceRegistry?.list?.() ?? []) if (workspace?.path) paths.add(workspace.path)
    const team = rt.teamFolder?.() ?? rt.defaultTeamFolder?.()
    if (team) paths.add(team)
    for (const entry of [...Object.values(state.bots ?? {}), ...Object.values(state.rooms ?? {})]) if (entry.workDir) paths.add(entry.workDir)
    const real = await Promise.all([...paths].map(path => realpath(resolve(path)).catch(() => undefined)))
    return real.filter((path): path is string => path !== undefined)
  }
  // The real path of `path` when it lies inside one of the team's folders.
  async function allowed(path: unknown): Promise<string> {
    if (typeof path !== 'string' || path === '') throw Object.assign(new Error('No file named'), { code: 'bot/invalid' })
    const real = await realpath(resolve(path)).catch(() => undefined)
    if (real === undefined) throw Object.assign(new Error('This file no longer exists'), { code: 'bot/refused' })
    if (!(await roots()).some(root => isInside(root, real))) throw Object.assign(new Error('Only files in the team\'s folders can be downloaded'), { code: 'bot/refused' })
    return real
  }
  rt.workspaceDownload = async (path: string) => readForDownload(await allowed(path))
  rt.workspaceDescribe = async (path: string) => describe(await allowed(path))
}

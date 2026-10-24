// Moon Bot patch: the Office-to-PDF engine (LibreOfficeKit) is the largest part of the app
// (182 MB on Windows, 145 MB on Linux), and only Office file previews use it. The
// installer leaves it out; the app downloads the exact version the build was made with
// in the background, checks it against the npm lockfile's sha512, and unpacks it into its
// own data folder. The Host finds it through NODE_PATH, the way LibreOfficeKit looks up
// an installed engine package. Two registries are tried, the npm one and its China mirror.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'

export interface EngineSpec {
  readonly name: string
  readonly version: string
  readonly integrity: string
}

// Same versions and integrity as app/package-lock.json (test/engines.test.mjs checks).
export const ENGINES: Readonly<Record<string, EngineSpec>> = {
  'win32-x64': { name: '@deepseek-ai/libreoffice-kit-win32-x64', version: '0.1.5', integrity: 'sha512-uKuDGZdofxuW4iRmUh8b3+XWU28JeOCYMTAONzo7tEHIq00DV2cARcgUYiTP7gUH49tH4A/RyPMOVEBzK7qjjw==' },
  'linux-x64': { name: '@deepseek-ai/libreoffice-kit-wasm', version: '0.1.5', integrity: 'sha512-V+pu5xJsKhVD4AU1xbFlMWY91svK9ZIC2JsNOph9kWp/arF/KQcuytt76bcbozJqPbE8o0n04lyh0m3QW5RYSA==' },
}
export const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

export const engineFor = (platform: string = process.platform, arch: string = process.arch): EngineSpec | undefined => ENGINES[`${platform}-${arch}`]
export const tarballUrl = (registry: string, { name, version }: EngineSpec): string => `${registry}/${name}/-/${name.split('/')[1] ?? ''}-${version}.tgz`
/** The folder that goes on the Host's NODE_PATH. */
export const enginesModules = (root: string): string => join(root, 'node_modules')

/** Whether the engine is unpacked and complete in root. */
export function engineReady(root: string, engine: EngineSpec | undefined): boolean {
  if (engine === undefined) return false
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(enginesModules(root), engine.name, 'package.json'), 'utf8'))
    const version = typeof pkg === 'object' && pkg !== null ? (pkg as { readonly version?: unknown }).version : undefined
    return version === engine.version && existsSync(join(enginesModules(root), engine.name, '.complete'))
  } catch { return false }
}

/** What ensureEngine tells the app as the download goes on. */
export interface EngineProgress {
  readonly phase: 'downloading' | 'unpacking' | 'ready'
  readonly received?: number
  readonly total?: number | undefined
  readonly percent?: number | undefined
}

export interface EnsureEngineOptions {
  readonly root: string
  readonly engine?: EngineSpec | undefined
  readonly fetchImpl?: typeof fetch | undefined
  readonly onProgress?: ((state: EngineProgress) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

/**
 * Downloads and unpacks the engine once. Resolves to 'ready' or 'unsupported', or throws.
 */
export async function ensureEngine({ root, engine = engineFor(), fetchImpl = fetch, onProgress = () => {}, signal }: EnsureEngineOptions): Promise<'ready' | 'unsupported'> {
  if (engine === undefined) return 'unsupported'
  if (engineReady(root, engine)) return 'ready'
  mkdirSync(root, { recursive: true })
  const [algorithm, expected] = engine.integrity.split(/-(.+)/)
  if (algorithm === undefined || expected === undefined) throw new Error(`bad integrity record: ${engine.integrity}`)
  const file = join(root, 'download.tgz')
  const errors: string[] = []
  for (const registry of REGISTRIES) {
    try {
      const response = await fetchImpl(tarballUrl(registry, engine), signal === undefined ? {} : { signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${String(response.status)}`)
      const total = Number(response.headers.get('content-length')) || undefined
      const hash = createHash(algorithm)
      let received = 0, reported = -1
      const counted = Readable.fromWeb(response.body).on('data', (chunk: Buffer) => {
        hash.update(chunk)
        received += chunk.length
        // Report at most once per whole percent (or per MB without a length), not per chunk.
        const step = total ? Math.floor((received / total) * 100) : Math.floor(received / 2 ** 20)
        if (step === reported) return
        reported = step
        onProgress({ phase: 'downloading', received, total, percent: total ? (received / total) * 100 : undefined })
      })
      const { createWriteStream } = await import('node:fs')
      await pipeline(counted, createWriteStream(file), { signal })
      if (hash.digest('base64') !== expected) throw new Error('checksum mismatch')
      onProgress({ phase: 'unpacking' })
      const staging = join(root, 'staging')
      rmSync(staging, { recursive: true, force: true })
      mkdirSync(staging, { recursive: true })
      await tar.x({ file, cwd: staging, strip: 1 })
      const target = join(enginesModules(root), engine.name)
      mkdirSync(join(target, '..'), { recursive: true })
      rmSync(target, { recursive: true, force: true })
      renameSync(staging, target)
      writeFileSync(join(target, '.complete'), `${engine.version}\n`)
      rmSync(file, { force: true })
      onProgress({ phase: 'ready' })
      return 'ready'
    } catch (error) {
      if (signal?.aborted) throw error
      errors.push(`${registry}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  rmSync(file, { force: true })
  throw new Error(`Office engine download failed: ${errors.join('; ')}`)
}

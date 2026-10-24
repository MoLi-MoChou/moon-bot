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

// Same versions and integrity as app/package-lock.json (test/engines.test.mjs checks).
export const ENGINES = {
  'win32-x64': { name: '@deepseek-ai/libreoffice-kit-win32-x64', version: '0.1.5', integrity: 'sha512-uKuDGZdofxuW4iRmUh8b3+XWU28JeOCYMTAONzo7tEHIq00DV2cARcgUYiTP7gUH49tH4A/RyPMOVEBzK7qjjw==' },
  'linux-x64': { name: '@deepseek-ai/libreoffice-kit-wasm', version: '0.1.5', integrity: 'sha512-V+pu5xJsKhVD4AU1xbFlMWY91svK9ZIC2JsNOph9kWp/arF/KQcuytt76bcbozJqPbE8o0n04lyh0m3QW5RYSA==' },
}
export const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

export const engineFor = (platform = process.platform, arch = process.arch) => ENGINES[`${platform}-${arch}`]
export const tarballUrl = (registry, { name, version }) => `${registry}/${name}/-/${name.split('/')[1]}-${version}.tgz`
/** The folder that goes on the Host's NODE_PATH. */
export const enginesModules = root => join(root, 'node_modules')

/** Whether the engine is unpacked and complete in root. */
export function engineReady(root, engine) {
  if (!engine) return false
  try {
    const pkg = JSON.parse(readFileSync(join(enginesModules(root), engine.name, 'package.json'), 'utf8'))
    return pkg.version === engine.version && existsSync(join(enginesModules(root), engine.name, '.complete'))
  } catch { return false }
}

/**
 * Downloads and unpacks the engine once. Resolves to 'ready', or throws.
 * @param {{ root: string, engine?: object, fetchImpl?: typeof fetch, onProgress?: (state: object) => void, signal?: AbortSignal }} options
 */
export async function ensureEngine({ root, engine = engineFor(), fetchImpl = fetch, onProgress = () => {}, signal }) {
  if (!engine) return 'unsupported'
  if (engineReady(root, engine)) return 'ready'
  mkdirSync(root, { recursive: true })
  const [algorithm, expected] = engine.integrity.split(/-(.+)/)
  const file = join(root, 'download.tgz')
  const errors = []
  for (const registry of REGISTRIES) {
    try {
      const response = await fetchImpl(tarballUrl(registry, engine), { signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const total = Number(response.headers.get('content-length')) || undefined
      const hash = createHash(algorithm)
      let received = 0, reported = -1
      const counted = Readable.fromWeb(response.body).on('data', (chunk) => {
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

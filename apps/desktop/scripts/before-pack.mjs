// electron-builder's beforePack / afterPack hooks. The native modules are rebuilt by the
// pack/dist scripts before beforePack runs; this hook checks the target architecture and
// materializes the core link. afterPack puts the workspace link back so a second pack in the
// same checkout (CI's "next version" update feed) can still resolve core's dependencies
// (fastify, …) through pnpm's store — otherwise electron-builder reports them as @undefined
// and the updated Windows app fails with ERR_MODULE_NOT_FOUND for fastify.
import { Arch } from 'electron-builder'
import { lstat, rm, cp, mkdir, symlink, access } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WHERE = {
  darwin: { x64: 'on an Intel Mac, or under Rosetta with an x64 Node', arm64: 'on a Mac with Apple silicon' },
}

const app = dirname(dirname(fileURLToPath(import.meta.url)))
const coreLink = join(app, 'node_modules', 'moon-bot-core')
const corePackage = resolve(app, '..', '..', 'packages', 'core')

/** @returns {string | undefined} why this Node cannot build an app for `target` */
export function archProblem({ target, platform, host = process.arch, targets = [] }) {
  // electron-builder packs a universal app one architecture at a time: the hook only sees the
  // inner x64/arm64 builds, so a universal request is known from the requested targets.
  if (target === 'universal' || targets.includes('universal'))
    return 'A universal app would need the native modules of both architectures. Build one app per architecture.'
  if (target === host) return undefined
  const where = WHERE[platform]?.[target] ?? `with an ${target} Node`
  return `This Node runs on ${host}, so pnpm installed ${host} native modules, and an ${target} app with them would not start. Install the dependencies and build ${where}.`
}

// pnpm workspaces link moon-bot-core to ../../packages/core, outside the app folder this hook packs
// from. The packaged app needs the package's own files, so the link becomes the copy the
// package would install (its "files" list) before electron-builder collects node_modules.
export async function materializeCoreLink() {
  const info = await lstat(coreLink).catch(() => null)
  if (info === null || !info.isSymbolicLink()) return
  await access(join(corePackage, 'dist', 'service', 'server.js')).catch(() => {
    throw new Error('packages/core/dist is missing: run pnpm run build (or pnpm install) before packing the app')
  })
  await rm(coreLink, { recursive: true, force: true })
  await mkdir(dirname(coreLink), { recursive: true })
  // The package's published files, as core/package.json lists them (plus the manifest).
  for (const entry of ['package.json', 'index.js', 'client.js', 'web-search.js', 'dist', 'README.md', 'LICENSE']) {
    await cp(join(corePackage, entry), join(coreLink, entry), { recursive: true }).catch(() => {})
  }
}

/** Put the pnpm workspace link back after a pack so the next electron-builder run can resolve deps. */
export async function restoreCoreLink() {
  const info = await lstat(coreLink).catch(() => null)
  if (info === null || info.isSymbolicLink()) return
  await rm(coreLink, { recursive: true, force: true })
  await mkdir(dirname(coreLink), { recursive: true })
  // pnpm uses a junction on Windows and a relative directory symlink elsewhere.
  if (process.platform === 'win32') {
    await symlink(corePackage, coreLink, 'junction')
  } else {
    await symlink(relative(dirname(coreLink), corePackage), coreLink, 'dir')
  }
}

export async function beforePack(context) {
  const targets = []
  for (const archToNames of context.packager?.packagerOptions?.targets?.values() ?? [])
    for (const arch of archToNames.keys()) targets.push(Arch[arch])
  const problem = archProblem({ target: Arch[context.arch], platform: context.electronPlatformName, targets })
  if (problem !== undefined) throw new Error(problem)
  await materializeCoreLink()
}

export async function afterPack() {
  await restoreCoreLink()
}

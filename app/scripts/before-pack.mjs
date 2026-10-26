// electron-builder's beforePack hook. The native modules go into the package as npm installed them
// (npmRebuild: false), so they fit only the architecture of the Node that ran npm. An app built for
// another architecture would carry them and not start, so such a build stops here.
import { Arch } from 'electron-builder'

const WHERE = {
  darwin: { x64: 'on an Intel Mac, or under Rosetta with an x64 Node', arm64: 'on a Mac with Apple silicon' },
}

/** @returns {string | undefined} why this Node cannot build an app for `target` */
export function archProblem({ target, platform, host = process.arch, targets = [] }) {
  // electron-builder packs a universal app one architecture at a time: the hook only sees the
  // inner x64/arm64 builds, so a universal request is known from the requested targets.
  if (target === 'universal' || targets.includes('universal')) return 'A universal app would need the native modules of both architectures. Build one app per architecture.'
  if (target === host) return undefined
  const where = WHERE[platform]?.[target] ?? `with an ${target} Node`
  return `This Node runs on ${host}, so npm installed ${host} native modules, and an ${target} app with them would not start. Install the dependencies and build ${where}.`
}

// npm workspaces link moon-bot-core to ../../core, outside the app folder this hook packs
// from. The packaged app needs the package's own files, so the link becomes the copy the
// package would install (its "files" list) before electron-builder collects node_modules.
async function materializeCoreLink() {
  const { lstat, rm, cp, mkdir } = await import('node:fs/promises')
  const { dirname, join, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const app = dirname(dirname(fileURLToPath(import.meta.url)))
  const link = join(app, 'node_modules', 'moon-bot-core')
  const info = await lstat(link).catch(() => null)
  if (info === null || !info.isSymbolicLink()) return
  const core = resolve(app, '..', 'core')
  await rm(link, { recursive: true, force: true })
  await mkdir(dirname(link), { recursive: true })
  // The package's published files, as core/package.json lists them (plus the manifest).
  for (const entry of ['package.json', 'index.js', 'client.js', 'web-search.js', 'dist', 'README.md', 'LICENSE']) {
    await cp(join(core, entry), join(link, entry), { recursive: true }).catch(() => {})
  }
}

export async function beforePack(context) {
  await materializeCoreLink()
  const targets = []
  for (const archToNames of context.packager?.packagerOptions?.targets?.values() ?? [])
    for (const arch of archToNames.keys()) targets.push(Arch[arch])
  const problem = archProblem({ target: Arch[context.arch], platform: context.electronPlatformName, targets })
  if (problem !== undefined) throw new Error(problem)
}

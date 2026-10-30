import assert from 'node:assert/strict'
import { lstatSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Arch } from 'electron-builder'
import { archProblem, beforePack, afterPack, materializeCoreLink, restoreCoreLink } from '../scripts/before-pack.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const coreLink = join(app, 'node_modules', 'moon-bot-core')

function coreLinkKind() {
  try {
    const info = lstatSync(coreLink)
    return info.isSymbolicLink() ? 'link' : 'dir'
  } catch {
    return 'missing'
  }
}

test('a build for the architecture of this Node goes on', async () => {
  assert.equal(archProblem({ target: 'arm64', platform: 'darwin', host: 'arm64' }), undefined)
  assert.equal(archProblem({ target: 'x64', platform: 'win32', host: 'x64' }), undefined)
  await beforePack({ arch: Arch[process.arch], electronPlatformName: process.platform })
  await afterPack()
})

test('a build for another architecture stops and says where to build it', async () => {
  assert.equal(
    archProblem({ target: 'x64', platform: 'darwin', host: 'arm64' }),
    'This Node runs on arm64, so pnpm installed arm64 native modules, and an x64 app with them would not start. Install the dependencies and build on an Intel Mac, or under Rosetta with an x64 Node.',
  )
  assert.match(
    archProblem({ target: 'arm64', platform: 'darwin', host: 'x64' }),
    /build on a Mac with Apple silicon\.$/,
  )
  assert.match(archProblem({ target: 'x64', platform: 'win32', host: 'arm64' }), /build with an x64 Node\.$/)
  assert.match(
    archProblem({ target: 'universal', platform: 'darwin', host: 'arm64' }),
    /Build one app per architecture\./,
  )
  const other = process.arch === 'x64' ? 'arm64' : 'x64'
  // Arch check runs before materialize, so a rejected pack must leave the workspace link intact.
  const before = coreLinkKind()
  await assert.rejects(
    beforePack({ arch: Arch[other], electronPlatformName: process.platform }),
    new RegExp(`an ${other} app with them would not start`),
  )
  assert.equal(coreLinkKind(), before)
})

test('a requested universal build stops before packing either architecture', async () => {
  // electron-builder's MacPackager.doUniversalPack packs x64 then arm64: the hook sees a concrete
  // arch each time, and the universal request only shows in packager.packagerOptions.targets.
  const packager = {
    packagerOptions: { targets: new Map([[{ nodeName: 'darwin' }, new Map([[Arch.universal, ['dmg']]])]]) },
  }
  await assert.rejects(
    beforePack({ arch: Arch.x64, electronPlatformName: 'darwin', packager }),
    /Build one app per architecture\./,
  )
  await assert.rejects(
    beforePack({ arch: Arch.arm64, electronPlatformName: 'darwin', packager }),
    /Build one app per architecture\./,
  )
})

test('electron-builder runs the check before it packs and restores the link after', () => {
  const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  assert.match(yml, /^beforePack: \.\/scripts\/before-pack\.mjs$/m)
  assert.match(yml, /^afterPack: \.\/scripts\/before-pack\.mjs$/m)
})

test('after a materialize, restoreCoreLink puts the workspace symlink back', async t => {
  if (!existsSync(join(app, 'node_modules'))) {
    t.skip('apps/desktop/node_modules missing; run pnpm install first')
    return
  }
  // Ensure we start from a workspace link (pnpm install state).
  await restoreCoreLink()
  assert.equal(coreLinkKind(), 'link')
  await materializeCoreLink()
  assert.equal(coreLinkKind(), 'dir')
  // Core's published tree has no nested fastify; a second pack without restore would miss it.
  assert.equal(existsSync(join(coreLink, 'node_modules', 'fastify')), false)
  await restoreCoreLink()
  assert.equal(coreLinkKind(), 'link')
})

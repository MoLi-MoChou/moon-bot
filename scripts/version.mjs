// The manifests a release tag must agree with (docs/RELEASING.md).
//   node scripts/version.mjs                 print the app/core versions and their tag
//   node scripts/version.mjs 0.2.1           write that version to app and core
//   node scripts/version.mjs connect 0.1.1   write the connect CLI's own version
//
// The desktop tag is vX.Y.Z and must match app/package.json; the CLI tag is
// connect-vX.Y.Z and must match connect/package.json. They move independently.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestOf = path => join(root, path)
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, version) => {
  const manifest = read(path)
  manifest.version = version
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}
const VERSION = /^\d+\.\d+\.\d+$/

const args = process.argv.slice(2)

if (args[0] === 'connect') {
  const path = manifestOf('connect/package.json')
  const wanted = args[1]
  if (wanted === undefined) {
    console.log(`connect ${read(path).version}`)
    console.log(`tag: connect-v${read(path).version}`)
    process.exit(0)
  }
  if (!VERSION.test(wanted)) {
    console.error(`version: ${wanted} is not X.Y.Z`)
    process.exit(2)
  }
  write(path, wanted)
  console.log(`connect/package.json is ${wanted}; next: git commit, then`)
  console.log(`  git tag connect-v${wanted} && git push origin main connect-v${wanted}`)
  process.exit(0)
}

const manifests = ['app/package.json', 'core/package.json'].map(path => manifestOf(path))
const versions = manifests.map(path => read(path).version)
const wanted = args[0]

if (wanted === undefined) {
  console.log(`app ${versions[0]}, core ${versions[1]}`)
  if (versions[0] !== versions[1]) {
    console.error('the versions disagree; make them one before tagging')
    process.exit(1)
  }
  console.log(`tag: v${versions[0]}`)
  process.exit(0)
}

if (!VERSION.test(wanted)) {
  console.error(`version: ${wanted} is not X.Y.Z`)
  process.exit(2)
}
for (const path of manifests) write(path, wanted)
console.log(`both manifests are ${wanted}; next: git commit, then`)
console.log(`  git tag v${wanted} && git push origin main v${wanted}`)

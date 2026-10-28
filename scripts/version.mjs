// The two manifests a release tag must agree with (see docs/RELEASING.md).
//   node scripts/version.mjs           print the versions and the tag they imply
//   node scripts/version.mjs 0.2.1     write that version to app and core, print the tag command
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifests = ['app/package.json', 'core/package.json'].map(path => join(root, path))
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const versions = manifests.map(path => read(path).version)
const wanted = process.argv[2]

if (wanted === undefined) {
  console.log(`app ${versions[0]}, core ${versions[1]}`)
  if (versions[0] !== versions[1]) {
    console.error('the versions disagree; make them one before tagging')
    process.exit(1)
  }
  console.log(`tag: v${versions[0]}`)
  process.exit(0)
}

if (!/^\d+\.\d+\.\d+$/.test(wanted)) {
  console.error(`version: ${wanted} is not X.Y.Z`)
  process.exit(2)
}
for (const path of manifests) {
  const manifest = read(path)
  manifest.version = wanted
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}
console.log(`both manifests are ${wanted}; next: git commit, then`)
console.log(`  git tag v${wanted} && git push origin main v${wanted}`)

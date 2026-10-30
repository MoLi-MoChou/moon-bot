// Moon Bot: what an unpacked app is made of. Prints the total, the top-level files, and
// the largest packages inside app.asar (by the sizes in its header) and app.asar.unpacked.
// Usage: node scripts/size-report.mjs <unpacked app folder> [--json out.json]
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import asar from '@electron/asar'

const root = process.argv[2]
const jsonAt = process.argv.indexOf('--json')
const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`
const du = (path) => {
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((sum, name) => sum + du(join(path, name)), 0)
}
const top = readdirSync(root).map(name => [name, du(join(root, name))]).sort((a, b) => b[1] - a[1])
const total = top.reduce((sum, [, size]) => sum + size, 0)
const pkgOf = (path) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const at = parts.lastIndexOf('node_modules')
  if (at < 0) return parts[0] ?? '(root)'
  return parts[at + 1]?.startsWith('@') ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1]
}
const packages = {}
const resources = join(root, 'resources')
const asarFile = join(resources, 'app.asar')
let asarTotal = 0
for (const file of asar.listPackage(asarFile, { isPack: false })) {
  const entry = asar.statFile(asarFile, file.replace(/^[\\/]/, ''), false)
  if (!('size' in entry) || entry.unpacked) continue
  asarTotal += entry.size
  const key = pkgOf(file)
  packages[key] = (packages[key] ?? 0) + entry.size
}
const unpacked = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else { const key = pkgOf(path.slice(resources.length)); unpacked[key] = (unpacked[key] ?? 0) + stat.size }
  }
}
try { walk(join(resources, 'app.asar.unpacked')) } catch {}
const sorted = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])
console.log(`total ${mb(total)} in ${root}`)
for (const [name, size] of top.slice(0, 12)) console.log(`  ${mb(size).padStart(10)}  ${name}`)
console.log(`app.asar content ${mb(asarTotal)}; largest packages:`)
for (const [name, size] of sorted(packages).slice(0, 30)) console.log(`  ${mb(size).padStart(10)}  ${name}`)
console.log('app.asar.unpacked:')
for (const [name, size] of sorted(unpacked).slice(0, 15)) console.log(`  ${mb(size).padStart(10)}  ${name}`)
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ total, top, asarTotal, packages: sorted(packages), unpacked: sorted(unpacked) }, null, 2))

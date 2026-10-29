// Static component calls: h(Name) where Name is an identifier written in the file.
// h('div'), h(entry.component), h(list[i]) and <Name /> are not this debt.
//
//   node scripts/jsx-debt.mjs           fails when a file is over or under test/jsx-debt.json
//   node scripts/jsx-debt.mjs --write   lowers the baseline; never adds, never raises
//   node scripts/jsx-debt.mjs --add     records the current counts (how a baseline starts)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drops, format, lowered, rises } from './ratchet.mjs'

const PLUGIN = resolve(import.meta.dirname, '..')
export const DEBT = join(PLUGIN, 'test', 'jsx-debt.json')

// A bare identifier, then a comma or the end of the call. A property, an index or a
// conditional is a different character, so those calls are not counted.
const STATIC_H = /(?<![\w$.])h\(\s*([A-Z][A-Za-z0-9_]*)\s*[,)]/g

const code = text => text.split(/\r?\n/)
  .map(line => (/^\s*(\/\/|\/\*|\*\/|\*\s|\*$)/.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
  .join('\n')

export function countFile(text) {
  STATIC_H.lastIndex = 0
  return [...code(text).matchAll(STATIC_H)].length
}

function filesUnder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true })
    .filter(name => /\.(?:ts|tsx)$/.test(name))
    .map(name => name.replaceAll('\\', '/'))
}

/** `{ relative path: count }` for one tree. Paths keep `prefix` so two trees do not collide. */
export function countTree(dir, prefix) {
  const found = {}
  for (const file of filesUnder(dir)) {
    const count = countFile(readFileSync(join(dir, file), 'utf8'))
    if (count > 0) found[`${prefix}${file}`] = count
  }
  return found
}

export function countClient(root = PLUGIN) {
  const trees = [
    [join(root, 'src', 'client'), 'src/client/'],
    [join(root, 'app', 'ui', 'src'), 'app/ui/src/'],
  ]
  if (root === PLUGIN) trees.push([join(dirname(root), 'app', 'ui', 'src'), 'app/ui/src/'])
  const found = {}
  for (const [dir, prefix] of trees) Object.assign(found, countTree(dir, prefix))
  return found
}

const read = file => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = countClient()
  const baseline = read(DEBT)
  if (process.argv.includes('--add')) {
    writeFileSync(DEBT, format(found))
    process.stdout.write(format(found))
  } else if (process.argv.includes('--write')) {
    const next = lowered(baseline, found)
    writeFileSync(DEBT, format(next))
    process.stdout.write(format(next))
  } else {
    const problems = [
      ...rises(baseline, found).map(line => `jsx debt rose: ${line}`),
      ...drops(baseline, found).map(line => `jsx debt fell: ${line}; run node scripts/jsx-debt.mjs --write`),
    ]
    if (problems.length === 0) process.stdout.write('jsx-debt: ok\n')
    else {
      for (const line of problems) console.error(line)
      process.exit(1)
    }
  }
}

// Which tests to run while you iterate: the ones that reach a file you changed.
//
// This is a shortcut, not a gate. A change is done when `pnpm test`, `pnpm run typecheck`
// and `pnpm run lint` pass; a green run here says nothing about the rest of the suite.
//
// Usage:
//   node scripts/test-related.mjs               # changed files from git, then run
//   node scripts/test-related.mjs --list        # only print what it would run
//   node scripts/test-related.mjs --files a.ts,b.ts
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const CORE = join(import.meta.dirname, '..')
const REPO = join(CORE, '..')
const list = process.argv.includes('--list')
const filesArg = process.argv.indexOf('--files')

/** Every source file the import graph covers: the host, the engine and the tests. */
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = join(directory, entry.name)
  if (entry.isDirectory()) return /node_modules|dist|\.git/.test(full) ? [] : walk(full)
  return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
})

/** The files git says changed: staged, unstaged and untracked. */
function changedFromGit() {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })
  if (status.status !== 0) return { files: [], error: 'not a git checkout' }
  const files = []
  for (const line of status.stdout.split('\n')) {
    if (line.trim() === '') continue
    const path = line.slice(3)
    // A rename shows both sides; both matter, the old one for what still imports it.
    for (const part of path.split(' -> ')) files.push(resolve(REPO, part.replace(/^"|"$/g, '')))
  }
  return { files, error: undefined }
}

const sources = [...walk(join(CORE, 'src')), ...walk(join(CORE, 'test'))]

/** Resolve a relative import to the file it names, trying the extensions Node strips. */
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate
  }
  return undefined
}

// Who imports whom, reversed: from a file back to the tests that can reach it.
const importers = new Map()
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    const target = resolveImport(file, match[1])
    if (target === undefined) continue
    const set = importers.get(target) ?? new Set()
    set.add(file)
    importers.set(target, set)
  }
}

const isTest = (file) => file.startsWith(join(CORE, 'test')) && file.endsWith('.test.ts')

/** The tests that reach `start`, directly or through helpers and barrels. */
function relatedTests(start) {
  const found = new Set()
  const seen = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()
    if (isTest(file)) found.add(file)
    for (const importer of importers.get(file) ?? []) {
      if (seen.has(importer)) continue
      seen.add(importer)
      queue.push(importer)
    }
  }
  return found
}

// A fallback for files no test imports by name: `host/roster-rooms.ts` still belongs to
// the `roster` tests, and a missed test is worse here than an extra one.
const GENERIC = new Set(['host', 'src', 'test', 'client', 'engine', 'shared', 'index', 'main'])
function byName(file) {
  const stem = /([^/\\]+)\.tsx?$/.exec(file)?.[1] ?? ''
  const tokens = stem.split(/[-_.]/).filter(token => token.length >= 4 && !GENERIC.has(token))
  if (tokens.length === 0) return []
  return sources.filter(candidate => isTest(candidate)
    && tokens.some(token => /([^/\\]+)\.test\.ts$/.exec(candidate)?.[1]?.includes(token) === true))
}

const explicit = filesArg === -1
  ? undefined
  : (process.argv[filesArg + 1] ?? '').split(',').map(item => item.trim()).filter(item => item !== '')

let changed = explicit?.map(item => resolve(CORE, item))
let error
if (changed === undefined) {
  const git = changedFromGit()
  changed = git.files
  error = git.error
}
changed = (changed ?? []).map(file => (file.endsWith('.tsx') ? file : file.replace(/\.(js|mjs)$/, '.ts')))
  .filter(file => existsSync(file))

const tests = new Set()
for (const file of changed) {
  // A changed test is run as it is; the rest are found through the import graph.
  if (isTest(file)) tests.add(file)
  for (const found of relatedTests(file)) tests.add(found)
  for (const found of byName(file)) tests.add(found)
}
const picked = [...tests].sort()

const shown = (file) => relative(CORE, file).split('\\').join('/')
if (changed.length === 0) {
  console.log(`test:related: no changed files${error === undefined ? '' : ` (${error})`}; run the full suite: npm test`)
  process.exit(0)
}
if (picked.length === 0) {
  console.log(`test:related: ${changed.length} changed file(s), no test reaches them; run the full suite: npm test`)
  process.exit(0)
}
console.log(`test:related: ${changed.length} changed file(s) -> ${picked.length} test file(s):`)
for (const file of picked) console.log(`  ${shown(file)}`)
console.log('test:related: a shortcut only. A change is done when pnpm test, pnpm run typecheck and pnpm run lint pass.')
if (list) process.exit(0)

const run = spawnSync(process.execPath, ['--import', './test/harness-resolve.mjs', '--test', ...picked.map(shown)], { cwd: CORE, stdio: 'inherit' })
process.exit(run.status ?? 1)

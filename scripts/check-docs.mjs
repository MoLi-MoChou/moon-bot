#!/usr/bin/env node
// Relative Markdown links and their anchors. A miss prints the file and the target.
//
//   node scripts/check-docs.mjs
//   node scripts/check-docs.mjs --root <fixture>
//
// An allow entry is a file plus the exact target text, and the reason it stays.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

// Targets that are not files in this tree. Each reason says why the link stays.
const ALLOW = [
  {
    file: 'CHANGELOG.md',
    target: 'README.md#install',
    reason: 'That release note names the Install heading it linked. The heading was renamed later; the entry stays as published.',
  },
]

const args = process.argv.slice(2)
let root = ROOT
let custom = false
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--root') {
    root = resolve(args[index + 1] ?? '')
    custom = true
    index += 1
  }
}

function markdownFiles(dir) {
  if (!custom) {
    const listed = execFileSync('git', ['ls-files', '*.md', '*.MD'], { cwd: dir, encoding: 'utf8' })
    return listed.split('\n').filter(file => file !== '' && !file.includes('/fixtures/'))
  }
  const found = []
  const walk = (at) => {
    for (const name of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, name.name)
      if (name.isDirectory()) walk(path)
      else if (name.name.endsWith('.md')) found.push(path.slice(dir.length + 1).split(sep).join('/'))
    }
  }
  walk(dir)
  return found
}

// GitHub's heading slug: punctuation goes, spaces become hyphens, repeats gain -1, -2.
function slug(text) {
  const plain = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
  return plain.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
}

function anchorsOf(text) {
  const counts = new Map()
  const ids = new Set()
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (heading === null) continue
    const base = slug(heading[2])
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    ids.add(seen === 0 ? base : `${base}-${seen}`)
  }
  return ids
}

function withoutFences(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

function linksOf(text) {
  const body = withoutFences(text)
  const links = []
  const inline = /!?\[(?:\\\]|[^\]])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of body.matchAll(inline)) links.push(match[1])
  const defined = /^\[(?:\\\]|[^\]]+)\]:\s*(\S+)/gm
  for (const match of body.matchAll(defined)) links.push(match[1])
  return links
}

function allowed(file, target) {
  return ALLOW.some(entry => entry.file === file && entry.target === target)
}

const problems = []
for (const file of markdownFiles(root)) {
  const text = readFileSync(join(root, file), 'utf8')
  const here = anchorsOf(text)
  for (const target of linksOf(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue
    if (allowed(file, target)) continue
    const hash = target.indexOf('#')
    const pathPart = hash < 0 ? target : target.slice(0, hash)
    const anchor = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1))
    if (pathPart !== '' && !pathPart.endsWith('.md')) continue
    const decoded = pathPart === '' ? '' : decodeURIComponent(pathPart)
    const absolute = pathPart === '' ? join(root, file) : resolve(dirname(join(root, file)), decoded)
    const rel = normalize(absolute)
    if (!rel.startsWith(normalize(root))) {
      problems.push(`${file}: ${target} leaves the repository`)
      continue
    }
    if (!existsSync(absolute)) {
      problems.push(`${file}: ${target} does not exist`)
      continue
    }
    if (anchor === '') continue
    const ids = pathPart === '' ? here : anchorsOf(readFileSync(absolute, 'utf8'))
    if (!ids.has(anchor)) problems.push(`${file}: ${target} has no heading "${anchor}"`)
  }
}

if (problems.length === 0) {
  process.stdout.write('check-docs: ok\n')
} else {
  for (const problem of problems) console.error(problem)
  console.error(`check-docs: ${problems.length} failure(s)`)
  process.exit(1)
}

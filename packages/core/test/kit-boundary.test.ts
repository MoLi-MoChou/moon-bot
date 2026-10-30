import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
// Kit (`packages/ui` / moon-bot-ui) stays a pure React face: named barrel, no star
// re-exports, no host/store/service/engine, and no client api/actions/sources.

const CORE = fileURLToPath(new URL('..', import.meta.url))
const UI = join(CORE, '..', 'ui', 'src')
const BARREL = join(UI, 'index.ts')

const FORBIDDEN_PKG = /\bfrom\s+['"](?:fastify|@fastify\/|better-sqlite3|sqlite3|electron)(?:\/[^'"]*)?['"]/
const STAR = /^\s*export\s+\*\s+from\b/m
const FORBIDDEN_REL = /from\s+['"](?:\.\.\/)+(?:host|engine|store|service|client)\b|from\s+['"]moon-bot-core(?:\/|$)/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(path)) out.push(path)
  }
  return out
}

test('ui kit barrel is named exports only (no export *)', () => {
  const text = readFileSync(BARREL, 'utf8')
  assert.ok(text.includes('from '), 'barrel must re-export modules')
  assert.equal(STAR.test(text), false, 'barrel must not use export *')
  assert.match(text, /export\s+(?:type\s+)?\{/)
})

test('ui kit sources never import host/store/service/engine/client or forbidden packages', () => {
  const hits: string[] = []
  for (const file of walk(UI)) {
    const text = readFileSync(file, 'utf8')
    if (FORBIDDEN_PKG.test(text)) hits.push(`${file}: forbidden package`)
    if (FORBIDDEN_REL.test(text)) hits.push(`${file}: forbidden layer import`)
  }
  assert.deepEqual(hits, [])
})

test('ui kit barrel lists chrome and empty-state primitives by name', () => {
  const text = readFileSync(BARREL, 'utf8')
  for (const name of [
    'EmptyState',
    'EMPTY_STATE_CSS',
    'Field',
    'Select',
    'Card',
    'Row',
    'Switch',
    'SwitchRow',
    'InlineText',
    'SETTINGS_CHROME_CSS',
  ]) {
    assert.match(text, new RegExp(`\\b${name}\\b`))
  }
})

test('moon-bot-ui package loads EmptyState from dist', async () => {
  const mod = await import('moon-bot-ui')
  assert.equal(typeof mod.EmptyState, 'function')
  assert.equal(typeof mod.Field, 'function')
  assert.equal(typeof mod.SETTINGS_CHROME_CSS, 'string')
  assert.equal(typeof mod.EMPTY_STATE_CSS, 'string')
})

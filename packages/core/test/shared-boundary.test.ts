import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
// Contracts (`packages/contracts`) stay a pure public face: named barrel, no star re-exports,
// and no React / Fastify / SQLite / Electron / layer imports. Prefer the barrel
// (`moon-bot-contracts`) for consumers.

const CORE = fileURLToPath(new URL('..', import.meta.url))
const SHARED = join(CORE, '..', 'contracts', 'src')
const BARREL = join(SHARED, 'index.ts')

const FORBIDDEN = /\bfrom\s+['"](?:react|react-dom|fastify|@fastify\/|better-sqlite3|sqlite3|electron)(?:\/[^'"]*)?['"]/
const STAR = /^\s*export\s+\*\s+from\b/m

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

test('shared barrel is named exports only (no export *)', () => {
  const text = readFileSync(BARREL, 'utf8')
  assert.ok(text.includes('from '), 'barrel must re-export modules')
  assert.equal(STAR.test(text), false, 'barrel must not use export *')
  assert.match(text, /export\s+(?:type\s+)?\{/)
})

test('shared sources never import React, Fastify, SQLite, Electron, or other layers', () => {
  const hits: string[] = []
  for (const file of walk(SHARED)) {
    const text = readFileSync(file, 'utf8')
    if (FORBIDDEN.test(text)) hits.push(`${file}: forbidden package`)
    // Relative climbs into another layer (../client, ../../host, …). Same-layer
    // `./views` etc. are fine; absolute package names are covered above.
    if (/(?:\.\.\/)+(?:client|host|engine|store|service)\b/.test(text)) hits.push(`${file}: layer import`)
  }
  assert.deepEqual(hits, [])
})

test('shared barrel loads and exposes a few known contracts', async () => {
  // Runtime loads the built package (dist/); sources stay .ts for typecheck.
  const mod = await import('moon-bot-contracts')
  assert.equal(typeof mod.LEAN, 'object')
  assert.equal(typeof mod.resolveModelSpec, 'function')
  assert.equal(typeof mod.validateView, 'function')
  assert.ok(Array.isArray(mod.CONNECTOR_CATALOG))
  assert.equal(typeof mod.AvatarSchema?.parse, 'function')
})

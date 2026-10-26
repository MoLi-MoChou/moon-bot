import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The oxlint rules and the three gates oxlint cannot see are separate promises. These
// fixtures exercise the gates that were fake before: the type-aware floating-promise
// check, the layer boundaries, and the size limit. The `any` fixture is optioned by the
// real config through oxlint instead.
const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CHECK = join(PLUGIN, 'scripts', 'check-gates.mjs')
const FIXTURES = join(PLUGIN, 'test', 'fixtures', 'gates')
const OXLINT = join(PLUGIN, 'dev', 'harness', 'node_modules', 'oxlint', 'bin', 'oxlint')

const runGates = fixture =>
  spawnSync(process.execPath, [CHECK, '--root', join(FIXTURES, fixture)], {
    cwd: PLUGIN,
    encoding: 'utf8',
  })
const output = result => `${result.stdout}${result.stderr}`

// Every shape that hid a promise from the old statement-level check. The line numbers are
// part of the contract: a case that stops being reported moves its expected line.
const FLOATING_CASES = [
  [13, 'work()', 'bare call'],
  [17, 'work()', 'parenthesized call'],
  [21, 'work()', 'as-expression around the call'],
  [25, 'work()', 'angle-bracket assertion'],
  [29, 'work()', 'non-null assertion'],
  [33, 'work()', 'right side of &&'],
  [37, 'other()', 'right side of ||'],
  [41, 'work()', 'right side of ??'],
  [45, 'work()', 'true branch of a conditional'],
  [49, 'other()', 'false branch of a conditional'],
  [53, 'new Promise<void>(resolve => resolve())', 'bare new'],
  [57, 'work()', 'left of a comma'],
  [57, 'other()', 'right of a comma'],
  [62, 'pending', 'promise held in a variable, then dropped'],
  [66, 'work()', 'satisfies-expression around the call'],
]

test('every floating form fails with its own file, line and call text', () => {
  const result = runGates('floating')
  assert.notEqual(result.status, 0, output(result))
  const text = output(result)
  for (const [line, call, label] of FLOATING_CASES) {
    assert.ok(
      text.includes(`src/floating.ts:${line} - floating promise: ${call}`),
      `${label}: expected src/floating.ts:${line} - floating promise: ${call}\n${text}`,
    )
  }
  // Await, void, .then()/.catch()/.finally(), assignment and conditional branches under them
  // are the sanctioned forms; only the cases above are failures.
  assert.match(text, /15 floating-promise/)
})

test('each layer boundary fails with a specific message', () => {
  const result = runGates('boundary')
  assert.notEqual(result.status, 0, output(result))
  const text = output(result)
  assert.match(text, /client may not import host/)
  assert.match(text, /host may not import client/)
  assert.match(text, /shared may not import host/)
  assert.match(text, /shared may import only zod and its own files/)
})

test('a file one line over the limit fails', () => {
  const result = runGates('lines')
  assert.notEqual(result.status, 0, output(result))
  assert.match(output(result), /src\/long\.ts: 351 lines \(max 350\)/)
})

test('a test importing a .tsx module fails with the loader hint', () => {
  const result = runGates('tsx-import')
  assert.notEqual(result.status, 0, output(result))
  const text = output(result)
  assert.match(text, /test\/imports-tsx\.test\.js:3 - test imports a \.tsx module/)
  assert.match(text, /Node type stripping cannot load \.tsx/)
  assert.match(text, /1 tsx-in-test/)
})

test('a value import of the type contract and a value export in a declaration file fail', () => {
  const result = runGates('guards')
  assert.notEqual(result.status, 0, output(result))
  const text = output(result)
  assert.match(text, /src\/host\/uses-types\.ts:3 - value import of the type-only contract/)
  assert.match(text, /must be .import type./)
  assert.match(text, /src\/host\/values\.d\.ts:1 - declaration file exports a value \(const\)/)
  assert.match(text, /1 value-import-of-type-contract/)
  assert.match(text, /1 value-export-in-declaration/)
})

test('a clean fixture passes with the one-line success message', () => {
  const result = runGates('clean')
  assert.equal(result.status, 0, output(result))
  // The clean fixture also has a test importing a `.ts` module: that must stay allowed.
  assert.equal(result.stdout.trim(), 'gates: ok')
})

test('the any fixture is caught by the configured oxlint rule', t => {
  if (!existsSync(OXLINT)) return t.skip('dev/harness oxlint is not installed')
  // The real config ignores test fixtures so `npm run lint` stays green. Drop only that
  // ignore list for this direct probe; everything else, including the rule itself, is real.
  // The config keeps `//` notes (JSONC), so strip whole-line comments before parsing.
  const config = JSON.parse(
    readFileSync(join(PLUGIN, '.oxlintrc.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  )
  const directory = mkdtempSync(join(tmpdir(), 'moon-bot-gates-'))
  try {
    const configPath = join(directory, 'oxlint.json')
    writeFileSync(configPath, JSON.stringify({ ...config, ignorePatterns: [] }))
    const result = spawnSync(
      process.execPath,
      [OXLINT, '-c', configPath, join(FIXTURES, 'any', 'src', 'any.ts')],
      { cwd: PLUGIN, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0, output(result))
    assert.match(output(result), /no-explicit-any/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

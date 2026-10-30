// The full suite as a gate instead of a number: a run passes when it ran every test the
// baseline knows about, cancelled nothing, and failed exactly the tests that were already
// failing on the day the migration started. Counting "14 failures" is not enough: a file
// that silently failed to load takes its cases with it, and then 14 looks like the baseline
// while dozens of tests never ran.
//
// Usage: node scripts/test-gate.mjs [--update]   (--update rewrites test/known-red.json)
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CORE = join(import.meta.dirname, '..')
const KNOWN = join(CORE, 'test', 'known-red.json')
const update = process.argv.includes('--update')

// Without the harness packages the run still starts and reports 403 tests instead of 883, which
// looks like a flake far away from the cause. Say it before the suite spends two minutes.
const HARNESS = join(CORE, 'dev', 'harness', 'node_modules', '@deepseek-ai', 'dsh-llm')
if (!existsSync(HARNESS)) {
  console.error(`test-gate: harness missing (${HARNESS}) - run the core test harness setup (see AGENTS.md)`)
  process.exit(1)
}

const run = spawnSync(process.execPath, ['--import', './test/harness-resolve.mjs', '--test', 'test/*.test.js'], {
  cwd: CORE,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`

const numberAfter = label => {
  const match = new RegExp(`^\u2139 ${label} (\\d+)$`, 'm').exec(output)
  return match ? Number(match[1]) : undefined
}
const failures = [
  ...new Set(
    output
      .split('\n')
      .filter(line => line.startsWith('\u2716 '))
      .map(line => line.slice(2).replace(/ \(\d+(?:\.\d+)?ms\)$/, ''))
      .filter(name => name !== 'failing tests:'),
  ),
].sort()

const counts = {
  tests: numberAfter('tests'),
  pass: numberAfter('pass'),
  fail: numberAfter('fail'),
  cancelled: numberAfter('cancelled'),
}
const known = JSON.parse(readFileSync(KNOWN, 'utf8'))

if (update) {
  writeFileSync(KNOWN, `${JSON.stringify({ tests: counts.tests, names: failures }, null, 2)}\n`)
  console.log(`known-red: ${counts.tests} tests, ${failures.length} failing`)
  process.exit(0)
}

const problems = []
if (counts.tests !== known.tests)
  problems.push(`ran ${counts.tests ?? 0} tests, the baseline has ${known.tests} - a test file did not load`)
if (counts.cancelled !== 0) problems.push(`cancelled ${counts.cancelled}`)
const expected = new Set(known.names)
const actual = new Set(failures)
for (const name of expected) if (!actual.has(name)) problems.push(`expected failure now passes: ${name}`)
for (const name of actual) if (!expected.has(name)) problems.push(`new failure: ${name}`)

if (problems.length === 0) {
  console.log(`test-gate: ok - ${counts.tests} tests, ${counts.pass} pass, ${counts.fail} known failures`)
  process.exit(0)
}
for (const problem of problems) console.error(`test-gate: ${problem}`)
console.error(`test-gate: ${problems.length} problem(s)`)
process.exit(1)

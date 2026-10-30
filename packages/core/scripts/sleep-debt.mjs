// A test that waits on the clock: an `await new Promise(...)` whose executor calls
// `setTimeout` with a numeric literal, inside a `test` or `it` callback. A variable
// delay, a race against a real signal, `setImmediate`, and a helper outside the
// callback are not this pattern.
//
//   node scripts/sleep-debt.mjs           fails when a test file is over or under the baseline
//   node scripts/sleep-debt.mjs --write   lowers test/sleep-debt.json
//   node scripts/sleep-debt.mjs --add     records the current counts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { drops, format, lowered, rises } from './ratchet.mjs'

const PLUGIN = resolve(import.meta.dirname, '..')
export const DEBT = join(PLUGIN, 'test', 'sleep-debt.json')

function isTestCall(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  return ts.isIdentifier(callee) && (callee.text === 'test' || callee.text === 'it')
}

function literalDelay(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  if (name !== 'setTimeout') return false
  const delay = node.arguments[1]
  return delay !== undefined && ts.isNumericLiteral(delay)
}

function executorWaits(executor) {
  let found = false
  const visit = node => {
    if (literalDelay(node)) found = true
    ts.forEachChild(node, visit)
  }
  visit(executor)
  return found
}

function isClockWait(statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) return false
  const created = statement.expression.expression
  if (!ts.isNewExpression(created) || !ts.isIdentifier(created.expression) || created.expression.text !== 'Promise') return false
  const executor = created.arguments?.[0]
  return executor !== undefined && executorWaits(executor)
}

/** Line numbers (1-based) of clock waits in one test file. */
export function clockWaits(text, fileName = 'test.ts') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const lines = []
  const walkBody = node => {
    if (isTestCall(node)) return
    if (isClockWait(node)) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    }
    ts.forEachChild(node, walkBody)
  }
  const visit = node => {
    if (isTestCall(node)) {
      for (const argument of node.arguments) walkBody(argument)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

function testFiles(root) {
  const dir = join(root, 'test')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true })
    .map(name => join(dir, name))
    .filter(file => /\.test\.(?:js|ts)$/.test(file) && !relative(root, file).split(sep).includes('fixtures'))
}

/** `{ path from root: count }` and the lines behind each count. */
export function findSleeps(root) {
  const counts = {}
  const lines = {}
  for (const file of testFiles(root)) {
    const rel = relative(root, file).split(sep).join('/')
    const hits = clockWaits(readFileSync(file, 'utf8'), rel)
    if (hits.length === 0) continue
    counts[rel] = hits.length
    lines[rel] = hits
  }
  return { counts, lines }
}

const read = file => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { counts } = findSleeps(PLUGIN)
  const baseline = read(DEBT)
  if (process.argv.includes('--add')) writeFileSync(DEBT, format(counts))
  else if (process.argv.includes('--write')) writeFileSync(DEBT, format(lowered(baseline, counts)))
  else {
    const problems = [
      ...rises(baseline, counts).map(line => `test sleep rose: ${line}`),
      ...drops(baseline, counts).map(line => `test sleep fell: ${line}; run node scripts/sleep-debt.mjs --write`),
    ]
    if (problems.length === 0) process.stdout.write('sleep-debt: ok\n')
    else {
      for (const line of problems) console.error(line)
      process.exit(1)
    }
  }
}

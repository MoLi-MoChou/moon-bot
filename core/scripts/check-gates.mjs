#!/usr/bin/env node
// Migration gates that oxlint cannot express.
//
//  1. Layer boundaries: shared may import only `zod` (and files in shared); client may not
//     import host; host may not import client.
//  2. Size: every logical .js/.ts/.tsx file under src is at most 350 lines. Data and
//     third-party files are exempt; the list of legacy files is explicit below.
//  3. Floating promises: a Promise-returning call or `new` used as a bare statement without
//     await, void, or a .then/.catch/.finally chain, and a promise held in a variable and then
//     dropped the same way. The check unwraps parentheses, `as`,
//     `satisfies`, `!` and angle-bracket assertions, and looks through comma/logical
//     operators, conditional branches and assignment, so `(work() as T)`, `work()!`,
//     `cond && work()` and `cond ? work() : other()` all report. oxlint's rule is a silent
//     no-op unless its type-aware mode is available, so we use the TypeScript compiler API
//     directly.
//  4. Test files may not import `.tsx`: Node's type stripping does not handle JSX, so such a
//     test dies at load time with a confusing extension error. Failing in lint says what to
//     do instead, before `npm test` crashes.
//  5. `dsh-types.js` is a type-only contract: a value import of it would load a file that
//     does not exist, so every reference must be `import type`.
//  6. A declaration file carries no runtime: no top-level value export in a `.d.ts`.
//
// Usage: node scripts/check-gates.mjs [--root <core-like directory>]
// `--root` exists so the gates can be pointed at the fixtures in test/fixtures/gates.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const MAX_LINES = 350
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.tsx'])
const LAYERS = new Set(['shared', 'client', 'host', 'engine', 'store'])

// Exempt by design. The globs are relative to the root (normally core/).
const LINE_EXEMPTIONS = [
  // Static/brand art is generated image data, not hand-written logic.
  'src/client/brand-art.ts', // TODO(phase2 split): static brand art (generated data URLs)
  // Third-party code is reviewed by its upstream, not reshaped by our size gate.
  'src/client/vendor/**',
  // Declaration files describe types; they carry no runtime statements to split. A .d.ts
  // is a document of types, never a way to move logic out of the line gate: a module that
  // holds code keeps it in a .ts and is split for real.
  '**/*.d.ts',
  // UI copy is a dictionary table (data), not a logic file.
  'src/client/i18n/zh.ts', // i18n dictionary table (data, not logic)
]

const DEFAULT_COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
}

const argv = process.argv.slice(2)
let root = resolve(import.meta.dirname, '..')
let customRoot = false
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]
  if (arg === '--root') {
    const value = argv[index + 1]
    if (!value) usage('--root needs a directory')
    root = resolve(value)
    customRoot = true
    index += 1
  } else if (arg.startsWith('--root=')) {
    root = resolve(arg.slice('--root='.length))
    customRoot = true
  } else {
    usage(`unknown argument: ${arg}`)
  }
}

const sourceRoot = join(root, 'src')
if (!existsSync(sourceRoot)) usage(`no src directory under ${root}`)

const findings = { boundaries: [], lines: [], floating: [], tsx: [], typeOnly: [], declarationValues: [], staleExemptions: [] }

// ---------------------------------------------------------------------------
// Source discovery and path helpers.

function usage(message) {
  console.error(`check-gates: ${message}`)
  console.error('usage: node scripts/check-gates.mjs [--root <dir>]')
  process.exit(2)
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function sourceFiles() {
  return walk(sourceRoot).filter(file => SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))))
}

const relPath = file => relative(root, file).split(sep).join('/')

function layerOfPath(file) {
  const rel = relative(sourceRoot, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  const layer = rel.split(sep)[0]
  return LAYERS.has(layer) ? layer : undefined
}

function lineOf(text, position) {
  let line = 1
  for (let index = 0; index < position; index += 1) if (text.charCodeAt(index) === 10) line += 1
  return line
}

function globToRegExp(glob) {
  let pattern = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          pattern += '(?:.*/)?'
          index += 2
        } else {
          pattern += '.*'
          index += 1
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (char === '?') {
      pattern += '[^/]'
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`)
}

const EXEMPT_MATCHERS = LINE_EXEMPTIONS.map(glob => globToRegExp(glob))

function isLineExempt(rel) {
  return EXEMPT_MATCHERS.some(matcher => matcher.test(rel))
}

// ---------------------------------------------------------------------------
// 1. Architecture boundaries.

const IMPORT_PATTERNS = [
  // `import x from '...'`, `import type { X } from '...'`, `import '...'`
  /(?:^|[;\n])\s*import\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?(['"])([^'"]+)\1/g,
  // `export { x } from '...'`, `export * from '...'`, `export type { X } from '...'`
  /(?:^|[;\n])\s*export\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)(['"])([^'"]+)\1/g,
  // `require('...')`
  /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  // `import('...')`
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
]

function checkBoundaries() {
  for (const file of sourceFiles()) {
    const layer = layerOfPath(file)
    if (!layer) continue
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const { specifier, position } of importsOf(text)) {
      const violation = boundaryViolation(layer, file, specifier)
      if (!violation) continue
      findings.boundaries.push(
        `${relPath(file)}:${lineOf(text, position)} - boundary: ${violation} (${specifier})`,
      )
    }
  }
}

function importsOf(text) {
  const imports = []
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const specifier = match[2]
      if (!specifier) continue
      // The position of the specifier itself gives the useful line number for multiline
      // import lists. The specifier is inside the final quoted token, so its last
      // occurrence in the match is the literal we matched.
      const position = match.index + match[0].lastIndexOf(specifier)
      imports.push({ specifier, position })
    }
  }
  return imports.sort((left, right) => left.position - right.position)
}

function targetLayer(file, specifier) {
  const clean = specifier.replace(/[?#].*$/, '')
  if (clean.startsWith('.')) return layerOfPath(resolve(dirname(file), clean))
  if (isAbsolute(clean)) return layerOfPath(clean)
  const parts = clean.split('/').filter(Boolean)
  const index = parts.findIndex(part => LAYERS.has(part))
  if (index < 0) return undefined
  if (index === 0) return parts[0]
  // Also understand repo-rooted spellings such as `core/src/host/x` or `src/host/x`.
  const prefix = parts.slice(0, index).join('/')
  return /(?:^|\/)(?:src|core)(?:\/|$)/.test(prefix) ? parts[index] : undefined
}

function boundaryViolation(layer, file, specifier) {
  const target = targetLayer(file, specifier)
  if (layer === 'client' && (target === 'host' || target === 'engine' || target === 'store')) return `client may not import ${target}`
  if (layer === 'host' && target === 'client') return 'host may not import client'
  if (layer === 'engine' && (target === 'host' || target === 'client')) return `engine may not import ${target}`
  if (layer === 'store' && target !== undefined && target !== 'shared') return 'store may import only shared and its own files'
  if (layer !== 'shared') return undefined
  if (specifier === 'zod' || specifier.startsWith('zod/')) return undefined
  if (target === 'shared') return undefined
  if (target === 'host' || target === 'client') return `shared may not import ${target}`
  return 'shared may import only zod and its own files'
}

// Remove comments while preserving newlines (so line numbers stay exact) and leaving
// string contents alone. That keeps `import` inside prose from being mistaken for code
// while still accepting the simple regex tokenizer above.
function stripComments(text) {
  let output = ''
  let index = 0
  let state = 'code'
  let quote = ''
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') {
        output += '  '
        index += 2
        state = 'line'
      } else if (char === '/' && next === '*') {
        output += '  '
        index += 2
        state = 'block'
      } else if (char === '"' || char === "'" || char === '`') {
        output += char
        quote = char
        state = 'string'
        index += 1
      } else {
        output += char
        index += 1
      }
    } else if (state === 'string') {
      output += char
      if (char === '\\') {
        output += text[index + 1] ?? ''
        index += 2
      } else {
        if (char === quote) state = 'code'
        index += 1
      }
    } else if (state === 'line') {
      if (char === '\n') {
        output += '\n'
        state = 'code'
      } else {
        output += ' '
      }
      index += 1
    } else {
      if (char === '*' && next === '/') {
        output += '  '
        index += 2
        state = 'code'
      } else {
        output += char === '\n' ? '\n' : ' '
        index += 1
      }
    }
  }
  return output
}


// Value declarations inside `declare module`/`declare global` describe modules the
// typesheet does not own (a platform's runtime, a package's API). Those are fine; only a
// top-level value export makes the declaration file look like it has a runtime.
function withoutAmbientBlocks(text) {
  let output = text
  let index = 0
  for (;;) {
    const at = output.indexOf('declare module', index)
    const global = output.indexOf('declare global', index)
    const found = at < 0 ? global : global < 0 ? at : Math.min(at, global)
    if (found < 0) return output
    const open = output.indexOf('{', found)
    if (open < 0) return output
    let depth = 0
    let end = open
    for (; end < output.length; end += 1) {
      if (output[end] === '{') depth += 1
      else if (output[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    output = output.slice(0, open + 1) + output.slice(open + 1, end).replace(/[^\n]/g, ' ') + output.slice(end)
    index = end
  }
}

// ---------------------------------------------------------------------------
// 5. The type-only contract files stay type-only.

// `dsh-types.d.ts` describes DSH; nothing loads it at run time. A value import of it
// would be a runtime import of a file that does not exist, so every reference must be
// `import type` (or an `export type`).
const VALUE_IMPORT_PATTERNS = [
  { kind: 'import', pattern: /(?:^|[;\n])\s*import\s+(?!type\s)(?:[^'";]*?\sfrom\s*)?(['"])([^'"]+)\1/g },
  { kind: 'export', pattern: /(?:^|[;\n])\s*export\s+(?!type\s)(?:[^'";]*?\sfrom\s*)(['"])([^'"]+)\1/g },
  { kind: 'require', pattern: /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
  { kind: 'dynamic import', pattern: /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
]

const TYPE_ONLY_SPECIFIER = /(?:^|\/)dsh-types\.js$/

function checkTypeOnlyImports() {
  for (const file of sourceFiles()) {
    if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) continue
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const { kind, pattern } of VALUE_IMPORT_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        const specifier = match[2]
        if (!specifier || !TYPE_ONLY_SPECIFIER.test(specifier)) continue
        findings.typeOnly.push(
          `${relPath(file)}:${lineOf(text, match.index + match[0].lastIndexOf(specifier))} - value ${kind} of the type-only contract (${specifier}); it must be \`import type\``,
        )
      }
    }
  }
}

// A declaration file carries no runtime. A value export there is either dead or, once
// something imports it, a module that cannot load.
const DECLARATION_VALUE = /^\s*export\s+(?:declare\s+)?(const|let|var|function|class|enum)\b/m

function checkDeclarationValues() {
  for (const file of sourceFiles()) {
    if (!file.endsWith('.d.ts')) continue
    const text = withoutAmbientBlocks(stripComments(readFileSync(file, 'utf8')))
    const match = DECLARATION_VALUE.exec(text)
    if (match === null) continue
    findings.declarationValues.push(
      `${relPath(file)}:${lineOf(text, match.index)} - declaration file exports a value (${match[1]})`,
    )
  }
}

// ---------------------------------------------------------------------------
// 2. Line counts.

function checkLineCounts() {
  for (const file of sourceFiles()) {
    const rel = relPath(file)
    if (isLineExempt(rel)) continue
    const text = readFileSync(file, 'utf8')
    // wc -l counts newlines; a final newline does not add an extra empty line.
    let lines = 0
    for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) lines += 1
    if (lines > MAX_LINES) findings.lines.push(`${rel}: ${lines} lines (max ${MAX_LINES})`)
  }
}

// ---------------------------------------------------------------------------
// 3. Floating promises.

function checkFloatingPromises() {
  const { program, rootNames } = buildProgram()
  if (!program) return
  const checker = program.getTypeChecker()
  for (const fileName of rootNames) {
    const sourceFile = program.getSourceFile(fileName)
    if (!sourceFile) continue
    visit(sourceFile, sourceFile, fileName)
  }

  function visit(node, sourceFile, fileName) {
    if (ts.isExpressionStatement(node)) checkStatement(node, sourceFile, fileName)
    ts.forEachChild(node, child => visit(child, sourceFile, fileName))
  }

  function checkStatement(statement, sourceFile, fileName) {
    // `mode` is where the value of the expression ends up: `stored` means an assignment keeps
    // it (awaiting it later is legitimate), `discarded` means the statement drops it.
    const inspect = (expression, mode) => {
      let current = unwrap(expression)
      if (mode === 'stored') return
      if (ts.isAwaitExpression(current) || ts.isVoidExpression(current)) return
      if (ts.isBinaryExpression(current)) {
        const operator = current.operatorToken.kind
        if (operator === ts.SyntaxKind.CommaToken) {
          inspect(current.left, mode)
          inspect(current.right, mode)
          return
        }
        // The right side of `&&`/`||`/`??` is dropped when the left side decides the result.
        if (
          operator === ts.SyntaxKind.AmpersandAmpersandToken ||
          operator === ts.SyntaxKind.BarBarToken ||
          operator === ts.SyntaxKind.QuestionQuestionToken
        ) {
          inspect(current.left, mode)
          inspect(current.right, mode)
          return
        }
        // Every other binary expression (including `x = work()`) either stores the value or
        // combines plain values; it is not a promise dropped on the floor.
        return
      }
      if (ts.isConditionalExpression(current)) {
        inspect(current.condition, mode)
        inspect(current.whenTrue, mode)
        inspect(current.whenFalse, mode)
        return
      }
      // A promise held in a variable and then dropped as a statement leaks the same way, so
      // a bare identifier statement is a candidate too.
      let candidate
      if (ts.isCallExpression(current)) {
        if (isHandledChain(current)) return
        candidate = current
      } else if (ts.isNewExpression(current) || ts.isIdentifier(current)) {
        candidate = current
      } else return
      const type = checker.getTypeAtLocation(candidate)
      // `any`/`unknown` means the type checker could not prove this is a promise. Do not
      // guess: a false positive here would block unrelated code.
      if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return
      let promised
      try {
        promised = checker.getPromisedTypeOfPromise(type)
      } catch {
        return
      }
      if (promised === undefined) return
      const position = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile))
      const call = candidate.getText(sourceFile).replace(/\s+/g, ' ').trim().slice(0, 160)
      findings.floating.push(
        `${relPath(fileName)}:${position.line + 1} - floating promise: ${call}`,
      )
    }
    inspect(statement.expression, 'discarded')
  }
}

// Wrappers that keep the value but hide the call from the checker: `(work())`,
// `work() as T`, `<T>work()`, `work()!` and `work() satisfies T`.
function unwrap(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function isHandledChain(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  return callee.name.text === 'then' || callee.name.text === 'catch' || callee.name.text === 'finally'
}

// ---------------------------------------------------------------------------
// 4. Test files may not import a `.tsx` module.

function checkTestTsxImports() {
  const testRoot = join(root, 'test')
  if (!existsSync(testRoot)) return
  for (const file of walk(testRoot)) {
    const rel = relPath(file)
    // Fixtures are sample input for the gates themselves, not tests of this repo.
    if (rel.startsWith('test/fixtures/')) continue
    if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(file)) continue
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const { specifier, position } of importsOf(text)) {
      if (!specifier.endsWith('.tsx')) continue
      findings.tsx.push(
        `${rel}:${lineOf(text, position)} - test imports a .tsx module (${specifier}); ` +
          'Node type stripping cannot load .tsx — keep the module in .ts, or run that test ' +
          'through an esbuild loader',
      )
    }
  }
}

function buildProgram() {
  const tsconfig = join(root, 'tsconfig.json')
  let options = DEFAULT_COMPILER_OPTIONS
  if (existsSync(tsconfig)) {
    const config = ts.readConfigFile(tsconfig, ts.sys.readFile)
    if (!config.error) {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
      options = parsed.options
    }
  }
  const rootNames = sourceFiles().filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
  if (rootNames.length === 0) return { program: undefined, rootNames }
  return { program: ts.createProgram({ rootNames, options }), rootNames }
}

// ---------------------------------------------------------------------------
// Run after every declaration above: ESM evaluates the module body top to bottom, so
// calling this earlier would read the regex/glob constants before they exist.


// An exemption is debt: it must point at a real file that the line gate would
// still refuse. A stale entry hides a file that quietly grew back over the limit.
const NATURE_EXEMPTIONS = new Set(['src/client/brand-art.ts'])

function checkStaleExemptions() {
  // The fixture trees under test/fixtures/gates are not the real checkout, so an
  // entry that names a real file simply has no file there.
  if (customRoot) return
  for (const entry of LINE_EXEMPTIONS) {
    if (entry.includes('*') || NATURE_EXEMPTIONS.has(entry)) continue
    const file = join(root, entry)
    if (!existsSync(file)) { findings.staleExemptions.push(`stale exemption: ${entry} does not exist`); continue }
    const lines = readFileSync(file, 'utf8').split('\n').length
    if (lines <= MAX_LINES) findings.staleExemptions.push(`stale exemption: ${entry} is ${lines} lines, the limit no longer needs it`)
  }
}

function main() {
  checkBoundaries()
  checkLineCounts()
  checkFloatingPromises()
  checkTestTsxImports()
  checkTypeOnlyImports()
  checkDeclarationValues()
  checkStaleExemptions()

  const all = [
    ...findings.boundaries, ...findings.lines, ...findings.floating, ...findings.tsx,
    ...findings.typeOnly, ...findings.declarationValues, ...findings.staleExemptions,
  ]
  if (all.length === 0) {
    console.log('gates: ok')
    process.exit(0)
  }
  for (const finding of all) console.error(finding)
  const summary = [
    `${findings.boundaries.length} boundary`,
    `${findings.lines.length} line-count`,
    `${findings.floating.length} floating-promise`,
    `${findings.tsx.length} tsx-in-test`,
    `${findings.typeOnly.length} value-import-of-type-contract`,
    `${findings.declarationValues.length} value-export-in-declaration`,
    `${findings.staleExemptions.length} stale-exemption`,
  ].join(', ')
  console.error(`gates: ${all.length} failure(s) (${summary})`)
  process.exit(1)
}

main()

// Builds client.js, the browser half, from the modules in src/client.
//
//   node scripts/build-client.ts           writes client.js
//   node scripts/build-client.ts --check   exits 1 when client.js differs from a fresh build
//
// client.js is committed, so `link:` and git installs need no build step. dsh loads it as
// a classic script; the wrapper mirrors packages/client/tsdown.client.ts in
// deepseek-harness: `require` resolves the shell-seeded platform modules (react,
// react-dom, ui-primitives, ...), which therefore stay external.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(PLUGIN, 'client.js')
const PLATFORM_MODULES = ['react', 'react-dom']
// The client entry: the migration moved it to TypeScript, and the build follows it.
const ENTRIES = ['src/client/index.tsx', 'src/client/index.ts']
const entry = () => ENTRIES.find(candidate => existsSync(join(PLUGIN, candidate)))

export async function bundleClient() {
  const entryPoint = entry()
  if (entryPoint === undefined) throw new Error(`no client entry; expected one of ${ENTRIES.join(', ')}`)
  const result = await build({
    // Region comments name sources relative to the plugin, wherever the script runs from.
    absWorkingDir: PLUGIN,
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // .ts/.tsx are loaded by esbuild's own loaders. The shell seeds only react,
    // react-dom and the ui primitives, so JSX becomes h() calls: a runtime import of
    // react/jsx-runtime would fail to resolve and the whole client would not register.
    tsconfig: join(PLUGIN, 'tsconfig.json'),
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    external: PLATFORM_MODULES,
    // Moon Bot patch: the app's version, for the settings line that names it.
    define: { __MOON_BOT_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).version) },
    // Every source declaration ships, used or not, as in the hand-written bundle.
    treeShaking: false,
    // Readable for debugging in the browser: no minification, and Chinese text stays text.
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
  })
  if (result.warnings.length > 0) throw new Error(`esbuild warnings:\n${result.warnings.map(warning => warning.text).join('\n')}`)
  return [
    '// Generated from src/client by `npm run build` (scripts/build-client.ts). Do not edit by hand.',
    'window.__ModuleLoader__.load({',
    '  id: \'moon-bot-core\',',
    '  factory: (require) => {',
    'const module = { exports: {} }',
    result.outputFiles[0].text.trimEnd(),
    // The loader gets a plain exports object tagged as a module, as the tsdown preset
    // emits, rather than esbuild's getter-based `__esModule` object.
    'return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: \'Module\' })',
    '  },',
    '})',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = await bundleClient()
  if (process.argv.includes('--check')) {
    let current = null
    try { current = readFileSync(OUTPUT, 'utf8') } catch { /* missing counts as stale */ }
    if (current !== next) {
      console.error('client.js is stale: run `npm run build` in core and commit the result')
      process.exit(1)
    }
  } else {
    writeFileSync(OUTPUT, next)
  }
}

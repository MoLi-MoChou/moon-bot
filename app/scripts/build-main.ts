// Bundles the Electron main process (src/main.ts) into dist-main/main.cjs with esbuild.
// Electron's main must be CommonJS; everything except 'electron' itself is bundled, so the
// package needs no node_modules for the shell to boot. The child Hosts (service-host.ts,
// host.ts) stay source-run from src/ and are not bundled.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const app = dirname(dirname(fileURLToPath(import.meta.url)))
const result = await build({
  absWorkingDir: app,
  entryPoints: [join(app, 'src', 'main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22.18',
  outfile: join(app, 'dist-main', 'main.cjs'),
  external: ['electron'],
  // CommonJS has no import.meta; the sources (main.ts's `here`, profile.ts's INSTALL_ANCHOR)
  // read their own module URL, which in the bundle is this file.
  define: { 'import.meta.url': '__moon_main_import_meta_url' },
  banner: { js: 'var __moon_main_import_meta_url = require("node:url").pathToFileURL(__filename).href' },
  sourcemap: false,
  minify: false,
  // Readable for debugging, as the client bundle is: Chinese text stays text.
  charset: 'utf8',
  logLevel: 'silent',
})
if (result.warnings.length > 0) {
  console.error('build-main: esbuild warnings:')
  for (const warning of result.warnings) console.error(`  ${warning.text}`)
  process.exit(1)
}
console.log('build-main: wrote dist-main/main.cjs')

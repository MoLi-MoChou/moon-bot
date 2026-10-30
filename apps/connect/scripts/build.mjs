// The published CLI is bundled to plain JavaScript: Node refuses to strip types under
// node_modules, so a bin that ships .ts sources works from a checkout and fails from
// `npx`. esbuild inlines the modules and keeps node: builtins external; main.ts already
// starts with the shebang the bin needs.
//
// Skip when esbuild is not installed (production-only installs, Docker's second
// `--prod` layer): prepare still runs, but the CLI is not needed in those trees.
import { chmodSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const entry = join(root, 'src', 'main.ts')
if (!existsSync(entry)) {
  console.log('connect: skip build (src/main.ts missing)')
  process.exit(0)
}
let build
try {
  ;({ build } = await import('esbuild'))
} catch {
  console.log('connect: skip build (esbuild not installed)')
  process.exit(0)
}
const out = join(root, 'dist', 'main.js')
mkdirSync(dirname(out), { recursive: true })
await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  logLevel: 'warning',
})
chmodSync(out, 0o755)
console.log(`connect: wrote ${out}`)

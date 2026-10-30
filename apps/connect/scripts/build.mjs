// The published CLI is bundled to plain JavaScript: Node refuses to strip types under
// node_modules, so a bin that ships .ts sources works from a checkout and fails from
// `npx`. esbuild inlines the modules and keeps node: builtins external; main.ts already
// starts with the shebang the bin needs.
import { build } from 'esbuild'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(dirname(here), 'dist', 'main.js')
mkdirSync(dirname(out), { recursive: true })
await build({
  entryPoints: [join(dirname(here), 'src', 'main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  logLevel: 'warning',
})
chmodSync(out, 0o755)
console.log(`connect: wrote ${out}`)

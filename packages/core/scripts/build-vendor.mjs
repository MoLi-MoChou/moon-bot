// Pre-bundles the slice of framer-motion (MIT) the client uses into
// src/client/vendor/framer-motion.js, tree-shaken and minified, with react external.
// The client build keeps treeShaking off for its own sources, so the library is
// shaken here once.
//
//   node scripts/build-vendor.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse((await import('node:fs')).readFileSync(join(PLUGIN, 'node_modules/framer-motion/package.json'), 'utf8')).version
const result = await build({
  absWorkingDir: PLUGIN,
  stdin: { contents: "export { motion, AnimatePresence, Reorder, useReducedMotion, MotionConfig } from 'framer-motion'", resolveDir: PLUGIN, loader: 'js' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react', 'react-dom'],
  alias: { 'react/jsx-runtime': './scripts/jsx-shim.js', '@emotion/is-prop-valid': './scripts/empty-shim.js' },
  minify: true, treeShaking: true, legalComments: 'none', write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
})
// Evaluated on first use, so a page (or a test) that never animates never loads it,
// and a React without what it needs leaves the callers on their plain fallbacks.
// framer-motion's optional peer is looked up in a try; without it, the lookup throws there.
const body = result.outputFiles[0].text.replaceAll('require("@emotion/is-prop-valid")', '(void 0)')
writeFileSync(join(PLUGIN, 'src/client/vendor/framer-motion.js'), `// framer-motion ${version} (MIT, Copyright (c) 2018 Framer B.V.), pre-bundled by scripts/build-vendor.mjs. Do not edit.
let loaded
export function framerMotion() {
  if (loaded !== undefined) return loaded
  try {
    const module = { exports: {} }
    ;(function (module, exports) {
${body}
    })(module, module.exports)
    loaded = module.exports
  } catch { loaded = null }
  return loaded
}
`)
console.log('vendor bytes', result.outputFiles[0].text.length)

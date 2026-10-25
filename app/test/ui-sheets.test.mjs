// The window installs the Bot views' sheets from its own list (ui/src/sheets.ts). This
// checks that list against the plugin host's (core/src/client/index.ts) and against the
// theme default, so a sheet added to the views cannot silently miss the standalone window.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const CORE = join(APP, '..', 'core')

// The UI is TypeScript with TSX imports; bundle it the way vite would, then import it.
const bundleOf = async (entry) => {
  const built = await build({
    entryPoints: [join(APP, entry)],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment',
    external: ['react', 'react-dom'],
  })
  const path = join(APP, `.test-${entry.replaceAll('/', '-')}.mjs`)
  const { writeFileSync, rmSync } = await import('node:fs')
  writeFileSync(path, built.outputFiles[0].text)
  try {
    return await import(`${pathToFileURL(path).href}?t=${Date.now()}`)
  } finally {
    rmSync(path, { force: true })
  }
}

// The groups the plugin installs, as tags and as the sheets each group is made of.
const pluginGroups = () => {
  const source = readFileSync(join(CORE, 'src/client/index.ts'), 'utf8')
  const shell = source.slice(source.indexOf('const installShell'), source.indexOf('const installConversation'))
  const conversation = source.slice(source.indexOf('const installConversation'))
  const tags = [...source.matchAll(/installCompiledStyles\((?:[A-Z_]+ \+ )*[A-Z_]+, '([a-z-]+)'\)/g)].map(match => match[1])
  const parts = new Set([...source.matchAll(/([A-Z][A-Z0-9_]*_CSS)/g)].map(match => match[1]))
  void shell; void conversation
  return { tags: new Set(tags), parts }
}

test('the window installs every sheet group the plugin host installs', async () => {
  const { SHEET_GROUPS } = await bundleOf('ui/src/sheets.ts')
  const windowTags = new Set(SHEET_GROUPS.map(group => group.tag))
  const plugin = pluginGroups()
  for (const tag of plugin.tags) {
    assert.ok(windowTags.has(tag), `the window is missing the "${tag}" group`)
  }
  // Sheets the window installs although the plugin host does not: the providers page is
  // drawn by the settings overlay either way, and the window has no host to inherit from.
  const WINDOW_ONLY = new Set(['PROVIDERS_CSS'])
  for (const group of SHEET_GROUPS) {
    assert.ok(group.css.length > 0, `the "${group.tag}" group is empty`)
    for (const part of group.parts) {
      assert.ok(plugin.parts.has(part) || WINDOW_ONLY.has(part), `the window names a sheet the plugin does not: ${part}`)
    }
  }
  const named = new Set(SHEET_GROUPS.flatMap(group => group.parts))
  for (const part of plugin.parts) assert.ok(named.has(part), `the window's list is missing ${part}`)
})

test('the empty state and welcome sheets ride with the work-process group', async () => {
  const { SHEET_GROUPS } = await bundleOf('ui/src/sheets.ts')
  const group = SHEET_GROUPS.find(entry => entry.tag === 'work-process')
  assert.ok(group !== undefined)
  assert.deepEqual([...group.parts], ['EMPTY_STATE_CSS', 'WELCOME_CSS', 'PROCESS_CSS', 'RETRY_CSS', 'STARTERS_CSS', 'FILES_PANEL_CSS'])
})

test('a window with no saved theme paints Moon', async () => {
  const { themeIdOf, DEFAULT_THEME } = await bundleOf('ui/src/theme.ts')
  assert.equal(DEFAULT_THEME, 'moon')
  assert.equal(themeIdOf(undefined), 'moon')
  assert.equal(themeIdOf({}), 'moon')
  assert.equal(themeIdOf({ theme: '' }), 'moon')
  assert.equal(themeIdOf({ theme: 'grok' }), 'grok')
  // An id from an older version follows the alias the themes module keeps.
  assert.equal(themeIdOf({ theme: 'monolith' }), 'moon')
})

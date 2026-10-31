import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../src/client/', import.meta.url))
const read = (name: string): Promise<string> => readFile(new URL(name, `file://${root}/`), 'utf8')

test('panel errors keep a local surface instead of resetting their spacing', async () => {
  const [panels, details, memory, settings, usage, createBot] = await Promise.all([
    read('design/panels.ts'),
    read('details-drawer.tsx'),
    read('memory-panel.tsx'),
    read('settings.tsx'),
    read('usage-page.tsx'),
    read('create-bot.tsx'),
  ])
  assert.match(panels, /\.bt-panel-error\{[^}]*flex:none/)
  assert.match(panels, /\.bt-panel-error\{[^}]*padding:8px 10px/)
  assert.match(panels, /\.bt-panel-error\{[^}]*background:color-mix\(in srgb,var\(--bt-danger\)/)
  for (const source of [details, memory, settings, usage, createBot]) {
    assert.doesNotMatch(source, /className='bt-error'[^>]*style=\{\{\s*padding:\s*0/)
  }
})

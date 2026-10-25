import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_COLORS, DEFAULT_SHAPES, MAIN_LOOK, defaultColor, defaultShape, lookOf } from '../src/client/characters.ts'
import { indexRoster } from '../src/client/sources.ts'

const ids = Array.from({ length: 3000 }, (_, index) => `session-${index.toString(16).padStart(8, '0')}-look`)

test('a Bot with no look of its own never gets the whale, gray, brown, or black', () => {
  assert.ok(!DEFAULT_SHAPES.includes('whale'))
  for (const color of ['gray', 'brown', 'black', 'aurora']) assert.ok(!DEFAULT_COLORS.includes(color), color)
  const shapes = new Set(ids.map(defaultShape))
  const colors = new Set(ids.map(defaultColor))
  assert.deepEqual([...shapes].sort(), [...DEFAULT_SHAPES].sort())
  assert.deepEqual([...colors].sort(), [...DEFAULT_COLORS].sort())
})

const roster = (bots, mainBotIds) => indexRoster({ bots, rooms: [], mainBotIds, mainBotId: mainBotIds[0] ?? null })

test('the whale is only a stored look: the browser gives no Bot a look by its place in the team', () => {
  const chief = { id: 'chief', name: 'Chief', createdAt: 1, color: 'lilac', avatar: { shape: 'moonbot' } }
  const writer = { id: 'writer', name: 'Writer', createdAt: 2 }
  assert.deepEqual(lookOf(roster([writer, chief], ['chief']).byId.chief), { ...MAIN_LOOK, image: undefined })
  // The first Main Bot left, with no stored look, keeps the look its id gives it.
  const left = roster([writer], ['writer']).byId.writer
  assert.deepEqual(lookOf(left), { shape: defaultShape('writer'), color: defaultColor('writer'), image: undefined })
  const photo = lookOf({ id: 'chief', avatar: { image: 'data:image/png;base64,AA==' } })
  assert.equal(photo.image, 'data:image/png;base64,AA==')
  assert.equal(photo.shape, defaultShape('chief'))
})

test('Bot settings is the only settings entry; nothing is called Team settings', () => {
  const dir = new URL('../src/client/', import.meta.url)
  const sources = readdirSync(dir).filter(name => /\.(js|ts|tsx)$/.test(name) && !name.endsWith('.d.ts')).map(name => [name, readFileSync(new URL(name, dir), 'utf8')])
  for (const [name, text] of [...sources, ['client.js', readFileSync(new URL('../client.js', import.meta.url), 'utf8')]]) {
    assert.ok(!text.includes('Team settings'), `${name} still names Team settings`)
  }
  const text = name => sources.find(([file]) => file === name)[1]
  assert.match(text('sidebar-account.tsx'), /\[t\('Bot settings'\), GearIcon, \(\) => actions\.openSettings\('general'\)\]/)
  assert.match(text('palette.tsx'), /title: t\('Bot settings'\), run: \(\) => actions\.openSettings\('general'\)/)
  // One Bot's own entries open that Bot, so they read Edit Bot instead.
  assert.match(text('context-menu.tsx'), /\[t\('Edit Bot'\), GearIcon, \(\) => actions\.openSettings\('bots', bot\.id\)\]/)
  assert.match(text('details-drawer.tsx'), /aria-label=\{bot \? t\('Edit Bot'\) : t\('Group settings'\)\} title=\{bot \? t\('Edit Bot'\) : t\('Group settings'\)\}/)
  // A group chat's entries open its own settings the same way.
  assert.match(text('context-menu.tsx'), /\[t\('Group settings'\), GearIcon, \(\) => actions\.openSettings\('groups', room\.id\)\]/)
  assert.ok(!text('mark.tsx').includes('WhaleLogo'))
})

// The capability library's reading rules: which keys an item needs, which tools it serves,
// how its live state folds across Bots, and how the page groups and searches the list.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  botsUsing,
  countsByKind,
  filterCapabilities,
  groupCapabilities,
  healthOf,
  keyReadiness,
  kindOf,
  secretNamesOf,
  sourceOf,
  toolsOf,
} from '../src/client/capability-library.ts'

const item = (name, overrides = {}) => ({ name, kind: 'mcp', description: '', ...overrides })
const bot = (id, capabilities = []) => ({ id, name: id.toUpperCase(), capabilities })

test('a capability names the keys its command, URL, arguments and headers refer to', () => {
  const stdio = item('pg', {
    transport: 'stdio',
    command: 'npx',
    args: ['db', '$MOON_BOT_SECRET_POSTGRES_URL'],
    env: { TOKEN: '$DSH_SECRET_PG_TOKEN', PLAIN: 'x' },
  })
  assert.deepEqual(secretNamesOf(stdio).sort(), ['PG_TOKEN', 'POSTGRES_URL'])
  assert.deepEqual(keyReadiness(stdio, [{ name: 'PG_TOKEN' }]), { total: 2, missing: ['POSTGRES_URL'] })
  assert.deepEqual(keyReadiness(stdio, [{ name: 'PG_TOKEN' }, { name: 'POSTGRES_URL' }]), { total: 2, missing: [] })
  const http = item('exa', {
    transport: 'streamable-http',
    url: 'https://mcp.test/sse?key=$MOON_BOT_SECRET_EXA',
    headers: { Authorization: 'Bearer $MOON_BOT_SECRET_EXA' },
  })
  assert.deepEqual(secretNamesOf(http), ['EXA'])
  assert.deepEqual(keyReadiness(item('skill', { kind: 'skill', content: '$MOON_BOT_SECRET_NOT_RESOLVED' }), []), {
    total: 0,
    missing: [],
  })
})

test('source and tools follow the library, including a pack merging its children', () => {
  assert.equal(sourceOf(item('postgres')), 'market')
  assert.equal(sourceOf(item('my-server')), 'custom')
  assert.equal(kindOf(item('x', { kind: 'skill' })), 'skill')
  const tools = { a: ['mcp__a__one', 'mcp__a__two'], b: ['mcp__b__one'] }
  assert.deepEqual(toolsOf(item('a'), tools), ['mcp__a__one', 'mcp__a__two'])
  assert.deepEqual(toolsOf(item('team', { kind: 'pack', items: ['a', 'b', 'missing'] }), tools), [
    'mcp__a__one',
    'mcp__a__two',
    'mcp__b__one',
  ])
  assert.deepEqual(toolsOf(item('a'), undefined), [])
})

test('health folds the live statuses of every Bot that runs the item', () => {
  const bots = [bot('chief', ['echo', 'team']), bot('writer', ['echo'])]
  assert.deepEqual(healthOf(item('echo'), bots, undefined).state, 'enabled')
  assert.deepEqual(healthOf(item('echo'), [bot('chief')], {}).state, 'off')
  const ready = healthOf(item('echo'), bots, { chief: { echo: { state: 'ready' } } })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.botName, 'CHIEF')
  assert.deepEqual(
    ready.using.map(entry => entry.id),
    ['chief', 'writer'],
  )
  // An error in one Bot wins over another Bot's ready or connecting state.
  assert.equal(
    healthOf(item('echo'), bots, {
      chief: { echo: { state: 'connecting' } },
      writer: { echo: { state: 'error', error: 'boom' } },
    }).state,
    'error',
  )
  assert.equal(
    healthOf(item('echo'), bots, { chief: { echo: { state: 'ready' } }, writer: { echo: { state: 'needs-approval' } } })
      .state,
    'needs-approval',
  )
  assert.equal(healthOf(item('echo'), bots, { chief: { echo: { state: 'connecting' } } }).state, 'connecting')
  assert.deepEqual(
    botsUsing(item('team'), bots).map(entry => entry.id),
    ['chief'],
  )
})

test('the page groups by type, market items first, and searches text plus tool names', () => {
  const items = [
    item('zeta-custom', { description: 'Internal database' }),
    item('postgres', { description: 'Inspect schemas' }),
    item('guide', { kind: 'skill', description: 'How we write' }),
    item('team', { kind: 'pack', items: ['postgres', 'guide'] }),
  ]
  assert.deepEqual(
    groupCapabilities(items).map(group => [group.kind, group.items.map(entry => entry.name)]),
    [
      ['mcp', ['postgres', 'zeta-custom']],
      ['skill', ['guide']],
      ['pack', ['team']],
    ],
  )
  const tools = { postgres: ['mcp__postgres__query'] }
  assert.deepEqual(
    filterCapabilities(items, { query: 'query', kind: 'all', tools }).map(entry => entry.name),
    ['postgres', 'team'],
  )
  assert.deepEqual(
    filterCapabilities(items, { query: 'query', kind: 'mcp', tools }).map(entry => entry.name),
    ['postgres'],
  )
  assert.deepEqual(
    filterCapabilities(items, { query: 'internal', kind: 'mcp' }).map(entry => entry.name),
    ['zeta-custom'],
  )
  assert.deepEqual(
    filterCapabilities(items, { query: '', kind: 'skill' }).map(entry => entry.name),
    ['guide'],
  )
  assert.deepEqual(countsByKind(items), { all: 4, mcp: 2, skill: 1, pack: 1 })
})

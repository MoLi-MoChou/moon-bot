import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRosterRooms } from '../src/host/roster-rooms.ts'
import { RoomSchema } from 'moon-bot-contracts'

test('a room saved before archivedAt exists is not archived', () => {
  const room = RoomSchema.parse({
    id: 'r1', name: 'Ops', members: ['a', 'b'], admin: null, mode: 'everyone', createdAt: 1,
  })
  assert.equal(room.archivedAt, undefined)
})

test('archiving marks a group and restoring clears the mark without dropping its record', async () => {
  const room = {
    id: 'r1', name: 'Ops', members: ['a', 'b'], log: [{ text: 'hi', seq: 1 }], sessions: { a: 'ga' },
  }
  const state = { rooms: { r1: room } }
  let saved = 0
  const rooms = createRosterRooms({
    ctx: {} as never,
    rt: {
      roomOf: (id: string | undefined) => (id === undefined ? undefined : state.rooms[id as 'r1']),
      save: async () => { saved += 1 },
      warn: () => {},
      roomProgress: new Map(),
      roomInbox: new Map(),
      botOf: () => undefined,
      findRooms: () => [],
      dropGroupSession: () => {},
    } as never,
    state: state as never,
    createSession: async () => 's',
    holdName: async (_kind, _name, work) => work(),
    isHeld: () => false,
    saveForDelete: async () => undefined,
  })
  const marked = await rooms.archiveRoom('r1', true)
  const stamp = marked.archivedAt
  assert.equal(typeof stamp, 'number')
  assert.deepEqual(state.rooms.r1.members, ['a', 'b'])
  assert.deepEqual(state.rooms.r1.log, [{ text: 'hi', seq: 1 }])
  assert.equal(state.rooms.r1.sessions.a, 'ga')
  await rooms.archiveRoom('r1', true)
  assert.equal(state.rooms.r1.archivedAt, stamp)
  await rooms.archiveRoom('r1', false)
  assert.equal(Object.hasOwn(state.rooms.r1, 'archivedAt'), false)
  assert.equal(state.rooms.r1.sessions.a, 'ga')
  assert.equal(saved, 3)
  await assert.rejects(() => rooms.archiveRoom('missing', true), /Unknown group chat/)
})

// The host half: the endpoint writes the mark, the room keeps its record, and both a
// user send and a group relay refuse it until it is restored.
const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'b', named: true, sessions: { b: 'gb' }, log: [{ who: 'User', text: 'Keep this', seq: 1 }], seen: { a: 0 }, seq: 1 } },
  agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
})

async function startHost() {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { apply } = await import('../index.js')
  const { fakeContext } = await import('./fake-ctx.ts')
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-archive-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { id: sessionId, session: { id: sessionId }, followup() {}, steer() {}, cancel() {} } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const tool = (name, args, sessionId) => ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, callId: 'c1', signal: new AbortController().signal })
  const stop = async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) }
  await tool('list_bots', {}, 'a')
  return { call, tool, stop }
}

test('archiving a group through the host stops new rounds and keeps its record', async (t) => {
  const host = await startHost()
  t.after(host.stop)
  const archived = await host.call('archive-room', { id: 'r1', archived: true })
  assert.equal(archived.ok, true)
  const room = archived.value.rooms.find(item => item.id === 'r1')
  assert.equal(typeof room.archivedAt, 'number')
  assert.deepEqual(room.members, ['a', 'b'])
  // A user message and a relay both refuse; neither drops the log.
  const sent = await host.call('send', { sessionId: 'r1', text: 'hello' })
  assert.equal(sent.ok, false)
  assert.match(JSON.stringify(sent), /archived/)
  const relay = JSON.parse(await host.tool('group_relay', {}, 'r1'))
  assert.match(relay.error, /archived/)
  const still = (await host.call('state', {})).value.rooms.find(item => item.id === 'r1')
  assert.equal(still.preview, 'Keep this')
  // Restoring clears the mark; the group is back in the sidebar as it was.
  const restored = await host.call('archive-room', { id: 'r1', archived: false })
  const back = restored.value.rooms.find(item => item.id === 'r1')
  assert.equal(back.archivedAt, undefined)
  assert.deepEqual(back.members, ['a', 'b'])
})

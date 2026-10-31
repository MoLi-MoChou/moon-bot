import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionConfigOf } from '../src/service/session-config.ts'
import type { Runtime } from '../src/service/engine-helpers.ts'

interface FakeBot {
  readonly id: string
  readonly model?: string
  readonly appliedModel?: string
}

// The smallest runtime the resolver reads: who owns a Session, which Bot a room's members
// are, and where the Session works.
const runtime = ({
  self = {},
  bots = {},
  rooms = {},
  groupOwners = {},
  workDir,
}: {
  self?: Record<string, string>
  bots?: Record<string, FakeBot>
  rooms?: Record<string, { admin?: string | null; members: readonly string[] }>
  groupOwners?: Record<string, { roomId?: string }>
  workDir?: (input: { botId?: string; roomId?: string }) => string | undefined
} = {}): Runtime =>
  ({
    botOf: (id?: string) => (id === undefined ? undefined : bots[id]),
    selfOf: (id: string) => self[id],
    toolRegistry: { names: () => [], definitions: () => [] },
    ...(workDir === undefined ? {} : { workDirOf: workDir }),
    groupOwners: new Map(Object.entries(groupOwners)),
    roomOf: (id?: string) => (id === undefined ? undefined : rooms[id]),
  }) as unknown as Runtime

test("a Bot's own chat runs on its own model", () => {
  assert.deepEqual(sessionConfigOf(runtime({ self: { s1: 'a' }, bots: { a: { id: 'a', model: 'p/m' } } }), 's1'), {
    model: 'p/m',
  })
})

test('a model already applied wins over the configured one', () => {
  assert.deepEqual(
    sessionConfigOf(
      runtime({ self: { s1: 'a' }, bots: { a: { id: 'a', model: 'p/old', appliedModel: 'p/new' } } }),
      's1',
    ),
    { model: 'p/new' },
  )
})

test("a group chat's own Session borrows its admin's model", () => {
  const config = sessionConfigOf(
    runtime({
      bots: { a: { id: 'a', model: 'p/admin' }, b: { id: 'b', model: 'p/member' } },
      rooms: { r1: { admin: 'a', members: ['a', 'b'] } },
    }),
    'r1',
  )
  // The room matches no Bot of its own, so without this fallback the engine reports NO-MODEL
  // and no group round can ever relay.
  assert.deepEqual(config, { model: 'p/admin' })
})

test("a group chat with no admin borrows its first member's model", () => {
  const config = sessionConfigOf(
    runtime({
      bots: { b: { id: 'b' }, c: { id: 'c', model: 'p/first-with-a-model' } },
      rooms: { r1: { admin: null, members: ['b', 'c'] } },
    }),
    'r1',
  )
  assert.deepEqual(config, { model: 'p/first-with-a-model' })
})

test('a room whose members have no model resolves none, rather than inventing one', () => {
  const config = sessionConfigOf(
    runtime({ bots: { a: { id: 'a' } }, rooms: { r1: { admin: 'a', members: ['a'] } } }),
    'r1',
  )
  assert.deepEqual(config, {})
})

test("a member's group Session keeps its own model, not the room's admin", () => {
  const config = sessionConfigOf(
    runtime({
      self: { s9: 'b' },
      bots: { a: { id: 'a', model: 'p/admin' }, b: { id: 'b', model: 'p/member' } },
      rooms: { r1: { admin: 'a', members: ['a', 'b'] } },
      groupOwners: { s9: { roomId: 'r1' } },
    }),
    's9',
  )
  assert.deepEqual(config, { model: 'p/member' })
})

test('the folder comes from the Bot or the room, and only when there is one', () => {
  const withFolder = sessionConfigOf(
    runtime({
      self: { s1: 'a' },
      bots: { a: { id: 'a', model: 'p/m' } },
      workDir: input => (input.botId === 'a' ? '/work/a' : undefined),
    }),
    's1',
  )
  assert.deepEqual(withFolder, { cwd: '/work/a', model: 'p/m' })
  const none = sessionConfigOf(runtime({ self: { s1: 'a' }, bots: { a: { id: 'a' } } }), 's1')
  assert.deepEqual(none, {})
})

test('an unknown Session resolves nothing rather than throwing', () => {
  assert.deepEqual(sessionConfigOf(runtime(), 'nobody'), {})
})

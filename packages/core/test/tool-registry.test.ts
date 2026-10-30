// The tool registry (plan §阶段 2): one entry serves both paths — the DSH registration
// the classic loop uses, and the schema-validated definition the engine serves. The
// exemplar (create_group) proves the two stay one tool: same executor, same answer.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

interface RegistryLike {
  definitions(names?: readonly string[]): readonly { readonly name: string }[]
  get(name: string):
    | {
        readonly name: string
        readonly parameters: Record<string, unknown>
        execute(
          input: unknown,
          context: unknown,
        ): Promise<{
          readonly content: readonly { readonly type: string; readonly text?: string }[]
          readonly isError?: boolean
        }>
      }
    | undefined
}

test('a registered tool serves DSH unchanged and the engine schema-validated', async t => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-registry-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const ctx = fakeContext()
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async sessionId => ({
        agent: {
          session: { id: sessionId },
          calls: [],
          inbox: { nextStep: [], nextTurn: [], remove: () => false },
          followup() {},
          steer() {},
          cancel() {},
        },
      }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home }) as unknown as { toolRegistry?: RegistryLike }
  t.after(async () => {
    await ctx.dispose()
  })

  // The DSH path: the tool registered exactly as before.
  assert.ok(ctx.registeredTools.has('create_group'), 'registered with DSH')
  const viaDsh = await ctx.registeredTools.get('create_group').execute({ members: ['Writer'] }, { agent: { id: 'a' } })
  assert.match(String(viaDsh), /Created group/)

  // The engine path: the registry holds the same entry, schema-validated.
  const entry = rt.toolRegistry?.get('create_group')
  assert.ok(entry, 'the registry holds create_group')
  const definition = rt.toolRegistry?.definitions(['create_group'])[0] as unknown as {
    readonly name: string
    readonly parameters: { members?: unknown }
    execute(
      args: Record<string, unknown>,
      exec: Record<string, unknown>,
    ): Promise<{ isError?: boolean; content: readonly { type: string; text?: string }[] }>
  }
  assert.ok(definition, 'the registry serves a validated definition')
  assert.equal(definition.name, 'create_group')
  assert.match(JSON.stringify(definition.parameters.members), /Exact names of the other Bots/)

  // Bad input is refused with a model-readable reason, not an executor crash.
  const refused = await definition.execute({ members: 'not-a-list' }, { sessionId: 'a', callId: 'c1' })
  assert.equal(refused.isError, true)
  assert.match(refused.content[0]?.type === 'text' ? (refused.content[0].text ?? '') : '', /cannot accept/)

  // Good input runs the same executor the DSH path runs.
  const created = await definition.execute({ members: ['Writer'] }, { sessionId: 'a', callId: 'c2' })
  assert.match(created.content[0]?.type === 'text' ? (created.content[0].text ?? '') : '', /Created group/)
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(Object.keys(state.rooms).length, 1, 'the group really was created')
})

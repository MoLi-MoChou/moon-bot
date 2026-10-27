import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentRuntime } from '../src/engine/runtime.ts'
import { LocalRunner } from '../src/engine/runner.ts'

const builtin = {
  start: async () => {},
  stop: async () => {},
  runTurn: async function* () {},
  steer: async () => false,
  cancelTurn: async () => {},
} as AgentRuntime

test('LocalRunner chooses the Bot runtime and reuses one ACP process per key', async () => {
  const runner = new LocalRunner({
    builtin,
    emit: () => {},
    catalog: {
      list: () => [{
        id: 'claude', label: 'Claude', command: 'claude', args: [], key: 'claude', kind: 'acp' as const,
      }],
    },
  })

  assert.equal(runner.runtimeFor('builtin-session', undefined), builtin)
  const first = runner.runtimeFor('claude-session', { runtimeId: 'claude' })
  const second = runner.runtimeFor('another-session', { runtimeId: 'claude' })
  assert.notEqual(first, builtin)
  assert.equal(second, first)
  assert.equal(runner.runtimeFor('fallback-session', { runtimeId: 'missing', engine: { kind: 'acp', command: 'fixture-agent', key: 'fixture' } }).constructor.name, 'AcpRuntime')
  assert.equal(runner.runtimeFor('unknown-session', { runtimeId: 'missing' }), builtin)

  await runner.stop()
})

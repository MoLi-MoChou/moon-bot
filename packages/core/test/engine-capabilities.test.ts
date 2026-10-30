import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACP_CAPABILITIES, BUILTIN_CAPABILITIES, capabilitiesFor, offeredTools } from '../src/engine/capabilities.ts'
import { PolicyEngine } from '../src/engine/policy.ts'

const NAMES = [
  'list_bots',
  'message_bot',
  'create_group',
  'working_directory',
  'attach_capability',
  'create_bot',
  'mcp_novel_connector',
]

test('an engine that cannot pause is not offered tools that need a person', () => {
  const offered = offeredTools(NAMES, capabilitiesFor('unsupported'))
  assert.deepEqual(offered, ['list_bots', 'message_bot', 'create_group'])
})

test('the built-in engine and ACP keep the list, and the policy still asks on its own', async () => {
  assert.deepEqual(offeredTools(NAMES, BUILTIN_CAPABILITIES), NAMES)
  assert.deepEqual(offeredTools(NAMES, ACP_CAPABILITIES), NAMES)
  assert.equal(capabilitiesFor('builtin').reportsUsage, true)
  assert.equal(capabilitiesFor('acp').reportsUsage, false)
  assert.equal(capabilitiesFor(undefined).gatesTools, false)
  const decision = await new PolicyEngine({ countersOf: async () => 1 }, { level3PerDay: 0, level4PerDay: 0 }).decide(
    's',
    'create_bot',
  )
  assert.equal(decision.kind, 'approval')
})

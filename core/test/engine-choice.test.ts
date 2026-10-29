// The engine a Bot runs on is the user's choice, so a tool that creates or moves a Bot
// says which engines exist instead of picking one. These run against a fake engine
// catalog: the real one asks the machine what is installed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { engineChoices, engineList, engineOf } from '../src/host/tools/engine-choice.ts'

const catalogOf = (agents: readonly Record<string, unknown>[]) => ({ list: () => agents }) as never

const ACP = { id: 'claude', label: 'Claude Code', command: 'claude', args: ['--acp'], key: 'claude', kind: 'acp', path: '/usr/local/bin/claude', version: '1.2' }
const MISSING = { id: 'ghost', label: 'Ghost', command: 'ghost', args: [], key: 'ghost', kind: 'acp', reason: 'not on PATH' }

test('the built-in engine always comes first and is always usable', () => {
  const choices = engineChoices(catalogOf([ACP]))
  assert.equal(choices[0]?.id, 'builtin')
  assert.equal(choices[0]?.selectable, true)
  assert.deepEqual(choices.slice(1).map(choice => choice.id), ['claude'])
})

test('an engine discovery could not resolve is listed but not offered', () => {
  const choices = engineChoices(catalogOf([ACP, MISSING]))
  const ghost = choices.find(choice => choice.id === 'ghost')
  assert.equal(ghost?.selectable, false)
  assert.equal(ghost?.reason, 'not on PATH')
  // The line a tool prints names only what a Bot can actually run on.
  assert.equal(engineList(choices), 'builtin (Moon Bot built-in), claude (Claude Code)')
})

test('builtin resolves to the built-in engine whatever else is installed', () => {
  const lookup = engineOf('builtin', engineChoices(catalogOf([ACP])), catalogOf([ACP]))
  assert.equal(lookup.ok, true)
  assert.deepEqual(lookup.ok ? lookup.engine : undefined, { kind: 'builtin' })
  assert.equal(lookup.ok ? lookup.runtimeId : undefined, 'builtin')
})

test('a catalog engine becomes the engine the runner launches', () => {
  const catalog = catalogOf([ACP])
  const lookup = engineOf('claude', engineChoices(catalog), catalog)
  assert.equal(lookup.ok, true)
  assert.deepEqual(lookup.ok ? lookup.engine : undefined, { kind: 'acp', command: 'claude', args: ['--acp'], key: 'claude' })
  assert.equal(lookup.ok ? lookup.runtimeId : undefined, 'claude')
})

test('a remote agent keeps its remote id', () => {
  const lookup = engineOf('remote:laptop', engineChoices(catalogOf([])), catalogOf([]))
  assert.equal(lookup.ok, true)
  assert.deepEqual(lookup.ok ? lookup.engine : undefined, { kind: 'acp-remote', agentId: 'laptop' })
})

test('a name that is not an engine is refused with the list, never turned into the built-in one', () => {
  const lookup = engineOf('claud', engineChoices(catalogOf([ACP])), catalogOf([ACP]))
  assert.equal(lookup.ok, false)
  assert.match(lookup.ok ? '' : lookup.message, /There is no engine "claud"/)
  assert.match(lookup.ok ? '' : lookup.message, /claude \(Claude Code\)/)
})

test('an engine that is not installed says so instead of starting a Bot that cannot run', () => {
  const lookup = engineOf('ghost', engineChoices(catalogOf([MISSING])), catalogOf([MISSING]))
  assert.equal(lookup.ok, false)
  assert.match(lookup.ok ? '' : lookup.message, /is not installed on this computer/)
})

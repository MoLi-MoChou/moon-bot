// The permission presets: a Bot's or a group's own ceiling on what runs without asking.
// The rule they must never break is that a preset only narrows — the policy engine's
// daily budgets still apply on top, and an unknown preset is the default, not a pass.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PRESET,
  PRESETS,
  ceilingOf,
  gateOfPreset,
  hasPreset,
  presetValues,
} from '../src/engine/permission-presets.ts'
import { PermissionPresets } from '../src/service/permission-presets.ts'

test('the catalog offers three presets and defaults to the middle one', () => {
  assert.deepEqual(presetValues(), ['read-only', 'workspace-write', 'danger-full-access'])
  assert.equal(DEFAULT_PRESET, 'workspace-write')
  assert.ok(PRESETS.every(preset => preset.name !== '' && preset.description !== ''))
})

test('read only lets reads run and holds back everything that changes something', () => {
  assert.equal(gateOfPreset('read-only', 0), 'within')
  assert.equal(gateOfPreset('read-only', 1), 'ask')
  assert.equal(gateOfPreset('read-only', 2), 'ask')
})

test('the default works inside the budgets and asks before anything irreversible', () => {
  assert.equal(gateOfPreset(DEFAULT_PRESET, 0), 'within')
  assert.equal(gateOfPreset(DEFAULT_PRESET, 1), 'within')
  assert.equal(gateOfPreset(DEFAULT_PRESET, 2), 'within')
  assert.equal(gateOfPreset(DEFAULT_PRESET, 3), 'within')
  // L4 is the irreversible band: it still asks under the default preset.
  assert.equal(gateOfPreset(DEFAULT_PRESET, 4), 'ask')
})

test('full access is the only preset that lets the irreversible band run on its own', () => {
  assert.equal(gateOfPreset('danger-full-access', 4), 'within')
  assert.equal(gateOfPreset('danger-full-access', 3), 'within')
})

test('a missing or unknown preset falls back to the default ceiling, never higher', () => {
  assert.equal(ceilingOf(undefined), ceilingOf(DEFAULT_PRESET))
  assert.equal(ceilingOf('not-a-preset'), ceilingOf(DEFAULT_PRESET))
  assert.equal(hasPreset('not-a-preset'), false)
})

test('a Session keeps the preset the host set on it, and another Session is unaffected', () => {
  const presets = new PermissionPresets()
  presets.set({ id: 'chat:b1' }, 'read-only')
  presets.set({ id: 'group:b1:r1' }, 'danger-full-access')
  assert.equal(presets.of('chat:b1'), 'read-only')
  assert.equal(presets.of('group:b1:r1'), 'danger-full-access')
  assert.equal(presets.of('chat:b2'), undefined)
  // A Session without a pick gets the default ceiling.
  assert.equal(presets.ceiling('chat:b2'), ceilingOf(DEFAULT_PRESET))
  assert.equal(presets.ceiling('chat:b1'), 0)
})

test('an unknown preset is refused with the ones there are', () => {
  const presets = new PermissionPresets()
  assert.throws(() => presets.set({ id: 'chat:b1' }, 'god-mode'), /is not a permission preset/)
  assert.match(
    String(
      (() => {
        try {
          presets.set({ id: 'x' }, 'god-mode')
        } catch (error) {
          return (error as Error).message
        }
      })(),
    ),
    /read-only, workspace-write, danger-full-access/,
  )
})

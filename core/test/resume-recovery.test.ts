import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recoveryOf } from '../src/host/resume-recovery.ts'

test('a cut-off turn is parked, a finished one is dropped, and a second cut is not continued', () => {
  assert.equal(recoveryOf(undefined, false, false), 'park')
  assert.equal(recoveryOf('turn/start', false, false), 'park')
  assert.equal(recoveryOf('turn/end', false, false), 'drop')
  assert.equal(recoveryOf(undefined, true, false), 'keep')
  assert.equal(recoveryOf(undefined, false, true), 'stop')
  assert.equal(recoveryOf('turn/end', true, true), 'drop')
})

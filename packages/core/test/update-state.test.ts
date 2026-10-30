// The version comparison the update cards use: an installed version and a released one,
// with the leading `v` and build metadata the two sources may carry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sameVersion } from '../src/client/update-state.ts'

test('a version compares equal through its v prefix and build metadata', () => {
  assert.equal(sameVersion('0.1.7', '0.1.7'), true)
  assert.equal(sameVersion('v0.1.7', '0.1.7'), true)
  assert.equal(sameVersion('0.1.7+build.5', '0.1.7'), true)
  assert.equal(sameVersion('V0.1.7', '0.1.7'), true)
})

test('a different version, or no version at all, is not the same', () => {
  assert.equal(sameVersion('0.1.8', '0.1.7'), false)
  assert.equal(sameVersion('', ''), false)
  assert.equal(sameVersion(undefined, '0.1.7'), false)
  assert.equal(sameVersion(null, null), false)
})

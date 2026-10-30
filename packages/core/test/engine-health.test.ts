import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canLaunch, healthOf } from '../src/engine/health.ts'
import { failureSay } from '../src/host/turns/failure.ts'

test('health is only what discovery already knows', () => {
  assert.equal(healthOf({ kind: 'builtin' }), 'ready')
  assert.equal(healthOf({ kind: 'acp', path: '/usr/bin/opencode', version: '1.2.3' }), 'ready')
  assert.equal(healthOf({ kind: 'acp', path: '/usr/bin/opencode' }), 'unversioned')
  assert.equal(healthOf({ kind: 'acp', onDemand: true }), 'on-demand')
  assert.equal(healthOf({ kind: 'unsupported', path: '/usr/bin/codex', version: '0.1' }), 'unsupported')
  assert.equal(healthOf({ kind: 'acp' }), 'missing')
  assert.equal(canLaunch({ kind: 'acp', path: '/usr/bin/opencode', version: '1' }), true)
  assert.equal(canLaunch({ kind: 'acp', onDemand: true }), true)
  assert.equal(canLaunch({ kind: 'acp' }), false)
  assert.equal(canLaunch({ kind: 'unsupported', path: '/usr/bin/codex' }), false)
})

test('quota and overload are said apart from a plain server failure', () => {
  assert.equal(failureSay({ code: 'QUOTA' }, false), 'the model is out of quota')
  assert.equal(failureSay({ code: 'QUOTA' }, true), '模型的额度用完了')
  assert.equal(failureSay({ code: 'OVERLOADED' }, false), 'the model is overloaded right now')
  assert.equal(failureSay({ code: 'SERVER' }, false), 'the model service failed')
})

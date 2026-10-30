import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsNoSandbox } from '../src/sandbox.ts'

const files = map => path => map[path]
test('only an AppImage on a kernel without unprivileged user namespaces drops the sandbox', () => {
  const env = { APPIMAGE: '/x.AppImage' }
  assert.equal(needsNoSandbox({ platform: 'win32', env, readText: files({}) }), false)
  assert.equal(
    needsNoSandbox({
      platform: 'linux',
      env: {},
      readText: files({ '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1' }),
    }),
    false,
  )
  assert.equal(needsNoSandbox({ platform: 'linux', env, readText: files({}) }), false)
  assert.equal(
    needsNoSandbox({
      platform: 'linux',
      env,
      readText: files({ '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1' }),
    }),
    true,
  )
  assert.equal(
    needsNoSandbox({ platform: 'linux', env, readText: files({ '/proc/sys/kernel/unprivileged_userns_clone': '0' }) }),
    true,
  )
  assert.equal(
    needsNoSandbox({
      platform: 'linux',
      env: { ...env, DSH_BOT_SANDBOX: '1' },
      readText: files({ '/proc/sys/kernel/unprivileged_userns_clone': '0' }),
    }),
    false,
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capabilityReportOf, capabilitySummary, fallbackFor, reportJson } from '../src/engine/capability-report.ts'
import type { DoctorReport } from '../src/engine/doctor.ts'

const ok = (id = 'engine', methods: readonly string[] = []): DoctorReport => ({
  id,
  ok: true,
  steps: [
    { name: 'executable', status: 'ok' },
    { name: 'version', status: 'ok' },
    { name: 'handshake', status: 'ok' },
    { name: 'session', status: 'ok' },
  ],
  methods,
  kind: 'acp',
})

const failed = (step: 'executable' | 'version' | 'handshake' | 'session', kind = 'acp'): DoctorReport => ({
  id: 'engine',
  ok: false,
  steps: [
    { name: 'executable', status: step === 'executable' ? 'fail' : 'ok' },
    { name: 'version', status: step === 'version' ? 'fail' : step === 'executable' ? 'skipped' : 'ok' },
    {
      name: 'handshake',
      status: step === 'handshake' ? 'fail' : step === 'executable' || step === 'version' ? 'skipped' : 'ok',
    },
    {
      name: 'session',
      status:
        step === 'session'
          ? 'fail'
          : step === 'handshake' || step === 'executable' || step === 'version'
            ? 'skipped'
            : 'ok',
    },
  ],
  methods: [],
  kind,
})

test('a built-in engine supports the features the product promises', () => {
  const builtin: DoctorReport = { ...ok('builtin'), kind: 'builtin', methods: [] }
  const report = capabilityReportOf(builtin, { methods: [] }, 'builtin')
  assert.equal(report.usable, true)
  for (const key of [
    'supportsTools',
    'supportsPermissions',
    'supportsResume',
    'supportsModelDiscovery',
    'supportsUsage',
  ] as const)
    assert.equal(report[key], true, key)
  assert.equal(report.failureCode, undefined)
  assert.equal(report.recommendedFallback, undefined)
})

test('an agent only has the capabilities whose methods it advertised', () => {
  const report = capabilityReportOf(ok('agent', ['session/prompt']), { methods: ['session/prompt'] }, 'acp')
  assert.equal(report.usable, true)
  assert.equal(report.supportsTools, true)
  // A method the agent never mentioned is not assumed.
  assert.equal(report.supportsPermissions, false)
  assert.equal(report.supportsResume, false)
  assert.equal(report.supportsUsage, false)
})

test('every advertised method maps to its capability', () => {
  const report = capabilityReportOf(
    ok('agent', ['session/prompt', 'session/request_permission', 'session/load', 'session/set_model', 'session/usage']),
    { methods: ['session/prompt', 'session/request_permission', 'session/load', 'session/set_model', 'session/usage'] },
    'acp',
  )
  assert.equal(report.supportsTools, true)
  assert.equal(report.supportsPermissions, true)
  assert.equal(report.supportsResume, true)
  assert.equal(report.supportsModelDiscovery, true)
  assert.equal(report.supportsUsage, true)
})

test('an unusable engine reports the first failed check and where to go instead', () => {
  const cases = [
    ['executable', 'ENGINE_MISSING'],
    ['version', 'ENGINE_VERSION_UNKNOWN'],
    ['handshake', 'ENGINE_HANDSHAKE_FAILED'],
    ['session', 'ENGINE_SESSION_FAILED'],
  ] as const
  for (const [step, code] of cases) {
    const report = capabilityReportOf(failed(step), { methods: [] }, 'acp')
    assert.equal(report.usable, false, step)
    assert.equal(report.failureCode, code, step)
    assert.ok((report.recommendedFallback ?? '').length > 0, step)
    for (const key of ['supportsTools', 'supportsPermissions', 'supportsResume'] as const)
      assert.equal(report[key], false, `${step}/${key}`)
  }
})

test('a remote agent is told to reconnect, not to install anything', () => {
  const report = capabilityReportOf(failed('executable', 'acp-remote'), { methods: [] }, 'acp-remote')
  assert.match(report.recommendedFallback ?? '', /Reconnect/)
  assert.doesNotMatch(report.recommendedFallback ?? '', /Install/)
})

test('each failed check has its own next step', () => {
  const steps = ['executable', 'version', 'handshake', 'session'] as const
  const lines = steps.map(step => fallbackFor(step, 'acp'))
  assert.equal(new Set(lines).size, steps.length, 'one sentence per check')
  assert.match(lines[0] ?? '', /Install/)
  assert.match(lines[2] ?? '', /ACP/)
})

test('the JSON form is one object with the fields a script reads', () => {
  const report = capabilityReportOf(failed('handshake'), { methods: [] }, 'acp')
  const parsed = JSON.parse(reportJson(report)) as Record<string, unknown>
  assert.equal(parsed.id, 'engine')
  assert.equal(parsed.usable, false)
  assert.equal(parsed.failureCode, 'ENGINE_HANDSHAKE_FAILED')
  assert.equal(typeof parsed.recommendedFallback, 'string')
  for (const key of [
    'supportsTools',
    'supportsPermissions',
    'supportsResume',
    'supportsModelDiscovery',
    'supportsUsage',
  ])
    assert.equal(typeof parsed[key], 'boolean', key)
  // An unusable report has nothing to claim as supported.
  for (const key of ['supportsTools', 'supportsPermissions', 'supportsResume']) assert.equal(parsed[key], false)
})

test('the summary names what is missing rather than saying everything is fine', () => {
  const partial = capabilityReportOf(ok('agent', ['session/prompt']), { methods: ['session/prompt'] }, 'acp')
  assert.match(capabilitySummary(partial), /without/)
  assert.match(capabilitySummary(partial), /approvals/)
  const broken = capabilityReportOf(failed('handshake'), { methods: [] }, 'acp')
  assert.match(capabilitySummary(broken), /Update the engine/)
})

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeAcp } from '../src/engine/acp/doctor.ts'
import { commandVersion } from '../src/engine/acp/discovery.ts'
import { DoctorStepError, examine, formatDoctor, type DoctorProbe, type DoctorSubject, type HandshakeFacts } from '../src/engine/doctor.ts'

const quiet = (): { probe: DoctorProbe, called: () => boolean } => {
  let used = false
  const probe: DoctorProbe = {
    readVersion: async () => { used = true; return 'should-not-run' },
    handshake: async () => { used = true; return { methods: [] } },
  }
  return { probe, called: () => used }
}

test('doctor does not start a process for engines it must not launch', async () => {
  const { probe, called } = quiet()
  const builtin = await examine({ id: 'builtin', kind: 'builtin' }, probe, { cwd: '' })
  assert.equal(builtin.ok, true)
  assert.equal(builtin.steps[0]?.detail, 'built-in engine')
  assert.equal(builtin.steps[2]?.status, 'skipped')
  const missing = await examine({ id: 'claude', kind: 'acp' }, probe, { cwd: '' })
  assert.equal(missing.ok, false)
  assert.equal(missing.steps[0]?.detail, 'not installed')
  assert.equal(missing.steps[2]?.status, 'skipped')
  const unsupported = await examine({ id: 'codex', kind: 'unsupported', path: '/usr/bin/codex', reason: 'not ACP' }, probe, { cwd: '' })
  assert.equal(unsupported.steps[0]?.detail, 'not ACP')
  const remote = await examine({ id: 'remote:laptop', kind: 'acp-remote' }, probe, { cwd: '' })
  assert.equal(remote.steps[0]?.detail, 'remote agents are not launched here')
  const onDemand = await examine({ id: 'ondemand:claude', kind: 'acp', onDemand: true, version: '@scope/pkg' }, probe, { cwd: '' })
  assert.equal(onDemand.ok, false)
  assert.equal(onDemand.steps[1]?.detail, '@scope/pkg')
  assert.equal(onDemand.steps[2]?.detail, 'doctor does not download packages')
  assert.equal(called(), false)
})

test('a missing version does not skip the handshake, and a prompt fails the session', async () => {
  let versions = 0
  const facts: HandshakeFacts = { methods: ['initialize', 'initialized', 'session/new'], sessionId: 's1', agent: 'fixture 1' }
  const probe: DoctorProbe = {
    readVersion: async () => { versions += 1; return undefined },
    handshake: async () => facts,
  }
  const subject: DoctorSubject = { id: 'opencode', kind: 'acp', path: '/usr/bin/opencode', command: 'opencode' }
  const unversioned = await examine(subject, probe, { cwd: '/tmp/session' })
  assert.equal(unversioned.steps.find(step => step.name === 'version')?.status, 'fail')
  assert.equal(unversioned.steps.find(step => step.name === 'session')?.detail, 's1')
  assert.equal(unversioned.ok, false)
  assert.equal(versions, 1)
  const known = await examine({ ...subject, version: '1.2.3' }, probe, { cwd: '/tmp/session' })
  assert.equal(known.ok, true)
  assert.equal(known.steps.find(step => step.name === 'handshake')?.detail, 'fixture 1')
  assert.equal(versions, 1)
  const prompted = await examine(subject, {
    readVersion: async () => '1',
    handshake: async () => ({ methods: ['initialize', 'session/prompt'], sessionId: 's1' }),
  }, { cwd: '/tmp/session' })
  assert.equal(prompted.steps.find(step => step.name === 'session')?.detail, 'doctor must not send a prompt')
  assert.match(formatDoctor(prompted), /session\tfail\tdoctor must not send a prompt/)
})

test('handshake and session failures stay on their own steps', async () => {
  const probe: DoctorProbe = {
    readVersion: async () => '1',
    handshake: async () => { throw new DoctorStepError('session', 'no session id') },
  }
  const session = await examine({ id: 'opencode', kind: 'acp', path: '/bin/opencode', version: '1' }, probe, { cwd: '' })
  assert.equal(session.steps.find(step => step.name === 'handshake')?.status, 'ok')
  assert.equal(session.steps.find(step => step.name === 'session')?.detail, 'no session id')
  const handshake = await examine({ id: 'opencode', kind: 'acp', path: '/bin/opencode', version: '1' }, {
    readVersion: async () => '1',
    handshake: async () => { throw new Error('no handshake') },
  }, { cwd: '' })
  assert.equal(handshake.steps.find(step => step.name === 'handshake')?.detail, 'no handshake')
  assert.equal(handshake.steps.find(step => step.name === 'session')?.status, 'skipped')
})

const AGENT = `
const { appendFileSync } = require('node:fs')
const log = process.argv[2]
const mode = process.argv[3] || 'ok'
const send = (object) => process.stdout.write(JSON.stringify(object) + '\\n')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  for (let end = input.indexOf('\\n'); end >= 0; end = input.indexOf('\\n')) {
    const line = input.slice(0, end).trim()
    input = input.slice(end + 1)
    if (line === '') continue
    appendFileSync(log, line + '\\n')
    if (mode === 'hang') continue
    const message = JSON.parse(line)
    if (message.method === 'initialize' && mode === 'refuse') send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'no handshake' } })
    else if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, serverInfo: { name: 'fixture', version: '1' } } })
    else if (message.method === 'session/new' && mode === 'permission') send({ jsonrpc: '2.0', id: 'perm', method: 'session/request_permission', params: {} })
    else if (message.method === 'session/new' && mode === 'nosession') send({ jsonrpc: '2.0', id: message.id, result: {} })
    else if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'session-1' } })
    else if (message.method === 'session/prompt') send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
  }
})
`

const methodsOf = (log: string): string[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const message = JSON.parse(line) as { method?: string }
  return typeof message.method === 'string' ? message.method : ''
}).filter(method => method !== '')

test('a scripted agent is checked through session/new and never prompted', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'engine-doctor-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const cwd = join(root, 'session')
  mkdirSync(cwd)
  const log = join(root, 'methods.log')
  const script = join(root, 'agent.cjs')
  writeFileSync(script, AGENT)
  const subject: DoctorSubject = {
    id: 'fixture', kind: 'acp', command: process.execPath, args: [script, log, 'ok'], path: process.execPath, version: 'fixture-1',
  }
  const result = await examine(subject, {
    readVersion: async () => 'unused',
    handshake: (command, args, dir, timeoutMs) => probeAcp(command, args, dir, timeoutMs),
  }, { cwd })
  assert.equal(result.ok, true)
  assert.equal(result.steps.find(step => step.name === 'handshake')?.detail, 'fixture 1')
  assert.equal(result.steps.find(step => step.name === 'session')?.detail, 'session-1')
  assert.deepEqual(methodsOf(log), ['initialize', 'initialized', 'session/new'])
  assert.equal(readFileSync(log, 'utf8').includes('session/prompt'), false)
  assert.deepEqual(readdirSync(cwd), [])
})

test('a refused handshake, a permission ask, and a silent agent stay off the prompt', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'engine-doctor-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const script = join(root, 'agent.cjs')
  writeFileSync(script, AGENT)
  const run = async (mode: string, timeoutMs: number) => {
    const log = join(root, `${mode}.log`)
    writeFileSync(log, '')
    const result = await examine({
      id: mode, kind: 'acp', command: process.execPath, args: [script, log, mode], path: process.execPath, version: 'fixture-1',
    }, {
      readVersion: async () => 'unused',
      handshake: (command, args, dir, timeout) => probeAcp(command, args, dir, timeout),
    }, { cwd: root, timeoutMs })
    return { result, log: readFileSync(log, 'utf8') }
  }
  const refused = await run('refuse', 2_000)
  assert.equal(refused.result.steps.find(step => step.name === 'handshake')?.detail, 'no handshake')
  assert.equal(refused.result.steps.find(step => step.name === 'session')?.status, 'skipped')
  assert.equal(refused.log.includes('session/prompt'), false)
  const asked = await run('permission', 2_000)
  assert.equal(asked.result.steps.find(step => step.name === 'session')?.detail, 'the agent asked for permission')
  assert.equal(asked.log.includes('session/prompt'), false)
  assert.equal(asked.log.includes('"outcome"'), false)
  const silent = await run('hang', 300)
  assert.equal(silent.result.steps.find(step => step.name === 'handshake')?.detail, 'the agent did not answer')
  assert.equal(silent.log.includes('session/new'), false)
  assert.equal(silent.log.includes('session/prompt'), false)
})

test('commandVersion reads a local executable', () => {
  const version = commandVersion(process.execPath)
  assert.match(version ?? '', /v\d+/u)
})

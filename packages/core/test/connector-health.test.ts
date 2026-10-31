import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backoffFor,
  classifyFailure,
  fingerprintOf,
  retryableByItself,
  type ConnectorState,
} from '../src/host/connector-health.ts'
import {
  connectorActionOf,
  connectorMetaText,
  connectorStateText,
  wantsTokenForm,
  type ConnectorHealthView,
} from '../src/client/connector-state.ts'

const view = (patch: Partial<ConnectorHealthView> = {}): ConnectorHealthView => ({ state: 'off', ...patch })

test('a configuration fingerprint is stable and changes with any part of the config', () => {
  const base = { id: 'github', transport: 'streamable-http', url: 'https://example.test/mcp', secret: 'set' }
  assert.equal(fingerprintOf(base), fingerprintOf({ ...base }))
  // Order of header names must not matter; the values must.
  assert.equal(
    fingerprintOf({ ...base, headers: { A: '1', B: '2' } }),
    fingerprintOf({ ...base, headers: { B: '2', A: '1' } }),
  )
  for (const changed of [
    { ...base, url: 'https://example.test/other' },
    { ...base, transport: 'sse' },
    { ...base, secret: 'cleared' },
    { ...base, id: 'other' },
    { ...base, args: ['--flag'] },
    { ...base, headers: { A: '1' } },
  ]) {
    assert.notEqual(fingerprintOf(base), fingerprintOf(changed), JSON.stringify(changed))
  }
})

test('a fingerprint carries no secret text', () => {
  const fingerprint = fingerprintOf({ id: 'c', secret: 'set', url: 'https://example.test' })
  assert.match(fingerprint, /^[0-9a-f]{8}$/)
  assert.equal(fingerprint.includes('set'), false)
})

test('backoff grows with the failure count and stops after the last step', () => {
  const now = 1_000_000
  assert.equal(backoffFor(0, now), undefined)
  const first = backoffFor(1, now)
  const second = backoffFor(2, now)
  const last = backoffFor(99, now)
  assert.ok(first !== undefined && second !== undefined && last !== undefined)
  assert.ok(first < second)
  assert.equal(backoffFor(99, now), last)
  assert.ok(last - now <= 300_000)
})

test('a rejected credential needs the user, not another attempt', () => {
  for (const error of [
    { status: 401 },
    { status: 403 },
    { statusCode: '401' },
    { message: 'GitHub did not accept this token' },
    { message: 'Bad credentials' },
  ]) {
    const failure = classifyFailure(error)
    assert.equal(failure.state, 'needs-auth', JSON.stringify(error))
    assert.equal(retryableByItself(failure), false)
  }
})

test('a transport failure may clear on its own', () => {
  for (const error of [
    { status: 500 },
    { status: 503 },
    { status: 429 },
    { message: 'fetch failed' },
    { message: 'ETIMEDOUT' },
    { message: 'The operation timed out' },
    { code: 'ECONNREFUSED' },
  ]) {
    const failure = classifyFailure(error)
    assert.equal(failure.state, 'error', JSON.stringify(error))
    assert.equal(retryableByItself(failure), true, JSON.stringify(error))
  }
})

test('a missing command or server is unavailable, not an error to retry', () => {
  for (const error of [{ status: 404 }, { code: 'ENOENT' }, { message: 'spawn npx ENOENT' }]) {
    const failure = classifyFailure(error)
    assert.equal(failure.state, 'unavailable', JSON.stringify(error))
    assert.equal(retryableByItself(failure), false)
  }
})

test('an unknown failure is reported but never retried blindly', () => {
  const failure = classifyFailure(new Error('the tool schema was invalid'))
  assert.equal(failure.state, 'error')
  assert.equal(failure.retryable, false)
  assert.match(failure.message, /schema/)
})

test('a failure keeps the cause text the MCP client wrapped', () => {
  const failure = classifyFailure(Object.assign(new Error('mount failed'), { cause: new Error('401 unauthorized') }))
  assert.match(failure.message, /mount failed/)
  assert.match(failure.message, /401 unauthorized/)
})

test('every state reads differently and offers one next step', () => {
  const states: ConnectorState[] = [
    'off',
    'connecting',
    'ready',
    'needs-auth',
    'needs-approval',
    'error',
    'unavailable',
  ]
  const texts = states.map(state => connectorStateText(view({ state, about: 'repos', account: 'me' })))
  assert.equal(new Set(texts).size, states.length, 'each state needs its own sentence')
  for (const text of texts) assert.ok(text.length > 0)

  assert.deepEqual(connectorActionOf(view({ state: 'off' })), { kind: 'connect' })
  assert.deepEqual(connectorActionOf(view({ state: 'needs-auth' })), { kind: 'replace-token' })
  assert.deepEqual(connectorActionOf(view({ state: 'error' })), { kind: 'retry' })
  assert.deepEqual(connectorActionOf(view({ state: 'needs-approval' })), { kind: 'approve' })
  for (const state of ['ready', 'connecting', 'unavailable'] as ConnectorState[])
    assert.deepEqual(connectorActionOf(view({ state })), { kind: 'none' })
})

test('a state that needs a new token opens the form; a broken one offers retry instead', () => {
  assert.equal(wantsTokenForm(view({ state: 'off' })), true)
  assert.equal(wantsTokenForm(view({ state: 'needs-auth' })), true)
  assert.equal(wantsTokenForm(view({ state: 'error' })), false)
  assert.equal(wantsTokenForm(view({ state: 'ready' })), false)
})

test('the meta line says when it last worked, or that a retry is coming', () => {
  const format = (time: number): string => `${String(time)}`
  assert.equal(connectorMetaText(view({ state: 'ready', lastOkAt: 5 }), 100, format), 'Last connected 5')
  assert.match(connectorMetaText(view({ state: 'error', retryAt: 900 }), 100, format) ?? '', /on its own/)
  // A retry time already in the past is not announced as coming.
  assert.equal(connectorMetaText(view({ state: 'error', retryAt: 50, lastErrorAt: 10 }), 100, format), 'Failed 10')
  assert.equal(connectorMetaText(view({ state: 'off' }), 100, format), null)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgs } from '../src/args.ts'

test('parses --url and --token, spaced and inline forms agree', () => {
  const spaced = parseArgs(['--url', 'wss://host:8290/api/bot/relay', '--token', 'tok'])
  const inline = parseArgs(['--url=wss://host:8290/api/bot/relay', '--token=tok'])
  assert.deepEqual(spaced, inline)
  assert.deepEqual(spaced, { ok: true, help: false, url: 'wss://host:8290/api/bot/relay', token: 'tok', command: [] })
})

test('everything after -- is the agent command, untouched', () => {
  const outcome = parseArgs([
    '--url',
    'wss://h/relay',
    '--token',
    't',
    '--',
    'claude',
    '--model',
    'fast',
    '--',
    'later',
  ])
  assert.ok(outcome.ok && !outcome.help)
  assert.deepEqual(outcome.command, ['claude', '--model', 'fast', '--', 'later'])
})

test('-h and --help win, but only before --', () => {
  assert.deepEqual(parseArgs(['--help']), { ok: true, help: true })
  assert.deepEqual(parseArgs(['-h']), { ok: true, help: true })
  // After "--" the same word belongs to the agent command, not to us.
  const asCommand = parseArgs(['--url', 'wss://h/relay', '--token', 't', '--', '--help'])
  assert.ok(asCommand.ok && !asCommand.help)
  assert.deepEqual(asCommand.command, ['--help'])
})

test('rejects unknown options, stray arguments and missing values', () => {
  const bad = (argv: readonly string[], pattern: RegExp): void => {
    const outcome = parseArgs(argv)
    assert.equal(outcome.ok, false, JSON.stringify(argv))
    assert.match(!outcome.ok ? outcome.error : '', pattern)
  }
  bad(['--wat'], /unknown option "--wat"/)
  bad(['wss://h/relay', '--token', 't'], /after "--"/)
  bad(['--url'], /--url requires a value/)
  bad(['--url=wss://h/relay', '--token'], /--token requires a value/)
  bad(['--url', 'wss://h/relay'], /missing --token/)
  bad(['--token', 't'], /missing --url/)
  bad(['--url', '', '--token', 't'], /missing --url/)
})

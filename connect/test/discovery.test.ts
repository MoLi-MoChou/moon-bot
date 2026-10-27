import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACP_CANDIDATES, findAgents, firstPathOf, lookupToolFor, pickAgent, pickFailureMessage, type FoundAgent } from '../src/discovery.ts'

const agent = (id: string, path: string): FoundAgent => {
  const candidate = ACP_CANDIDATES.find(entry => entry.id === id)
  if (candidate === undefined) throw new Error(`no candidate named ${id}`)
  return { ...candidate, path }
}

test('the candidates are the ACP agents core discovers', () => {
  assert.deepEqual(ACP_CANDIDATES.map(candidate => candidate.command), ['claude', 'gemini', 'opencode'])
})

test('the lookup tool follows the platform: which, except where.exe on windows', () => {
  assert.equal(lookupToolFor('linux'), 'which')
  assert.equal(lookupToolFor('darwin'), 'which')
  assert.equal(lookupToolFor('win32'), 'where.exe')
})

test('a successful lookup keeps only the first path line', () => {
  assert.equal(firstPathOf({ status: 0, stdout: '\n/usr/bin/claude\n/usr/local/bin/claude\n' }), '/usr/bin/claude')
  assert.equal(firstPathOf({ status: 0, stdout: 'C:\\Tools\\gemini.cmd\r\n' }), 'C:\\Tools\\gemini.cmd')
  assert.equal(firstPathOf({ status: 1, stdout: '/usr/bin/claude' }), undefined)
  assert.equal(firstPathOf({ status: null, stdout: '' }), undefined)
})

test('findAgents probes every candidate command through the lookup', () => {
  const probed: string[][] = []
  const found = findAgents(undefined, (tool, args) => {
    probed.push([tool, args[0] ?? ''])
    return args[0] === 'gemini' ? { status: 0, stdout: '/opt/gemini/bin/gemini\n' } : { status: 1, stdout: '' }
  })
  assert.deepEqual(probed, ACP_CANDIDATES.map(candidate => [lookupToolFor(process.platform), candidate.command]))
  assert.deepEqual(found, [agent('gemini', '/opt/gemini/bin/gemini')])
})

test('pickAgent takes exactly one agent and leaves none and several to the user', () => {
  const claude = agent('claude', '/usr/bin/claude')
  const gemini = agent('gemini', '/usr/bin/gemini')
  assert.deepEqual(pickAgent([claude]), { ok: true, agent: claude })
  assert.deepEqual(pickAgent([]), { ok: false, problem: 'none', found: [] })
  assert.deepEqual(pickAgent([claude, gemini]), { ok: false, problem: 'multiple', found: [claude, gemini] })
})

test('the failure message names what it saw and how to choose', () => {
  assert.match(pickFailureMessage([]), /looked for: claude, gemini, opencode/)
  const several = pickFailureMessage([agent('claude', '/usr/bin/claude'), agent('gemini', '/usr/bin/gemini')])
  assert.match(several, /Claude \(\/usr\/bin\/claude\)/)
  assert.match(several, /after "--"/)
  assert.match(several, /-- claude/)
})

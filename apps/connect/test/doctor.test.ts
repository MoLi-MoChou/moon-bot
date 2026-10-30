// The doctor's value is the order and the wording: Node first, then the agents a machine
// has, then the invite — each failure naming the fix. No network here: the relay check
// takes an injected socket.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { doctor, type DoctorDeps, type SocketLike } from '../src/doctor.ts'

const lines = (): { out: string[]; err: string[]; print: (line: string) => void } => {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    print: (line: string) => {
      out.push(line)
    },
  }
}

const agent = { id: 'claude', label: 'Claude', command: 'claude', path: '/usr/bin/claude' }

const fakeSocket =
  (behaviour: 'open' | 'reject' | 'revoked' | 'error'): DoctorDeps['connect'] =>
  (_url, box) => {
    const socket: SocketLike = {
      close: () => {
        box.current = undefined
      },
    }
    box.current = socket
    setImmediate(() => {
      if (behaviour === 'open') socket.onopen?.()
      else if (behaviour === 'error') socket.onerror?.()
      else if (behaviour === 'reject') socket.onclose?.({ code: 4401 })
      else socket.onclose?.({ code: 4403 })
    })
    return socket
  }

test('a healthy machine and a live invite pass every check', async () => {
  const print = lines()
  const code = await doctor(
    { url: 'wss://host/api/bot/relay', token: 't', stdout: print.print, stderr: print.print },
    { nodeVersion: '24.1.0', agents: [agent], connect: fakeSocket('open') },
  )
  assert.equal(code, 0)
  assert.match(print.out.join('\n'), /ok\s+node/)
  assert.match(print.out.join('\n'), /ok\s+agent: Claude at \/usr\/bin\/claude/)
  assert.match(print.out.join('\n'), /ok\s+relay: relay accepted the invite/)
})

test('an unknown or revoked invite fails with the fix, not the code alone', async () => {
  for (const [behaviour, expected] of [
    ['reject', /ask a Main Bot for a new one/],
    ['revoked', /was revoked/],
  ] as const) {
    const print = lines()
    const code = await doctor(
      { url: 'wss://host/api/bot/relay', token: 't', stdout: print.print, stderr: print.print },
      { nodeVersion: '24.1.0', agents: [agent], connect: fakeSocket(behaviour) },
    )
    assert.equal(code, 1)
    assert.match(print.out.join('\n'), expected)
  }
})

test('no agents, an old Node, and no invite named: three failures and no relay check', async () => {
  const print = lines()
  const code = await doctor({ stdout: print.print, stderr: print.print }, { nodeVersion: '20.9.0', agents: [] })
  assert.equal(code, 1)
  const text = print.out.join('\n')
  assert.match(text, /FAIL node: v20\.9\.0 — need 22\.18 or newer/)
  assert.match(text, /FAIL agent: No local agent found/)
  assert.match(text, /skip relay: pass --url and --token/)
})

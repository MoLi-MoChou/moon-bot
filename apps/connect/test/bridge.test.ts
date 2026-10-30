import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LineSplitter, buildRelayUrl } from '../src/bridge.ts'

test('the splitter emits whole lines and keeps a torn tail buffered', () => {
  const splitter = new LineSplitter()
  assert.deepEqual(splitter.feed('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":'), ['{"jsonrpc":"2.0","id":1}'])
  assert.deepEqual(splitter.feed('"2.0"}\n'), ['{"jsonrpc":"2.0"}'])
})

test('the splitter drops blank lines and tolerates CRLF', () => {
  const splitter = new LineSplitter()
  assert.deepEqual(splitter.feed('\r\n{"a":1}\r\n\n{"b":2}\n'), ['{"a":1}', '{"b":2}'])
  // A final line without its newline waits for more bytes, as a torn chunk would.
  assert.deepEqual(splitter.feed('{"c":3}'), [])
  assert.deepEqual(splitter.feed('\n'), ['{"c":3}'])
})

test('the relay URL carries the token as a query parameter', () => {
  assert.equal(buildRelayUrl('wss://host:8290/api/bot/relay', 'tok'), 'wss://host:8290/api/bot/relay?token=tok')
  assert.equal(
    buildRelayUrl('ws://127.0.0.1:8290/api/bot/relay?agent=kai', 'invite code'),
    'ws://127.0.0.1:8290/api/bot/relay?agent=kai&token=invite+code',
  )
  // A stale token in the URL must not survive into the connection.
  assert.equal(buildRelayUrl('wss://host/relay?token=old', 'new'), 'wss://host/relay?token=new')
})

test('the relay URL rejects what is not a WebSocket endpoint', () => {
  assert.throws(() => buildRelayUrl('https://host:8290/api/bot/relay', 't'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => buildRelayUrl('host:8290/relay', 't'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => buildRelayUrl('not a url at all', 't'), /not a valid URL/)
})

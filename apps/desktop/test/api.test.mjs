import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openFeed } from '../ui/src/api.ts'

test('openFeed delivers a final SSE event when the stream ends without a blank line', async (t) => {
  const encoder = new TextEncoder()
  let reads = 0
  const previousFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = previousFetch })
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          reads += 1
          return reads === 1
            ? { value: encoder.encode('event: final\ndata: {"id":"last"}'), done: false }
            : { value: undefined, done: true }
        },
      }),
    },
  })

  const events = []
  const closeFeed = openFeed((event, data) => {
    events.push({ event, data })
    if (event === 'final') closeFeed()
  })
  await new Promise(resolve => setImmediate(resolve))

  closeFeed()
  assert.deepEqual(events, [{ event: 'final', data: { id: 'last' } }])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ServiceApproval } from '../src/service/approval.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('ServiceApproval uses the request id for the card and settles by that id', async () => {
  let seenId: string | undefined
  let open: Promise<string> | undefined
  const approval = new ServiceApproval((request, next) => {
    seenId = request.approvalId
    open = next(request.approvalId)
    return open
  })
  const request = approval.request({
    agent: { id: 'b', session: { id: 'b', seq: 0 } },
    toolName: 'pwsh',
    reason: 'needs approval',
  })
  await tick()
  assert.equal(typeof seenId, 'string')
  assert.equal(open, approval.card(seenId!))
  assert.equal(approval.answer('unknown', 'allowed-once'), false)
  assert.equal(approval.answer(seenId!, 'allowed-once'), true)
  assert.equal(await request, 'allowed-once')
})

test('ServiceApproval aborts only its own pending request', async () => {
  let firstId: string | undefined
  let secondId: string | undefined
  const approval = new ServiceApproval((request, next) => {
    if (firstId === undefined) firstId = request.approvalId
    else secondId = request.approvalId
    return next(request.approvalId)
  })
  const firstSignal = new AbortController()
  const first = approval.request({
    agent: { id: 'a', session: { id: 'a', seq: 0 } },
    reason: 'first',
    signal: firstSignal.signal,
  })
  const second = approval.request({
    agent: { id: 'b', session: { id: 'b', seq: 0 } },
    reason: 'second',
  })
  await tick()
  firstSignal.abort()
  assert.equal(await first, 'cancelled')
  assert.equal(approval.answer(firstId!, 'allowed-once'), false)
  assert.equal(approval.answer(secondId!, 'rejected'), true)
  assert.equal(await second, 'rejected')
})

// The bridge's pending-turn count (2026-10-28 tasks-panel): a followup that lands while
// a turn runs waits for its own turn, and the task panel shows that number as the queue.
// These drive `engineAgentOf` with a runtime whose turns the test releases by hand, so
// every step (accepted, begun, cancelled) is observed at a real barrier.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { engineAgentOf } from '../src/engine/builtin/bridge.ts'
import type { AgentRuntime } from '../src/engine/runtime.ts'

/** Wait for a condition at a real barrier: setImmediate turns, never a fixed sleep. */
const settle = async (check: () => boolean, what: string): Promise<void> => {
  for (let turn = 0; turn < 200; turn += 1) {
    if (check()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail(`timed out waiting for ${what}`)
}

/** A runtime whose turns block until the test lets them run, one release at a time. */
function heldRuntime() {
  const releases: (() => void)[] = []
  const cancelled: string[] = []
  const runtime: AgentRuntime = {
    start: async () => {},
    stop: async () => {},
    steer: async () => false,
    cancelTurn: async (_sessionId: string, reason?: string) => { cancelled.push(reason ?? 'user') },
    runTurn: () => (async function* () {
      await new Promise<void>(resolve => { releases.push(resolve) })
      yield { type: 'turn/start', turn: 1 }
      yield { type: 'turn/end', turn: 1, reason: { kind: 'completed' } }
    })(),
  }
  return { runtime, releases, cancelled }
}

const message = (text: string) => ({ content: [{ type: 'text', text }] })

test('an idle followup starts its turn at once and counts nothing', async () => {
  const { runtime, releases } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  assert.equal(agent.pendingTurns(), 0, 'the first turn is running, not queued')
  assert.equal(agent.status, 'running')
  await settle(() => releases.length === 1, 'the first turn to block')
  assert.equal(agent.pendingTurns(), 0)
  releases[0]?.()
  await settle(() => agent.status === 'idle', 'the turn to finish')
})

test('followups behind a running turn are counted until each one begins', async () => {
  const { runtime, releases } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  agent.followup(message('two'))
  agent.followup(message('three'))
  assert.equal(agent.pendingTurns(), 2, 'two followups wait behind the running turn')
  await settle(() => releases.length === 1, 'the first turn to block')
  // Let the first turn finish: the next queued followup begins its own turn.
  releases[0]?.()
  await settle(() => agent.pendingTurns() === 1, 'the second turn to begin')
  await settle(() => releases.length === 2, 'the second turn to block')
  releases[1]?.()
  await settle(() => agent.pendingTurns() === 0, 'the third turn to begin')
  await settle(() => releases.length === 3, 'the third turn to block')
  releases[2]?.()
  await settle(() => agent.status === 'idle', 'every turn to finish')
  assert.deepEqual(agent.calls.map(call => (call.content[0] as { readonly text?: string }).text), ['one', 'two', 'three'])
})

test('a cancel drops the messages waiting behind the turn', async () => {
  const { runtime, releases, cancelled } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  agent.followup(message('two'))
  assert.equal(agent.pendingTurns(), 1)
  await settle(() => releases.length === 1, 'the turn to block')
  agent.cancel()
  assert.equal(agent.pendingTurns(), 0, 'the queue goes with the turn')
  assert.deepEqual(cancelled, ['user'], 'the running turn is cancelled as the user\'s stop')
  // The aborted turn ends: the dropped followup must not start a turn after it.
  releases[0]?.()
  await settle(() => agent.status === 'idle', 'the aborted turn to end')
  assert.equal(releases.length, 1, 'the dropped followup never began a turn')
})

test('a steer that finds no turn waits behind the queued followups instead of jumping', async () => {
  const { runtime, releases } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  agent.followup(message('two'))
  await settle(() => releases.length === 1, 'the turn to block')
  await settle(() => agent.pendingTurns() === 1, 'the queue to fill')
  agent.steer(message('now'))
  // The runtime answers `false` (no running turn to cut into), so it queues like a followup.
  await settle(() => agent.pendingTurns() === 2, 'the steer to join the queue')
  releases[0]?.()
  await settle(() => releases.length === 2, 'the queued followup to begin')
  releases[1]?.()
  await settle(() => releases.length === 3, 'the steered message to begin')
  releases[2]?.()
  await settle(() => agent.status === 'idle', 'every turn to finish')
})

test('a Main Bot\'s stop is recorded as a hook, not as the user', async () => {
  const { runtime, releases, cancelled } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  await settle(() => releases.length === 1, 'the turn to block')
  agent.cancel({ kind: 'hook' })
  assert.deepEqual(cancelled, ['hook'])
})

test('the inbox is the waiting list, and removing one leaves the running turn', async () => {
  const { runtime, releases, cancelled } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  agent.followup(message('two'))
  agent.followup(message('three'))
  await settle(() => agent.inbox.nextTurn.length === 2, 'two messages to wait')
  assert.equal(agent.inbox.nextStep.length, 0, 'this engine has no step queue')
  assert.equal(agent.pendingTurns(), agent.inbox.nextTurn.length)
  const first = agent.inbox.nextTurn[0]
  const second = agent.inbox.nextTurn[1]
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.id !== second.id, true)
  assert.equal((first.content[0] as { readonly text?: string }).text, 'two')
  assert.equal(agent.inbox.remove(first.id), true)
  assert.equal(agent.pendingTurns(), 1)
  assert.equal(agent.inbox.nextTurn[0]?.id, second?.id)
  assert.equal(agent.inbox.remove('already-started'), false)
  assert.deepEqual(cancelled, [], 'removing a queued message does not cancel the turn')
  releases[0]?.()
  await settle(() => releases.length === 2, 'the remaining queued message to begin')
  assert.equal((agent.calls[1]?.content[0] as { readonly text?: string } | undefined)?.text, 'three')
  releases[1]?.()
  await settle(() => agent.status === 'idle', 'the remaining turn to finish')
})

test('prepend inserts at the front and skips a request already queued', async () => {
  const { runtime, releases } = heldRuntime()
  const agent = engineAgentOf('s1', { runtime, emitEvent: () => undefined })
  agent.followup(message('one'))
  await settle(() => releases.length === 1, 'the turn to block')
  agent.inbox.prepend('next-step', { id: 'keep', content: [{ type: 'text', text: 'kept' }], source: { exchangeId: 'ex-1' } })
  agent.inbox.prepend('next-turn', { id: 'dup', content: [{ type: 'text', text: 'again' }], source: { exchangeId: 'ex-1' } })
  assert.equal(agent.pendingTurns(), 1)
  assert.equal(agent.inbox.nextTurn[0]?.id, 'keep')
  assert.equal(agent.inbox.nextStep.length, 0)
  releases[0]?.()
  await settle(() => releases.length === 2, 'the prepended message to begin')
  assert.equal((agent.calls[1]?.content[0] as { readonly text?: string } | undefined)?.text, 'kept')
  releases[1]?.()
  await settle(() => agent.status === 'idle', 'the prepended turn to finish')
})

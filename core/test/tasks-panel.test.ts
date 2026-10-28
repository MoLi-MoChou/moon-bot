// The task panel's host data (2026-10-28 tasks-panel): the running rows read the live
// turns, the queue figure reads each Session's own durable inbox, and the stop is the
// cancel a Main Bot's stop_bot uses. These drive `install` with a fake runtime, so the
// queue arithmetic is checked without a service or a model.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/tasks-panel.ts'

interface AgentStub {
  readonly inbox?: { readonly nextTurn: readonly unknown[] } | undefined
  readonly status?: string
  pendingTurns?(): number
  cancel?(cause: { readonly kind: string }): void
}

interface Row {
  readonly sessionId: string
  readonly botName: string
  readonly queued?: number
  readonly hold?: string
}

interface View {
  readonly running: readonly Row[]
  readonly completed: readonly { readonly sessionId: string; readonly reason: string }[]
  readonly waiting: readonly { readonly botId: string }[]
}

interface Panel {
  tasksView(): Promise<View>
  noteTurn(sessionId: string, event: { readonly type?: string; readonly turn?: unknown; readonly reason?: unknown }): void
  stopTask(sessionId: string): Promise<boolean>
}

interface Options {
  /** The live records the turn modules keep: a running turn, or a send not started yet. */
  readonly live?: Record<string, { readonly turn?: number; readonly sentAt?: number }>
  readonly work?: Record<string, { readonly since?: number; readonly tool?: string; readonly roomId?: string }>
  readonly agent?: (sessionId: string) => AgentStub | undefined
  readonly approvals?: readonly { readonly sessionId: string }[]
  readonly waiting?: Record<string, { readonly bots: readonly string[]; readonly rooms: readonly string[]; readonly for: readonly string[] }>
  readonly cancels?: { readonly kind: string }[]
}

function panel(options: Options = {}): Panel {
  const rt = {
    live: new Map(Object.entries(options.live ?? {})),
    groupOwners: new Map<string, { botId: string; roomId: string }>(),
    botOf: (id: string) => ({ id, name: `Bot ${id}` }),
    roomOf: () => undefined,
    chatOf: (botId: string) => `chat:${botId}`,
    selfOf: (sessionId: string) => sessionId.startsWith('chat:') ? sessionId.slice(5) : undefined,
    workView: () => options.work ?? {},
    workOf: () => undefined,
    workAsker: () => undefined,
    waitingView: () => options.waiting ?? {},
    approvalsView: () => options.approvals ?? [],
    resolveAgent: async (sessionId: string) => {
      const agent = options.agent?.(sessionId)
      if (agent === undefined || options.cancels === undefined) return agent
      return { inbox: agent.inbox, cancel: agent.cancel ?? ((cause: { readonly kind: string }) => { options.cancels?.push(cause) }) }
    },
  }
  install(rt as never)
  return rt as unknown as Panel
}

test('approval pending is the only approval hold fact', async () => {
  const view = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 4 } },
    approvals: [{ sessionId: 'chat:b1' }],
  }).tasksView()
  assert.equal(view.running[0]?.hold, 'approval')
})

test('a queued followup is reported as queued, but a send trigger is not', async () => {
  const view = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 4 } },
    agent: () => ({ pendingTurns: () => 1 }),
  }).tasksView()
  assert.equal(view.running[0]?.hold, 'queued')
  const sent = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { sentAt: 1_000 } },
    agent: () => ({ pendingTurns: () => 1 }),
  }).tasksView()
  assert.equal(sent.running[0]?.hold, undefined)
})

test('handoff waiting is explicit and idle rows have no guessed hold', async () => {
  const waiting = await panel({
    waiting: { b1: { bots: ['b2'], rooms: [], for: [] } },
  }).tasksView()
  assert.equal(waiting.waiting[0]?.hold, 'handoff')
  const idle = await panel({ work: { b1: { since: 1_000 } }, live: { 'chat:b1': { turn: 4 } } }).tasksView()
  assert.equal(idle.running[0]?.hold, undefined)
})

test('an explicit running engine without a started turn reports engine-busy', async () => {
  const view = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { sentAt: 1_000 } },
    agent: () => ({ status: 'running' }),
  }).tasksView()
  assert.equal(view.running[0]?.hold, 'engine-busy')
})

test('a running turn counts the followups waiting behind it', async () => {
  const view = await panel({
    work: { b1: { since: 1_000, tool: 'read_file' } },
    live: { 'chat:b1': { turn: 4 } },
    agent: () => ({ pendingTurns: () => 2, inbox: { nextTurn: [] } }),
  }).tasksView()
  assert.equal(view.running.length, 1)
  assert.equal(view.running[0]?.sessionId, 'chat:b1')
  assert.equal(view.running[0]?.botName, 'Bot b1')
  assert.equal(view.running[0]?.queued, 2)
})

test('an agent without a counter falls back to its durable inbox', async () => {
  const view = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 4 } },
    agent: () => ({ inbox: { nextTurn: [{}, {}, {}] } }),
  }).tasksView()
  assert.equal(view.running[0]?.queued, 3)
})

test('a send whose turn has not started is working, not queued behind itself', async () => {
  const view = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { sentAt: 1_000 } },
    agent: () => ({ inbox: { nextTurn: [{}] } }),
  }).tasksView()
  assert.equal(view.running[0]?.queued, undefined)
})

test('no agent, no inbox, or a failed resolve leaves the row and drops the queue figure', async () => {
  const missing = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 1 } },
  }).tasksView()
  assert.equal(missing.running[0]?.queued, undefined)
  assert.equal(missing.running[0]?.botName, 'Bot b1')

  const broken = await panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 1 } },
    agent: () => ({ inbox: undefined }),
  }).tasksView()
  assert.equal(broken.running[0]?.queued, undefined)

  const rt = panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 1 } },
  })
  ;(rt as unknown as { resolveAgent(): Promise<never> }).resolveAgent = async () => { throw new Error('gone') }
  const failed = await rt.tasksView()
  assert.equal(failed.running[0]?.queued, undefined)
})

test('the stop cancels with the user cause and reports a running turn found', async () => {
  const cancels: { readonly kind: string }[] = []
  const rt = panel({
    work: { b1: { since: 1_000 } },
    live: { 'chat:b1': { turn: 1 } },
    agent: () => ({ inbox: { nextTurn: [] }, cancel: cause => cancels.push(cause) }),
    cancels,
  })
  assert.equal(await rt.stopTask('chat:b1'), true)
  assert.deepEqual(cancels, [{ kind: 'user' }])
})

test('a turn that already ended is reported as nothing to stop', async () => {
  const cancelled: { readonly kind: string }[] = []
  const rt = panel({
    live: { 'chat:b1': {} },
    agent: () => ({ cancel: cause => cancelled.push(cause) }),
    cancels: cancelled,
  })
  assert.equal(await rt.stopTask('chat:b1'), false)
  assert.equal(await rt.stopTask('chat:gone'), false)
  assert.deepEqual(cancelled, [])
})

test('an agent that cannot be resolved is nothing to stop, not a failed request', async () => {
  const rt = panel({
    live: { 'chat:b1': { turn: 1 } },
    agent: () => undefined,
  })
  assert.equal(await rt.stopTask('chat:b1'), false)
})

test('a finished turn keeps why it ended, so the panel can say who stopped it', async () => {
  const rt = panel()
  rt.noteTurn('chat:b1', { type: 'turn/start' })
  rt.noteTurn('chat:b1', { type: 'turn/end', reason: { kind: 'user' } })
  const view = await rt.tasksView()
  assert.equal(view.completed[0]?.reason, 'user')
})

test('a finished row keeps who stopped it: the user or a Main Bot', async () => {
  const rt = panel()
  rt.noteTurn('chat:b1', { type: 'turn/start' })
  rt.noteTurn('chat:b1', { type: 'turn/end', reason: { kind: 'aborted', reason: 'user' } })
  rt.noteTurn('chat:b2', { type: 'turn/start' })
  rt.noteTurn('chat:b2', { type: 'turn/end', reason: { kind: 'aborted', reason: 'hook' } })
  const view = await rt.tasksView()
  assert.equal(view.completed[0]?.reason, 'hook')
  assert.equal(view.completed[1]?.reason, 'user')
})

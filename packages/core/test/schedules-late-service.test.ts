// The schedule tools when the scheduler is provided after the module installs.
//
// The wiring creates the runtime (which installs this module) and only then provides the
// scheduler, and `ctx.inject` never delivers a name that arrives later. A value captured at
// install time was therefore null for the life of the process: every reminder was refused
// with "turned off in this build" while the settings page could create the same task fine.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/schedules.ts'
import { fakeContext } from './fake-ctx.ts'

/** A scheduler good enough to see whether the tools found it. */
function fakeScheduler() {
  const created = []
  return {
    created,
    async create(sessionId, input) {
      created.push({ sessionId, ...input })
    },
    async list() {
      return []
    },
    async catalog() {
      return []
    },
    async delete() {
      return true
    },
  }
}

function start({ withServiceAtInstall = false } = {}) {
  const services = {}
  const scheduler = fakeScheduler()
  if (withServiceAtInstall) services.schedule = scheduler
  const ctx = fakeContext({ services })
  const tools = new Map()
  ctx.registerTool = tool => {
    tools.set(tool.name, tool)
  }
  const bot = { id: 'b1', name: 'Writer', sessionId: 'b1' }
  const rt = {
    ctx,
    config: {},
    home: '/tmp/nonexistent-moon-bot-test',
    state: { bots: { b1: bot }, rooms: {}, mainBotIds: [] },
    botOf: id => (id === 'b1' ? bot : undefined),
    chatOf: id => (id === 'b1' ? 'b1' : undefined),
    roomOf: () => undefined,
    chatOwners: new Map([['b1', 'b1']]),
    groupOwners: new Map(),
    pastOwners: new Map(),
    isBotSession: id => id === 'b1',
    readOnly: () => undefined,
    warn: () => undefined,
    on: () => undefined,
    registerTool: tool => {
      tools.set(tool.name, tool)
    },
  }
  install(rt as never)
  return { ctx, rt, scheduler, tools, services }
}

test('a scheduler provided after install is still found by the tools', async () => {
  // This is the regression: the settings page created tasks while the Bot tools refused.
  const { rt, scheduler, services } = start()
  assert.equal(rt.scheduleFor(), null, 'nothing is provided yet')
  services.schedule = scheduler
  assert.notEqual(rt.scheduleFor(), null, 'the late service is seen')
  await rt.createScheduleFrom('b1', 'Check the build', 'remind the user', { kind: 'every', minutes: 5 })
  assert.equal(scheduler.created.length, 1)
  assert.equal(scheduler.created[0]?.sessionId, 'b1')
  assert.equal(scheduler.created[0]?.title, 'Check the build')
})

test('a scheduler present at install time works the same way', async () => {
  const { rt, scheduler } = start({ withServiceAtInstall: true })
  assert.notEqual(rt.scheduleFor(), null)
  await rt.createScheduleFrom('b1', 'x', 'y', { kind: 'every', minutes: 5 })
  assert.equal(scheduler.created.length, 1)
})

test('with no scheduler at all the tool refuses, and says so plainly', async () => {
  const { rt } = start()
  assert.equal(rt.scheduleFor(), null)
  await assert.rejects(
    async () => await rt.createScheduleFrom('b1', 'x', 'y', { kind: 'every', minutes: 5 }),
    /turned off/,
  )
})

test('listing with no scheduler is empty rather than an error', async () => {
  const { rt } = start()
  assert.deepEqual(await rt.listSchedulesOf('b1'), [])
})

test('the listener that clears the service does not clear a late one', async () => {
  // The disposer compares before clearing, so a service swapped in later survives an
  // earlier module's teardown.
  const { rt, scheduler, services } = start()
  services.schedule = scheduler
  assert.notEqual(rt.scheduleFor(), null)
})

test('the schedules view reports available once the late service arrives', async () => {
  // `available: false` is what the Settings page and the Bot tools both key off, so the
  // view has to resolve the service the same lazy way the tools do — this is the check
  // that failed against a real container after the first fix.
  const { rt, scheduler, services } = start()
  assert.deepEqual(await rt.scheduleEndpoint('schedules', {}), { available: false, tasks: [] })
  services.schedule = scheduler
  const after = (await rt.scheduleEndpoint('schedules', {})) as { readonly available: boolean }
  assert.equal(after.available, true, 'a scheduler provided after install must be seen')
})

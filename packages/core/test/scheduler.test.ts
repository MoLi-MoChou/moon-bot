// The standalone scheduler (plan §阶段 4): the five trigger kinds over the tasks
// table, fired by a poll, recovered from a restart. Times are controlled through the
// spec arithmetic and the store's due window, not by waiting.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TaskScheduler, nextRunOf } from '../src/service/scheduler.ts'
import { openStore } from '../src/store/db.ts'

const fresh = (t: { after: (run: () => void) => void }) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-sched-'))
  const store = openStore(home)
  t.after(() => store.close())
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  return { store, home }
}

test('next-run arithmetic covers the five kinds', () => {
  const from = Date.parse('2026-10-26T08:00:00.000Z')
  assert.equal(nextRunOf({ at: '2026-10-27T09:00:00.000Z' }, from), Date.parse('2026-10-27T09:00:00.000Z'))
  assert.equal(nextRunOf({ every_seconds: 300 }, from), from + 300_000)
  assert.equal(nextRunOf({ daily: { time: '09:30:00', time_zone: 'UTC' } }, from), Date.parse('2026-10-26T09:30:00.000Z'))
  // A time already past today fires tomorrow.
  assert.equal(nextRunOf({ daily: { time: '07:00:00', time_zone: 'UTC' } }, from), Date.parse('2026-10-27T07:00:00.000Z'))
  // Asked on Sunday 2026-10-25: the next Monday is the 26th.
  assert.equal(nextRunOf({ weekly: { time: '09:00:00', time_zone: 'UTC', weekdays: [1] } }, Date.parse('2026-10-25T10:00:00.000Z')), Date.parse('2026-10-26T09:00:00.000Z'))
    // 09:00 Shanghai on the 26th already passed at 16:00 Shanghai: the next is the 27th.
  assert.equal(nextRunOf({ cron: { expression: '0 9 * * *', time_zone: 'Asia/Shanghai' } }, from), Date.parse('2026-10-27T01:00:00.000Z'))
  // Nothing fires without a timing, or from a broken one.
  assert.equal(nextRunOf({}, from), undefined)
  assert.equal(nextRunOf({ cron: { expression: 'not a cron', time_zone: undefined } }, from), undefined)
})

test('a due task fires once, delivers its prompt, and reschedules itself', async (t) => {
  const { store } = fresh(t)
  const fired: { sessionId: string, text: string }[] = []
  const scheduler = new TaskScheduler(store, (sessionId, task) => { fired.push({ sessionId, text: `${task.title}: ${task.prompt}` }) })
  await scheduler.create('b1', { title: 'Standup', prompt: 'Write the standup note', every_seconds: 60 * 60 })
  // Nothing is due yet.
  await scheduler.tick()
  assert.deepEqual(fired, [])
  // Make it due, then fire.
  store.tasks.finish((await scheduler.catalog())[0]?.id as string, { state: 'pending', nextRunAt: Date.now() - 1 })
  await scheduler.tick()
  assert.deepEqual(fired.map(entry => entry.sessionId), ['b1'])
  assert.deepEqual(fired[0]?.text, 'Standup: Write the standup note')
  // An 'every' task reschedules; a second immediate tick fires nothing.
  await scheduler.tick()
  assert.equal(fired.length, 1)
  const entry = (await scheduler.catalog())[0] as { every_seconds?: number }
  assert.equal(entry.every_seconds, 3600)
})

test('a one-shot task is done after it fires, and survives a restart by its next run', async (t) => {
  const { store } = fresh(t)
  const fired: string[] = []
  const scheduler = new TaskScheduler(store, sessionId => { fired.push(sessionId) })
  await scheduler.create('b1', { title: 'Once', prompt: 'Do the thing', at: new Date(Date.now() - 1).toISOString() })
  await scheduler.tick()
  assert.deepEqual(fired, ['b1'])
  assert.equal((await scheduler.catalog()).length, 1, 'the record stays for the view')
  // Restart: a new scheduler over the same store sees nothing pending and due — a
  // second fire of the one-shot would double the work.
  let refired = 0
  const second = new TaskScheduler(store, () => { refired += 1 })
  await second.tick()
  assert.equal(refired, 0, 'the finished one-shot does not fire again')
  // A task still pending from before the restart fires with the new scheduler.
  await second.create('b2', { title: 'Later', prompt: 'Then', at: new Date(Date.now() - 1).toISOString() })
  store.tasks.finish(((await second.catalog()).find(entry => entry.sessionId === 'b2') as { id: string }).id, { state: 'pending', nextRunAt: Date.now() - 1 })
  await second.tick()
  assert.equal(refired, 1)
})

test('pause holds a task; delete removes it; the catalog carries the timing', async (t) => {
  const { store } = fresh(t)
  const scheduler = new TaskScheduler(store, () => {})
  await scheduler.create('b1', { title: 'Daily', prompt: 'Report', daily: { time: '08:00:00', time_zone: 'UTC' } })
  const entry = (await scheduler.catalog())[0] as { id: string, sessionId: string, daily?: { time?: string } }
  assert.deepEqual([entry.sessionId, entry.daily?.time], ['b1', '08:00:00'])
  scheduler.pause(entry.id, true)
  assert.deepEqual(store.tasks.due(Date.now() + 365 * 24 * 3600 * 1000).map(task => task.id), [], 'a paused task never comes due')
  scheduler.pause(entry.id, false)
  await scheduler.delete({ sessionId: 'b1', id: entry.id })
  assert.deepEqual(await scheduler.catalog(), [])
})

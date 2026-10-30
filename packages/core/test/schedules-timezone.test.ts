// Time zones: what "every day at 08:00" means, and what "in 5 minutes" means.
//
// The host runs in one zone (the container sets TZ), the user reads the clock in that zone,
// and a reminder has to fire when the user thinks it will. These tests pin the three cases
// that decide it: a named zone, no zone at all, and a relative time.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextRunOf } from '../src/service/scheduler.ts'

// A minute before 08:00 in Shanghai: late enough that "8am today" is still ahead in
// every zone these tests use, so the expected instant is the same day's.
const FROM = Date.parse('2026-10-29T23:00:00Z')

test('a named zone is honoured exactly', () => {
  // 08:00 in Shanghai on the 30th is 00:00 UTC that day.
  assert.equal(nextRunOf({ daily: { time: '08:00', time_zone: 'Asia/Shanghai' } }, FROM), Date.parse('2026-10-30T00:00:00Z'))
  // 08:00 in UTC is 08:00 UTC.
  assert.equal(nextRunOf({ daily: { time: '08:00', time_zone: 'UTC' } }, FROM), Date.parse('2026-10-30T08:00:00Z'))
  // 08:00 in New York, still on daylight time on this date, is 12:00 UTC.
  assert.equal(nextRunOf({ daily: { time: '08:00', time_zone: 'America/New_York' } }, FROM), Date.parse('2026-10-30T12:00:00Z'))
})

test('with no zone the host\'s own zone decides, which is what the user reads', () => {
  // The container runs with TZ set; a reminder set for "8am" must mean 8am there, not UTC.
  // This is the same answer a named zone gives, so the two agree for the host's own zone.
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const none = nextRunOf({ daily: { time: '08:00', time_zone: undefined } }, FROM)
  const named = nextRunOf({ daily: { time: '08:00', time_zone: hostZone } }, FROM)
  assert.equal(none, named, `no zone must mean ${hostZone}`)
  // And it is only the same as UTC when the host happens to run in UTC.
  const utc = nextRunOf({ daily: { time: '08:00', time_zone: 'UTC' } }, FROM)
  if (hostZone !== 'UTC') assert.notEqual(none, utc, 'a non-UTC host must not silently behave as UTC')
})

test('an empty string is treated as no zone, not as a broken one', () => {
  // The tool passes whatever the model sent; an empty field is the common case.
  assert.equal(
    nextRunOf({ daily: { time: '08:00', time_zone: '' } }, FROM),
    nextRunOf({ daily: { time: '08:00', time_zone: undefined } }, FROM),
  )
})

test('a weekly reminder uses the zone for the day boundary too', () => {
  // Monday 08:00 Shanghai is Sunday 00:00 UTC, so a naive UTC reading would pick the wrong
  // day. The named zone must move both the hour and the weekday.
  const monday = nextRunOf({ weekly: { time: '08:00', time_zone: 'Asia/Shanghai', weekdays: [1] } }, FROM)
  assert.equal(new Date(monday).toISOString(), '2026-11-02T00:00:00.000Z')
})

test('a cron expression takes the zone as well', () => {
  const next = nextRunOf({ cron: { expression: '0 8 * * *', time_zone: 'Asia/Shanghai' } }, FROM)
  assert.equal(new Date(next).toISOString(), '2026-10-30T00:00:00.000Z')
})

test('a relative interval is relative to now, and the zone cannot move it', () => {
  // "in five minutes" is a duration: no zone applies, and adding one must change nothing.
  const plain = nextRunOf({ every_seconds: 300 }, FROM)
  assert.equal(plain, FROM + 300_000)
})

test('an "at" instant is absolute, so no zone is consulted', () => {
  // The tool writes a full ISO string with an offset; it is already unambiguous.
  const at = '2026-10-30T10:35:11+08:00'
  assert.equal(nextRunOf({ at }, FROM), Date.parse(at))
})

test('an unusable zone yields no next run rather than throwing', () => {
  // A model can send a zone that does not exist. The scheduler answers "never" instead of
  // crashing the poll; the caller treats that as a reminder that cannot be set.
  assert.equal(nextRunOf({ daily: { time: '08:00', time_zone: 'Mars/Olympus' } }, FROM), undefined)
})

test('a reminder created without a zone keeps the host zone, not UTC', async () => {
  // The regression this file exists for: selectorOf() used to write 'UTC' whenever the
  // caller omitted a zone, so "every day at 08:00" on a Shanghai host fired at 16:00 local.
  // The endpoint is the path a Bot tool and the settings form both take.
  const { install } = await import('../src/host/schedules.ts')
  const { fakeContext } = await import('./fake-ctx.ts')
  const created = []
  const scheduler = {
    async create(_sessionId, input) { created.push(input) },
    async list() { return [] },
    async delete() { return true },
    async catalog() { return [] },
  }
  const ctx = fakeContext({ services: { schedule: scheduler } })
  const bot = { id: 'b1', name: 'Writer', sessionId: 'b1' }
  const rt = {
    ctx, config: {}, home: '/tmp/nonexistent-moon-bot-test',
    state: { bots: { b1: bot }, rooms: {}, mainBotIds: [] },
    botOf: id => (id === 'b1' ? bot : undefined), chatOf: () => 'b1', roomOf: () => undefined,
    chatOwners: new Map([['b1', 'b1']]), groupOwners: new Map(), pastOwners: new Map(),
    isBotSession: () => true, readOnly: () => undefined, warn: () => undefined,
    on: () => undefined, registerTool: () => undefined,
  }
  install(rt as never)
  await rt.scheduleEndpoint('schedule-create', {
    target: 'b1', title: 'Morning', prompt: 'go', when: { kind: 'daily', time: '08:00' },
  })
  assert.equal(created.length, 1)
  assert.equal(created[0].daily.time_zone, undefined, 'no zone means the host zone, not UTC')
})

test('an explicit zone survives the selector', async () => {
  const { install } = await import('../src/host/schedules.ts')
  const { fakeContext } = await import('./fake-ctx.ts')
  const created = []
  const scheduler = {
    async create(_sessionId, input) { created.push(input) },
    async list() { return [] }, async delete() { return true }, async catalog() { return [] },
  }
  const ctx = fakeContext({ services: { schedule: scheduler } })
  const bot = { id: 'b1', name: 'Writer', sessionId: 'b1' }
  const rt = {
    ctx, config: {}, home: '/tmp/nonexistent-moon-bot-test',
    state: { bots: { b1: bot }, rooms: {}, mainBotIds: [] },
    botOf: id => (id === 'b1' ? bot : undefined), chatOf: () => 'b1', roomOf: () => undefined,
    chatOwners: new Map([['b1', 'b1']]), groupOwners: new Map(), pastOwners: new Map(),
    isBotSession: () => true, readOnly: () => undefined, warn: () => undefined,
    on: () => undefined, registerTool: () => undefined,
  }
  install(rt as never)
  await rt.scheduleEndpoint('schedule-create', {
    target: 'b1', title: 'Morning', prompt: 'go', when: { kind: 'daily', time: '08:00', timeZone: 'America/New_York' },
  })
  assert.equal(created[0].daily.time_zone, 'America/New_York')
})

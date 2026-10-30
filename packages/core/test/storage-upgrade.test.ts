// The upgrade a real browser goes through: an install from before the rename has its
// values under `ds-bot:` (and older still `dsh-bot:`), and the first load after the
// update has to keep them. The other storage tests use a Map standing in for the
// browser; this one runs jsdom's own localStorage, so the API the client really calls
// is what moves the values.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STORAGE, migrateStorage } from '../src/client/storage.ts'

const { JSDOM } = await import('jsdom')

const browserStorage = () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:8290/' })
  return window.localStorage as Storage
}

test('an install from before the rename keeps its marks, prefs and tabs', () => {
  const storage = browserStorage()
  // What the build before the rename wrote.
  storage.setItem('ds-bot:unread', '{"room-1":true}')
  storage.setItem('ds-bot:reactions', '{"m1":"👍"}')
  storage.setItem('ds-bot:seen', '{"room-1":42}')
  storage.setItem('ds-bot:prefs', '{"theme":"claude","accent":"#123456","motion":"quiet"}')
  storage.setItem('ds-bot:surface', 'agent')
  storage.setItem('ds-bot:agent-sessions', '["s1"]')
  storage.setItem('ds-bot:browser-width', '600')
  storage.setItem('ds-bot:sidebar-order', '["room-1"]')
  storage.setItem(
    'ds-bot.browser.v2',
    '{"bot": {"tabs": [{"id":"t","url":"https://example.com/","title":"Example"}], "active":"t"}}',
  )

  migrateStorage(storage)

  assert.equal(storage.getItem(STORAGE.unread), '{"room-1":true}')
  assert.equal(storage.getItem(STORAGE.reactions), '{"m1":"👍"}')
  assert.equal(storage.getItem(STORAGE.seen), '{"room-1":42}')
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.prefs) ?? 'null'), {
    theme: 'claude',
    accent: '#123456',
    motion: 'quiet',
  })
  assert.equal(storage.getItem(STORAGE.surface), 'agent')
  assert.equal(storage.getItem(STORAGE.agentSessions), '["s1"]')
  assert.equal(storage.getItem(STORAGE.browserWidth), '600')
  assert.equal(storage.getItem(STORAGE.sidebarOrder), '["room-1"]')
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.browsers) ?? 'null'), {
    bot: { tabs: [{ id: 't', url: 'https://example.com/', title: 'Example' }], active: 't' },
  })
  // The old names are gone, so a later read never sees a stale copy.
  for (const key of [
    'ds-bot:unread',
    'ds-bot:reactions',
    'ds-bot:seen',
    'ds-bot:prefs',
    'ds-bot:surface',
    'ds-bot:agent-sessions',
    'ds-bot:browser-width',
    'ds-bot:sidebar-order',
  ]) {
    assert.equal(storage.getItem(key), null, `${key} is cleared`)
  }
  // A second load changes nothing: migration is one way and idempotent.
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.unread), '{"room-1":true}')
})

test('an install two renames back moves too, and the newest name wins', () => {
  const storage = browserStorage()
  storage.setItem('dsh-bot:seen', '{"oldest":1}')
  storage.setItem('dsh-bot-team:unread', '{"oldest":true}')
  storage.setItem('ds-bot:seen', '{"newer":2}')
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.seen), '{"newer":2}')
  assert.equal(storage.getItem(STORAGE.unread), '{"oldest":true}')
  assert.equal(storage.getItem('dsh-bot:seen'), null)
  assert.equal(storage.getItem('dsh-bot-team:unread'), null)
})

test('a value the current build already wrote is never overwritten by an old one', () => {
  const storage = browserStorage()
  storage.setItem(STORAGE.prefs, '{"theme":"grok"}')
  storage.setItem('ds-bot:prefs', '{"theme":"claude"}')
  migrateStorage(storage)
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.prefs) ?? 'null'), { theme: 'grok' })
  assert.equal(storage.getItem('ds-bot:prefs'), null)
})

test('the one-page-per-Bot browser store becomes tabs, and its old name goes', () => {
  const storage = browserStorage()
  storage.setItem('dsh-bot.browser.v1', '{"a":{"url":"https://example.com/","title":"Example"}}')
  migrateStorage(storage)
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.browsers) ?? 'null'), {
    a: { tabs: [{ id: 'v1-a', url: 'https://example.com/', title: 'Example' }], active: 'v1-a' },
  })
  assert.equal(storage.getItem('dsh-bot.browser.v1'), null)
})

test('values under a name this build never used are left alone', () => {
  const storage = browserStorage()
  storage.setItem('unrelated:prefs', 'keep')
  storage.setItem('ds-bot:unknown', 'keep')
  migrateStorage(storage)
  assert.equal(storage.getItem('unrelated:prefs'), 'keep')
  assert.equal(storage.getItem('ds-bot:unknown'), 'keep')
})

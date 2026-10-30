import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STORAGE, legacyKeys, migrateStorage } from '../src/client/storage.ts'

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: key => {
      map.delete(key)
    },
  } as Storage & { map: Map<string, string> }
}

test('values saved under the dsh-bot keys move to the moon-bot keys', () => {
  const storage = memoryStorage({
    'dsh-bot:unread': '{"a":true}',
    'dsh-bot:reactions': '{"t1":"👍"}',
    'dsh-bot:seen': '{"a":1}',
    'dsh-bot:prefs': '{"theme":"claude"}',
    'dsh-bot:browser-width': '600',
    'dsh-bot.browser.v1': '{"a":{"url":"https://example.com/"}}',
    'other:key': 'kept',
  })
  migrateStorage(storage)
  assert.deepEqual(Object.fromEntries(storage.map), {
    'moon-bot:unread': '{"a":true}',
    'moon-bot:reactions': '{"t1":"👍"}',
    'moon-bot:seen': '{"a":1}',
    'moon-bot:prefs': '{"theme":"claude"}',
    'moon-bot:browser-width': '600',
    'moon-bot.browser.v2': '{"a":{"tabs":[{"id":"v1-a","url":"https://example.com/","title":""}],"active":"v1-a"}}',
    'other:key': 'kept',
  })
})

test('the dsh-bot-team keys move too, and the newer name wins', () => {
  const storage = memoryStorage({
    'dsh-bot-team:unread': 'oldest',
    'dsh-bot-team:prefs': 'team',
    'dsh-bot:prefs': 'newer',
  })
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.unread), 'oldest')
  assert.equal(storage.getItem(STORAGE.prefs), 'newer')
  assert.equal(storage.getItem('dsh-bot-team:prefs'), null)
})

test('a value already under the current key is never overwritten', () => {
  const storage = memoryStorage({ 'moon-bot:seen': 'current', 'ds-bot:seen': 'older', 'dsh-bot:seen': 'oldest' })
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.seen), 'current')
  assert.equal(storage.getItem('ds-bot:seen'), null)
  assert.equal(storage.getItem('dsh-bot:seen'), null)
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.seen), 'current')
})

test('the newest legacy name wins when the current key is empty', () => {
  const storage = memoryStorage({
    'dsh-bot-team:unread': 'oldest',
    'dsh-bot:unread': 'older',
    'ds-bot:unread': 'newest',
  })
  migrateStorage(storage)
  assert.equal(storage.getItem(STORAGE.unread), 'newest')
})

test('every current key has its legacy keys, and unusable storage is no error', () => {
  for (const key of Object.values(STORAGE)) assert.ok(legacyKeys(key).length > 0, key)
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem() {},
    removeItem() {},
  } as unknown as Storage
  assert.doesNotThrow(() => migrateStorage(broken))
})

test('a saved legacy mono theme becomes the grok theme', () => {
  const storage = memoryStorage({ 'dsh-bot:prefs': '{"theme":"mono","accent":"#123456"}' })
  migrateStorage(storage)
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.prefs)), { theme: 'grok', accent: '#123456' })
  migrateStorage(memoryStorage({ 'ds-bot:prefs': 'not json' }))
})

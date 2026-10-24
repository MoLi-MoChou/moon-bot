// The SQLite store layer (plan §阶段 1): schema migration, session transcripts, durable
// tasks, and the memory index with trigram FTS — all against a temp file, so the test
// proves the real SQL, not an in-memory stub.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openStore } from '../src/store/db.ts'

const freshStore = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-store-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const store = openStore(home)
  t.after(() => store.close())
  return store
}

test('the schema opens with user_version at the migration count, and reopens harmlessly', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-store-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const first = openStore(home)
  assert.equal(first.raw.pragma('user_version', { simple: true }), 2)
  first.close()
  const second = openStore(home)
  assert.equal(second.raw.pragma('user_version', { simple: true }), 2)
  second.close()
})

test('a session transcript appends in order and pages back newest-first-then-reversed', (t) => {
  const { sessions } = freshStore(t)
  sessions.upsertSession({ id: 'b1', kind: 'bot', ownerId: 'bot-1', model: 'deepseek-chat' })
  sessions.appendMessage({ sessionId: 'b1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  sessions.appendMessage({ sessionId: 'b1', role: 'assistant', turn: 1, content: [{ type: 'text', text: 'hi' }], stopReason: { kind: 'completed' } })
  sessions.appendMessage({ sessionId: 'b1', role: 'assistant', turn: 2, content: [{ type: 'tool-call', id: 'k1', name: 'read', arguments: '{}' }], stopReason: { kind: 'completed' } })
  assert.equal(sessions.countMessages('b1'), 3)
  const page = sessions.page('b1', 2)
  assert.deepEqual(page.map(row => [row.seq, row.role]), [[1, 'assistant'], [2, 'assistant']])
  const first = sessions.page('b1', 3)[0]
  assert.deepEqual([first.seq, first.source, first.stopReason], [0, { kind: 'user' }, null])
  const stored = sessions.appendMessage({ sessionId: 'b1', role: 'user', content: [{ type: 'text', text: 'again' }] })
  assert.equal(stored.seq, 3)
})

test('a session row updates its model without losing its prompt, and deletes cleanly', (t) => {
  const { sessions } = freshStore(t)
  sessions.upsertSession({ id: 'g1', kind: 'group', ownerId: 'room-1', systemPrompt: 'You are in Ops.' })
  sessions.setModel('g1', 'other-model', 'high')
  const row = sessions.session('g1')
  assert.deepEqual([row.model, row.effort, row.systemPrompt], ['other-model', 'high', 'You are in Ops.'])
  sessions.deleteSession('g1')
  assert.equal(sessions.session('g1'), undefined)
})

test('tasks persist, come due in order, and a claim is exclusive', (t) => {
  const { tasks } = freshStore(t)
  tasks.create({ id: 'later', kind: 'schedule', payload: { cron: '0 9 * * *' }, nextRunAt: 2000 })
  tasks.create({ id: 'now', kind: 'schedule', payload: { cron: '* * * * *' }, nextRunAt: 1000 })
  const due = tasks.due(1500)
  assert.deepEqual(due.map(task => task.id), ['now'])
  const claimed = tasks.markRunning('now')
  assert.deepEqual([claimed.id, claimed.state, claimed.attempts], ['now', 'running', 1])
  assert.equal(tasks.markRunning('now'), undefined, 'a running task is not claimed twice')
  tasks.finish('now', { state: 'done', result: { said: 'good morning' } })
  assert.deepEqual(tasks.task('now').lastResult, { said: 'good morning' })
  tasks.setState('later', 'paused')
  assert.deepEqual(tasks.due(99999).map(task => task.id), [], 'a paused task is not due')
})

test('the memory index rebuilds a scope and finds Chinese text by trigram', (t) => {
  const { memory } = freshStore(t)
  memory.replaceAll('bot:chief', [
    { entryKey: 'likes', text: 'Chief likes tea, not coffee.', confidence: 0.9 },
    { entryKey: 'deploy', text: '部署走 moon 脚本，失败先看日志。', topic: 'ops', confidence: 0.7, source: { from: 'chat' } },
  ])
  assert.equal(memory.count('bot:chief'), 2)
  const hits = memory.search('bot:chief', '部署 失败')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].row.entryKey, 'deploy')
  const english = memory.search('bot:chief', 'coffee')
  assert.equal(english.length, 1)
  assert.equal(english[0].row.entryKey, 'likes')
  // A rebuild replaces, not appends.
  memory.replaceAll('bot:chief', [{ entryKey: 'likes', text: 'Chief likes tea, not coffee.', confidence: 0.9 }])
  assert.equal(memory.count('bot:chief'), 1)
  // Superseding marks the correction chain and drops the entry from search.
  memory.replaceAll('bot:chief', [
    { entryKey: 'likes', text: 'Chief likes tea, not coffee.', confidence: 0.9 },
    { entryKey: 'likes-2', text: 'Chief now prefers oat milk coffee.', confidence: 0.95 },
  ])
  memory.supersede('bot:chief', 'likes', 'likes-2')
  assert.equal(memory.count('bot:chief'), 1)
  const corrected = memory.search('bot:chief', 'tea')
  assert.deepEqual(corrected.map(hit => hit.row.entryKey), [])
})

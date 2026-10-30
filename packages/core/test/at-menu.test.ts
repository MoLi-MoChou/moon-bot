import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOTS_SOURCE, CHATS_SOURCE, atSources, chatRows, mentionRows, sessionMention } from '../src/client/at-menu.ts'
import { indexRoster } from '../src/client/sources.ts'

const roster = indexRoster({
  bots: [
    { id: 'chief', name: 'Chief', role: 'Lead', sessionId: 'chief-2', parts: ['chief'] },
    { id: 'king', name: 'King', sessionId: 'king' },
    { id: 'writer', name: 'Writer', sessionId: 'writer' },
  ],
  rooms: [{ id: 'room', name: 'Launch', members: ['chief', 'king'], parts: ['king-in-room'] }],
}) as unknown as Parameters<typeof mentionRows>[0]
const names = rows => rows.map(row => row.bot?.name ?? 'everyone')

// The mention format is a contract with what the client already stored: the session id
// as base64url JSON inside `dsh-session:`, the label escaped for a markdown link text.
const mentionOf = (id, label) =>
  `@[${label.replace(/[\\\]]/g, mark => `\\${mark}`)}](moon-bot-session:${Buffer.from(JSON.stringify(id), 'utf8').toString('base64url')})`
const readMention = text => {
  const found = /@\[(.*?)\]\((?:moon-bot-session|dsh-session):([A-Za-z0-9_-]+)\)/.exec(text)
  if (found === null) return { text, references: [] }
  const label = (found[1] ?? '').replace(/\\(.)/g, '$1')
  const sessionId = JSON.parse(Buffer.from(found[2] ?? '', 'base64url').toString('utf8'))
  return { text: text.replace(found[0], `@${label}`), references: [{ sessionId, label }] }
}

test('a session mention is the format this client writes and a reader gets back', () => {
  for (const [id, label] of [
    ['s-1', 'Chat with King'],
    ['会话/ä"x', 'a ] b \\ c'],
    ['', ''],
  ]) {
    const mention = sessionMention(id, label)
    assert.equal(mention, mentionOf(id, label), `the stored format stays the same for ${JSON.stringify(id)}`)
    assert.deepEqual(readMention(`see ${mention}`), { text: `see @${label}`, references: [{ sessionId: id, label }] })
  }
})

test('"@" offers a group\'s members and everyone, or every other Bot in a Bot\'s chat', () => {
  assert.deepEqual(names(mentionRows(roster, 'room')), ['Chief', 'King', 'everyone'])
  assert.deepEqual(names(mentionRows(roster, 'chief-2')), ['King', 'Writer'])
  assert.deepEqual(names(mentionRows(roster, 'chief', 'wri')), ['Writer'])
  assert.deepEqual(names(mentionRows(roster, 'room', 'ev')), ['everyone'])
  assert.deepEqual(
    mentionRows(roster, 'room', 'k').map(row => row.text),
    ['@King '],
  )
  assert.equal(mentionRows(roster, 'plain'), null)
  assert.equal(
    mentionRows(indexRoster({ bots: [], rooms: [] }) as unknown as Parameters<typeof mentionRows>[0], 'room'),
    null,
  )
})

test("the chats are the other Bots' current parts, then the latest Sessions outside the team", () => {
  const list = {
    ids: ['chief', 'chief-2', 'king', 'writer', 'room', 'king-in-room', 'old', 'new', 'child', 'blank'],
    byId: {
      king: { id: 'king', updatedAt: 5 },
      old: { id: 'old', displayTitle: 'Old work', updatedAt: 1 },
      new: { id: 'new', displayTitle: 'New work', updatedAt: 9 },
      child: { id: 'child', displayTitle: 'Child', origin: 'subagent', updatedAt: 10 },
      blank: { id: 'blank', displayTitle: 'Blank', blank: true, updatedAt: 11 },
    },
  }
  assert.deepEqual(
    chatRows(roster, list, 'chief-2').map(row => [row.sessionId, row.label]),
    [
      ['king', 'Chat with King'],
      ['writer', 'Chat with Writer'],
      ['new', 'New work'],
      ['old', 'Old work'],
    ],
  )
  assert.deepEqual(
    chatRows(roster, list, 'room').map(row => row.sessionId),
    ['chief-2', 'king', 'writer', 'new', 'old'],
  )
  assert.deepEqual(chatRows(roster, list, 'new'), [])
})

test('the chats join only the menu that "+" opened, and a pick inserts a session reference', async () => {
  let open = false
  const [bots, chats] = atSources({
    roster: { getSnapshot: () => roster },
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    launched: () => open,
    iconFor: () => 'session',
  })
  assert.deepEqual([bots.name, chats.name], [BOTS_SOURCE, CHATS_SOURCE])
  assert.ok(bots.order < chats.order && chats.order < 0)
  const session = { sessionId: 'chief-2' }
  assert.deepEqual(await chats.candidates(session, { query: '' }), [])
  open = true
  const rows = await chats.candidates(session, { query: '' })
  assert.deepEqual(
    rows.map(row => row.name),
    ['King', 'Writer'],
  )
  const picked = chats.onPick({ candidate: rows[0] }) as { insert: { ref: string; [key: string]: unknown } }
  assert.deepEqual(picked.insert, {
    source: CHATS_SOURCE,
    ref: sessionMention('king', 'Chat with King'),
    label: 'Chat with King',
    appearance: 'session',
    clipboardText: sessionMention('king', 'Chat with King'),
  })
  assert.equal(await chats.codec.serialize(picked.insert.ref), picked.insert.ref)

  const mentions = await bots.candidates({ sessionId: 'room' }, { query: '' })
  assert.deepEqual(
    mentions.map(row => [row.name, row.description]),
    [
      ['Chief', 'Lead'],
      ['King', undefined],
      ['Everyone', '2 members'],
    ],
  )
  assert.deepEqual(bots.onPick({ candidate: mentions[1] }), { text: '@King ' })
  assert.deepEqual(await bots.candidates({ sessionId: 'plain' }, { query: '' }), [])
})

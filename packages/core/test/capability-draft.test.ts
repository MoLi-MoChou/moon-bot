// The capability editor's rules: the field errors a save shows, and the request it sends
// for each kind and transport.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blankCapability,
  draftErrors,
  draftFromCapability,
  payloadOf,
  transportOf,
} from '../src/client/capability-draft.ts'
import { ZH } from '../src/client/i18n/zh.ts'

const draft = (overrides = {}) => ({ ...blankCapability(), ...overrides })

test('the form starts blank and round-trips a saved item', () => {
  const saved = {
    name: 'pg',
    kind: 'mcp',
    description: 'Database',
    transport: 'sse',
    url: 'https://mcp.test/sse',
    headers: { Authorization: 'Bearer $MOON_BOT_SECRET_PG' },
    env: { TOKEN: 'x' },
    args: ['a', 'b'],
  }
  const back = draftFromCapability(saved)
  assert.equal(back.originalName, 'pg')
  assert.equal(back.envText, JSON.stringify({ TOKEN: 'x' }, null, 2))
  assert.equal(back.argsText, 'a\nb')
  assert.equal(back.transport, 'sse')
  assert.deepEqual(payloadOf({ ...back, kind: 'skill', content: 'Read the docs.' }), {
    name: 'pg',
    kind: 'skill',
    description: 'Database',
    content: 'Read the docs.',
  })
})

test('the name is required, shaped, unique, and never the reserved connector id', () => {
  const items = [{ name: 'taken', kind: 'mcp' }]
  assert.equal(draftErrors(draft({ kind: 'skill', content: 'x' })).name, 'Enter a name.')
  assert.equal(
    draftErrors(draft({ name: 'github', kind: 'skill', content: 'x' }), items).name,
    '"github" is reserved for the GitHub connector.',
  )
  assert.equal(
    draftErrors(draft({ name: 'Bad Name', kind: 'skill', content: 'x' }), items).name,
    'Use lowercase letters, digits, and single hyphens, starting with a letter.',
  )
  assert.equal(
    draftErrors(draft({ name: 'taken', kind: 'skill', content: 'x' }), items).name,
    'A capability with this name already exists.',
  )
  // Editing keeps its own name.
  assert.equal(
    draftErrors(draft({ name: 'taken', originalName: 'taken', kind: 'skill', content: 'x' }), items).name,
    undefined,
  )
})

test('the transport decides which fields must be filled and shaped', () => {
  const stdio = draftErrors(draft({ name: 'x', transport: 'stdio', command: '' }))
  assert.equal(stdio.command, 'Enter the command that starts the server.')
  assert.equal(
    draftErrors(draft({ name: 'x', transport: 'stdio', command: 'npx -y x', envText: '[' })).envText?.startsWith(
      'Use a JSON object',
    ),
    true,
  )
  const http = draftErrors(draft({ name: 'x', transport: 'streamable-http', url: 'ftp://mcp.test' }))
  assert.equal(http.url, 'Enter a full HTTP or HTTPS URL.')
  assert.equal(
    draftErrors(
      draft({ name: 'x', transport: 'sse', url: 'https://mcp.test/sse', headersText: '[]' }),
    ).headersText?.startsWith('Use a JSON object'),
    true,
  )
  assert.deepEqual(draftErrors(draft({ name: 'x', kind: 'skill', content: 'Do it.' })), {})
  assert.equal(draftErrors(draft({ name: 'x', kind: 'skill', content: '  ' })).content, 'Write the skill instructions.')
  assert.equal(transportOf(draft({ transport: 'sse' })), 'sse')
  assert.equal(transportOf(draft({ transport: 'nonsense' })), 'stdio')
})

test('a valid draft becomes the capability-save payload for every kind', () => {
  const stdio = payloadOf(
    draft({
      name: 'pg',
      kind: 'mcp',
      transport: 'stdio',
      command: ' npx ',
      argsText: '-y\nserver\n',
      envText: '{"TOKEN":"$MOON_BOT_SECRET_PG"}',
    }),
  )
  assert.deepEqual(stdio, {
    name: 'pg',
    kind: 'mcp',
    description: '',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server'],
    env: { TOKEN: '$MOON_BOT_SECRET_PG' },
  })
  const http = payloadOf(
    draft({
      name: 'exa',
      transport: 'streamable-http',
      url: ' https://mcp.test/mcp ',
      headersText: '{"Authorization":"Bearer $MOON_BOT_SECRET_EXA"}',
    }),
  )
  assert.deepEqual(http, {
    name: 'exa',
    kind: 'mcp',
    description: '',
    transport: 'streamable-http',
    url: 'https://mcp.test/mcp',
    headers: { Authorization: 'Bearer $MOON_BOT_SECRET_EXA' },
  })
  const sse = payloadOf(draft({ name: 'sse', transport: 'sse', url: 'https://mcp.test/sse', headersText: '{}' }))
  assert.equal(sse.transport, 'sse')
  assert.equal(sse.url, 'https://mcp.test/sse')
  const pack = payloadOf(draft({ name: 'team', kind: 'pack', items: ['pg', 'guide'] }))
  assert.deepEqual(pack, { name: 'team', kind: 'pack', description: '', items: ['pg', 'guide'] })
})

test('every field error the form shows has a Chinese entry', () => {
  const messages = [
    'Enter a name.',
    '"github" is reserved for the GitHub connector.',
    'Use lowercase letters, digits, and single hyphens, starting with a letter.',
    'A capability with this name already exists.',
    'Enter the command that starts the server.',
    'Use a JSON object, such as {"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}.',
    'Enter a full HTTP or HTTPS URL.',
    'Use a JSON object, such as {"Authorization": "Bearer $MOON_BOT_SECRET_MY_KEY"}.',
    'Write the skill instructions.',
  ]
  for (const message of messages) assert.ok(Object.hasOwn(ZH, message), `missing zh entry: ${message}`)
})

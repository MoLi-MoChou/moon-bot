// Custom connector rules: the id the host gets, duplicate names, the fields each transport
// needs, and the save/test payloads the form sends.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blankCustomConnector,
  commandParts,
  connectorIdOf,
  customCapabilityOf,
  customConnectorErrors,
  customTestOf,
  draftFromConnector,
} from '../src/client/connector-custom.ts'
import { ZH } from '../src/client/i18n/zh.ts'

const draft = (overrides = {}) => ({ ...blankCustomConnector(), ...overrides })
const existing = [{ name: 'taken' }, { name: 'pg' }]

test('a typed name becomes a lowercase hyphenated id', () => {
  assert.equal(connectorIdOf('My Custom Tool'), 'my-custom-tool')
  assert.equal(connectorIdOf('  --npx_Server--  '), 'npx-server')
  assert.equal(connectorIdOf('中文'), '')
  assert.equal(connectorIdOf('a'.repeat(40)).length, 32)
})

test('name validation covers empty, reserved, duplicate, and length', () => {
  assert.equal(customConnectorErrors(draft({ name: '' })).name, 'Enter a name with letters or digits.')
  assert.equal(customConnectorErrors(draft({ name: 'GitHub' })).name, '"github" is reserved for the GitHub connector.')
  assert.equal(
    customConnectorErrors(draft({ name: 'Taken' }), existing).name,
    'A capability with this name already exists.',
  )
  assert.equal(
    customConnectorErrors(draft({ name: 'taken', originalName: 'taken', transport: 'stdio', command: 'npx' }), existing)
      .name,
    undefined,
  )
})

test('each transport asks for its own required and formatted fields', () => {
  assert.equal(
    customConnectorErrors(draft({ name: 'probe', transport: 'stdio' })).command,
    'Enter the command that starts the server.',
  )
  assert.match(
    customConnectorErrors(draft({ name: 'probe', transport: 'stdio', command: 'npx', envText: 'nope' })).envText ?? '',
    /JSON object/,
  )
  assert.equal(
    customConnectorErrors(draft({ name: 'probe', transport: 'streamable-http', url: 'mcp.test/mcp' })).url,
    'Enter a full HTTP or HTTPS URL.',
  )
  assert.equal(
    customConnectorErrors(
      draft({ name: 'probe', transport: 'sse', url: 'https://mcp.test/sse', headersText: '[]' }),
    ).headersText?.startsWith('Use a JSON object'),
    true,
  )
  assert.deepEqual(
    customConnectorErrors(
      draft({
        name: 'probe',
        transport: 'sse',
        url: 'https://mcp.test/sse',
        headersText: '{"A":"$MOON_BOT_SECRET_A"}',
      }),
    ),
    {},
  )
})

test('the save and test payloads keep the command line, arguments, and transport apart', () => {
  assert.deepEqual(commandParts('npx -y any-mcp-server'), { command: 'npx', args: ['-y', 'any-mcp-server'] })
  const stdio = draft({
    name: 'My Tool',
    transport: 'stdio',
    command: 'npx -y server',
    argsText: '--flag\nvalue',
    envText: '{"TOKEN":"x"}',
    description: '',
  })
  assert.deepEqual(customCapabilityOf(stdio), {
    name: 'my-tool',
    kind: 'mcp',
    description: 'my-tool MCP server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server', '--flag', 'value'],
    env: { TOKEN: 'x' },
  })
  const http = draft({
    name: 'Remote',
    transport: 'streamable-http',
    url: 'https://mcp.test/mcp',
    headersText: '{"Authorization":"Bearer $MOON_BOT_SECRET_X"}',
    description: 'Do it',
  })
  assert.deepEqual(customCapabilityOf(http), {
    name: 'remote',
    kind: 'mcp',
    description: 'Do it',
    transport: 'streamable-http',
    url: 'https://mcp.test/mcp',
    headers: { Authorization: 'Bearer $MOON_BOT_SECRET_X' },
  })
  const sse = draft({ name: 'Legacy', transport: 'sse', url: 'https://mcp.test/sse', headersText: '{}' })
  assert.equal(customCapabilityOf(sse).transport, 'sse')
  assert.equal(customTestOf(sse).name, 'legacy')
  assert.equal(customTestOf(draft({ name: '', transport: 'stdio', command: 'node' })).name, 'test-connection')
})

test('an edited connector keeps its id and prefills the form', () => {
  const item = {
    name: 'pg',
    kind: 'mcp',
    description: 'Database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pg'],
    env: { A: 'b' },
  }
  const back = draftFromConnector(item)
  assert.equal(back.originalName, 'pg')
  assert.equal(back.argsText, '-y\npg')
  assert.equal(back.envText, JSON.stringify({ A: 'b' }, null, 2))
  assert.equal(customCapabilityOf({ ...back, name: 'ignored' }).name, 'pg')
})

test('every editor error has a Chinese entry', () => {
  const messages = [
    'Enter a name with letters or digits.',
    '"github" is reserved for the GitHub connector.',
    'Keep the name to 32 characters or fewer.',
    'A capability with this name already exists.',
    'Enter the command that starts the server.',
    'Enter a full HTTP or HTTPS URL.',
    'Use a JSON object, such as {"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}.',
    'Use a JSON object, such as {"Authorization": "Bearer $MOON_BOT_SECRET_MY_KEY"}.',
  ]
  for (const message of messages) assert.ok(Object.hasOwn(ZH, message), `missing zh entry: ${message}`)
})

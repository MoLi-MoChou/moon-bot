// The remote-agent settings page (2026-10-27 remote-agents): the invite list renders
// what the host reports, and the one command a user copies points at this deployment
// with the right scheme — an https page must hand out wss, or the CLI cannot connect.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/relay-page.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom'],
})
const module = { exports: {} as {
  connectCommand: (origin: { protocol: string, host: string }, token: string) => string
  RelayPage: (props: Record<string, unknown>) => unknown
} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    const platform = {
      react: {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: (props ?? {}) as Record<string, unknown>, children: children.flat(Infinity) }),
        Fragment: 'fragment',
        useState: (initial: unknown) => [initial, () => {}],
        // A mount runs its effect once, so the load call is observable.
        useEffect: (run: () => unknown) => { run() },
      },
      'react-dom': { createPortal: (node: unknown) => node },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name] as unknown
  },
  window: { location: { protocol: 'https:', host: 'moon.example.com' } },
})
const { connectCommand, RelayPage } = module.exports

function nodes(tree: unknown, match: (node: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (tree === null || typeof tree !== 'object') return []
  const node = tree as Record<string, unknown>
  return [...(match(node) ? [node] : []), ...((node.children ?? []) as unknown[]).flatMap(child => nodes(child, match))]
}

test('the copied command follows the page scheme and names this deployment', () => {
  const secure = connectCommand({ protocol: 'https:', host: 'moon.example.com' }, 'tok123')
  assert.match(secure, /^npx moon-bot-connect --url wss:\/\/moon\.example\.com\/api\/bot\/relay --token tok123$/)
  const local = connectCommand({ protocol: 'http:', host: '127.0.0.1:8290' }, 'tok456')
  assert.match(local, /^npx moon-bot-connect --url ws:\/\/127\.0\.0\.1:8290\/api\/bot\/relay --token tok456$/)
})

test('the page renders the create form and waits for the invite list', () => {
  const calls: string[] = []
  const page = RelayPage({ relay: {
    relayInvites: () => { calls.push('invites'); return new Promise(() => {}) },
    relayInviteCreate: () => { calls.push('create'); return new Promise(() => {}) },
    relayInviteRevoke: () => { calls.push('revoke'); return new Promise(() => {}) },
  } }) as Record<string, unknown>
  const buttons = nodes(page, node => node.type === 'button')
  assert.ok(buttons.some(button => JSON.stringify(button.children).includes('Create invite')), 'the create button is there')
  const inputs = nodes(page, node => node.type === 'input')
  assert.equal(inputs.length, 1, 'one name field')
  assert.deepEqual(calls, ['invites'], 'the list loads on mount, nothing else fires')
})

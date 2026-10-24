import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

const { outputFiles } = await build({
  stdin: {
    contents: `
      export { EmptyState, EMPTY_STATE_CSS } from './src/client/empty-state.js'
      export { ChatWelcome, welcomeCopy } from './src/client/chat-welcome'
      export { CommandPalette } from './src/client/palette'
      export { TeamSidebar } from './src/client/sidebar'
      export { installFilesPanel } from './src/client/files-panel.ts'
    `,
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
  Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}

function runBundle(domWindow = { innerWidth: 1280 }) {
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports,
    require: name => (name === 'react' ? react : {}),
    window: domWindow, document: domWindow.document,
    MutationObserver: domWindow.MutationObserver,
    requestAnimationFrame: fn => { fn(); return 1 },
    cancelAnimationFrame() {},
  })
  return module.exports
}

function flatten(node, out = []) {
  if (Array.isArray(node)) { node.forEach(child => flatten(child, out)); return out }
  if (!node || typeof node !== 'object') return out
  if (typeof node.type === 'function' && !['BotRow', 'RoomRow', 'AgentRow'].includes(node.type.name)) {
    return flatten(node.type(node.props ?? {}), out)
  }
  out.push(node)
  flatten(node.props?.children, out)
  return out
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(node.props ?? {}))
  return textOf(node.props?.children)
}

test('EmptyState renders an action button only when given a real handler', () => {
  const { EmptyState } = runBundle()
  const bare = flatten(EmptyState({ title: 'Nothing here', hint: 'Add one to start.' }))
  assert.equal(bare.some(node => node.type === 'button'), false)

  const clicks = []
  const withAction = flatten(EmptyState({
    title: 'No Bots', hint: 'Create one.',
    action: { label: 'Create Bot', onClick: () => clicks.push('created') },
  }))
  const button = withAction.find(node => node.type === 'button' && node.props.className === 'bt-es-action')
  assert.ok(button)
  assert.equal(textOf(button), 'Create Bot')
  button.props.onClick()
  assert.deepEqual(clicks, ['created'])
})

test('welcomeCopy guides a fresh Main Bot, peer Bot or group, and skips continued parts', () => {
  const { welcomeCopy } = runBundle()
  const main = { id: 'main', name: 'Moon', parts: [] }
  const writer = { id: 'writer', name: 'Writer', role: 'Drafts docs', parts: [] }
  const continued = { id: 'old', sessionId: 'old-2', name: 'Coder', parts: ['old'] }
  const room = { id: 'room', name: 'Design', parts: [] }
  const roster = {
    mainBotId: 'main', mainBotIds: ['main'],
    byId: { main, writer, 'old-2': continued },
    roomsById: { room },
  }
  assert.match(welcomeCopy(roster, 'main').title, /Moon/)
  assert.match(welcomeCopy(roster, 'writer').hint, /Drafts docs/)
  assert.equal(welcomeCopy(roster, 'old-2'), null)
  assert.match(welcomeCopy(roster, 'room').title, /Design/)
  assert.equal(welcomeCopy(roster, 'stranger'), null)
})

test('an open sidebar with only the Main Bot invites the user to create a Bot', () => {
  const { TeamSidebar } = runBundle()
  const opened = []
  const main = { id: 'main', name: 'Moon', createdAt: 1 }
  const roster = { mainBotId: 'main', mainBotIds: ['main'], bots: [main], rooms: [], agents: [], byId: { main }, roomsById: {}, ready: true, exchangeTurns: {} }
  const props = wide => ({
    wide,
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {}, visits: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useSessionStatus: pick => pick(new Map()),
    useSessionRetainInfo: pick => pick(new Map()), useActivity: pick => pick({}), useWork: pick => pick({ bots: {}, rooms: {} }),
    useUpdate: () => ({}),
    actions: { openNewChat: mode => opened.push(mode), openSession() {}, toggleSidebar() {}, landOn() {} },
  })
  const wideNodes = flatten(TeamSidebar(props(true)))
  const action = wideNodes.find(node => node.type === 'button' && node.props.className === 'bt-es-action')
  assert.ok(action, 'wide sidebar shows the create-Bot empty state')
  action.props.onClick()
  assert.deepEqual(opened, ['create'])

  const railNodes = flatten(TeamSidebar(props(false)))
  assert.equal(railNodes.some(node => node.props?.className === 'bt-es'), false)
})

test('the command palette shows a clear-search empty state when nothing matches', () => {
  const { CommandPalette } = runBundle()
  const roster = { mainBotId: 'main', mainBotIds: ['main'], bots: [], rooms: [], agents: [], byId: {}, roomsById: {}, exchangeTurns: {} }
  const nodes = flatten(CommandPalette({
    start: 'zzzz-no-hit', token: 1, roster,
    actions: { closePalette() {}, reportError() {} },
    useSessions: pick => pick({ projectionsBySession: {}, byId: {} }),
  }))
  const empty = nodes.find(node => node.props?.className === 'bt-es')
  assert.ok(empty)
  assert.match(textOf(empty), /zzzz-no-hit/)
  const clear = nodes.find(node => node.type === 'button' && node.props.className === 'bt-es-action')
  assert.equal(textOf(clear), 'Clear search')
})

test('the files panel fills empty folders and missing workspaces with guided empty states', () => {
  const { window } = new JSDOM(`<!doctype html><html><body>
    <div data-files-state="tree">
      <button type="button" data-files-reload></button>
      <div data-files-body><ul><li data-files-row="empty">Empty directory</li></ul></div>
    </div>
    <div data-files-state="no-workspace"><p>No workspace</p></div>
  </body></html>`)
  const { installFilesPanel } = runBundle(window)
  let reloaded = 0
  let picked = 0
  window.document.querySelector('[data-files-reload]').addEventListener('click', () => { reloaded += 1 })
  const stop = installFilesPanel({ call: async () => ({}), onPickFolder: () => { picked += 1 } })
  try {
    const emptyFolder = window.document.querySelector('[data-files-row="empty"] > .bt-es')
    assert.ok(emptyFolder)
    emptyFolder.querySelector('.bt-es-action').click()
    assert.equal(reloaded, 1)

    const noWorkspace = window.document.querySelector('[data-files-state="no-workspace"] > .bt-es')
    assert.ok(noWorkspace)
    noWorkspace.querySelector('.bt-es-action').click()
    assert.equal(picked, 1)
  } finally {
    stop()
  }
})

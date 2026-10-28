// The task panel (2026-10-28 tasks-panel): the clocks and the "what is it doing" line are
// the page's own arithmetic, so they are tested without a browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/tasks-page.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom'],
})
interface State {
  answer: { running: readonly Record<string, unknown>[]; completed: readonly Record<string, unknown>[]; waiting: readonly Record<string, unknown>[] } | null
  now: number
  busy: string | null
  stopped: ReadonlySet<string>
  notice: string | null
  error: string | null
  refresh: () => void
  stop: (task: Record<string, unknown>) => void
}
const module = { exports: {} as {
  elapsed: (ms: number) => string
  doingText: (task: Record<string, unknown>, translate?: (key: string, params?: Record<string, unknown>) => string) => string
  reasonText: (reason: string) => string
  TasksBoard: (props: { state: State; onOpen: (sessionId: string) => void }) => unknown
} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: name => {
    const platform = {
      react: {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        Fragment: 'fragment',
        useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: (initial: unknown) => ({ current: initial }),
      },
      'react-dom': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name] as unknown
  },
})
const { elapsed, doingText, reasonText, TasksBoard } = module.exports

// The element tree the fake createElement builds: walk every node for its text and props.
const elements = (node: unknown): { props: Record<string, unknown>; children?: readonly unknown[] }[] => {
  if (Array.isArray(node))
    return node.flatMap(elements)
  if (node === null || typeof node !== 'object')
    return []
  const element = node as { props?: Record<string, unknown>; children?: readonly unknown[] }
  return [element as { props: Record<string, unknown>; children?: readonly unknown[] }, ...(element.children ?? []).flatMap(elements)]
}
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number')
    return String(node)
  if (Array.isArray(node))
    return node.map(textOf).join(' ')
  if (node !== null && typeof node === 'object')
    return ((node as { children?: readonly unknown[] }).children ?? []).map(textOf).join(' ')
  return ''
}
const propsOf = (node: unknown): Record<string, unknown>[] => elements(node).map(element => element.props)
const rows = (patch: Partial<State> = {}): State => ({
  answer: { running: [], completed: [], waiting: [] },
  now: 10_000, busy: null, stopped: new Set(), notice: null, error: null,
  refresh: () => {}, stop: () => {},
  ...patch,
})
const running = (patch: Record<string, unknown> = {}) => ({ sessionId: 'chat:b1', botId: 'b1', botName: 'Writer', since: 1_000, ...patch })

test('the clocks read as minutes and seconds, then hours', () => {
  assert.equal(elapsed(0), '0:00')
  assert.equal(elapsed(1_000), '0:01')
  assert.equal(elapsed(61_000), '1:01')
  assert.equal(elapsed(59 * 60_000 + 59_000), '59:59')
  assert.equal(elapsed(3_600_000), '1:00:00')
  assert.equal(elapsed(3_723_000), '1:02:03')
  assert.equal(elapsed(-5), '0:00')
})

test('a row says what the Bot is doing, in the order the host reports it', () => {
  const identity = (key: string, params?: Record<string, unknown>) => params === undefined ? key : `${key} ${JSON.stringify(params)}`
  assert.equal(doingText({ switching: true }, identity), 'Switching to a new session')
  assert.equal(doingText({ tool: 'read_file', target: 'plan.md' }, identity), 'Running {tool} on {target} {"tool":"read_file","target":"plan.md"}')
  assert.equal(doingText({ tool: 'web_search' }, identity), 'Running {tool} {"tool":"web_search"}')
  assert.equal(doingText({ said: 'Looking at the logs' }, identity), 'Looking at the logs')
  assert.equal(doingText({}, identity), 'Working')
})

test('a running row says how many messages wait behind its turn, and who its Stop ends', () => {
  const tree = TasksBoard({ state: rows({ answer: { running: [running({ queued: 2, fromName: 'Chief' })], completed: [], waiting: [] } }), onOpen: () => {} })
  assert.match(textOf(tree), /2 queued/)
  assert.match(textOf(tree), /for Chief/)
  const labels = propsOf(tree).map(props => props['aria-label']).filter(label => typeof label === 'string')
  assert.ok(labels.includes('Stop Writer'), `the stop names the Bot: ${labels.join(', ')}`)
})

test('a row with nothing queued says nothing about a queue', () => {
  const tree = TasksBoard({ state: rows({ answer: { running: [running()], completed: [], waiting: [] } }), onOpen: () => {} })
  assert.doesNotMatch(textOf(tree), /queued/)
})

test('a stopped row reads stopped and takes its Stop away', () => {
  const tree = TasksBoard({ state: rows({ answer: { running: [running()], completed: [], waiting: [] }, stopped: new Set(['chat:b1:1000']) }), onOpen: () => {} })
  assert.match(textOf(tree), /Stopped by you/)
  assert.equal(propsOf(tree).some(props => props['aria-label'] === 'Stop Writer'), false)
})

test('a turn that starts after a stop is not the turn that was stopped', () => {
  const tree = TasksBoard({ state: rows({ answer: { running: [running({ since: 2_000 })], completed: [], waiting: [] }, stopped: new Set(['chat:b1:1000']) }), onOpen: () => {} })
  assert.doesNotMatch(textOf(tree), /Stopped by you/)
  assert.equal(propsOf(tree).some(props => props['aria-label'] === 'Stop Writer'), true)
})

test('a finished row says who ended it', () => {
  assert.equal(reasonText('completed'), 'Finished')
  assert.equal(reasonText('error'), 'Failed')
  assert.equal(reasonText('user'), 'Stopped by you')
  assert.equal(reasonText('hook'), 'Stopped by a Main Bot')
  assert.equal(reasonText('aborted'), 'Stopped')
  assert.equal(reasonText('disposed'), 'Stopped')
})

test('a stop that found nothing says so instead of staying silent', () => {
  const tree = TasksBoard({ state: rows({ notice: 'Writer had already finished, so nothing was stopped.' }), onOpen: () => {} })
  const notice = elements(tree).find(element => element.props.role === 'status')
  assert.ok(notice !== undefined, 'the notice is announced')
  assert.match(textOf(notice.children), /had already finished/)
  assert.equal(propsOf(tree).some(props => props['aria-label'] === 'Stop Writer'), false)
})

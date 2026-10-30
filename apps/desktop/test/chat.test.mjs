import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const APP = join(fileURLToPath(new URL('..', import.meta.url)))
const STUBS = new Map([
  [/\/core\/src\/client\/api\.ts$/, 'export const call = (endpoint, payload, signal) => globalThis.__chatCall(endpoint, payload, signal)'],
  [/\/core\/src\/client\/icons\.tsx$/, 'export const ArrowUpIcon = () => null; export const CalendarIcon = () => null; export const GearIcon = () => null; export const MemoryIcon = () => null; export const MicIcon = () => null; export const PeopleIcon = () => null; export const PlugIcon = () => null; export const PlusIcon = () => null; export const SlidersIcon = () => null'],
  [/\/core\/src\/client\/cells\.ts$/, 'export const Bubbles = () => null; export const ChatRows = () => null; export const Shimmer = ({ children }) => children; export const workPhrase = value => value'],
  [/\/core\/src\/client\/composer\.tsx$/, 'export const ComposerPlus = () => null; export const ComposerVoice = () => null'],
  [/\/core\/src\/client\/i18n\.ts$/, 'export const t = key => key; export const language = () => "en"'],
  [/\/core\/src\/client\/model-menu\.tsx$/, 'export const ModelChoiceDock = () => null'],
  [/\/core\/src\/client\/questions\.tsx$/, 'export const PendingQuestion = () => null'],
  [/\/core\/src\/client\/characters\.ts$/, 'export const lookOf = () => ({ color: "" })'],
  [/\/core\/src\/client\/inks\.ts$/, 'export const inkText = value => value'],
  [/\/core\/src\/client\/mention-chips\.tsx$/, 'export const MentionMirror = () => null; export const deleteMentionBefore = () => null; export const mentionChips = () => []'],
  [/\/apps\/desktop\/ui\/src\/team\.ts$/, 'export const asActions = value => value'],
  [/\/apps\/desktop\/ui\/src\/composer-menu\.tsx$/, 'export const ComposerMenu = () => null; export const detectTrigger = () => null'],
])

const { outputFiles } = await build({
  entryPoints: [join(APP, 'ui/src/chat.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react-dom'],
  plugins: [{
    name: 'chat-test-stubs',
    setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        const source = args.path.startsWith('.') ? join(args.resolveDir ?? '', args.path) : args.path
        const index = [...STUBS].findIndex(([pattern]) => pattern.test(source))
        return index < 0 ? undefined : { path: `chat-test:${String(index)}`, namespace: 'chat-test' }
      })
      plugin.onLoad({ filter: /.*/, namespace: 'chat-test' }, args => {
        const index = Number(args.path.slice('chat-test:'.length))
        const contents = [...STUBS][index]?.[1]
        if (contents === undefined) throw new Error(`missing chat test stub ${args.path}`)
        return { contents, loader: 'ts' }
      })
    },
  }],
})

const module = { exports: {} }
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat(Infinity) } }),
  Fragment: 'fragment',
  useState(initial) {
    const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
  },
  useRef(initial) { return slot(() => ({ current: initial })) },
  useCallback(fn, deps) {
    const cell = slot(() => ({ fn, deps }))
    if (changed(deps, cell.deps)) { cell.fn = fn; cell.deps = deps }
    return cell.fn
  },
  useEffect(effect, deps) {
    const cell = slot(() => ({ deps: undefined, cleanup: undefined }))
    if (changed(deps, cell.deps)) {
      pending.push(() => {
        cell.cleanup?.()
        cell.deps = deps
        cell.cleanup = effect()
      })
    }
  },
  useLayoutEffect() {},
  useMemo(make) { return make() },
}
const context = {
  module,
  exports: module.exports,
  AbortController,
  Promise,
  setImmediate,
  require: name => {
    assert.equal(name, 'react')
    return react
  },
}
let active
let pending = []
const slot = make => {
  const index = active.index++
  return active.slots[index] ??= make()
}
const changed = (next, previous) => next === undefined || previous === undefined || next.length !== previous.length || next.some((value, index) => !Object.is(value, previous[index]))
runInNewContext(outputFiles[0].text, context)
const { useChat } = module.exports

const tick = () => new Promise(resolve => setImmediate(resolve))
const page = sessionId => ({ sessionId, items: [{ kind: 'user', text: sessionId, time: 1 }], cursor: undefined })

function mount(initial) {
  const instance = {
    props: initial,
    slots: [],
    index: 0,
    render(next = instance.props) {
      instance.props = next
      instance.index = 0
      pending = []
      active = instance
      const value = useChat(instance.props.botId, instance.props.part, instance.props.feed)
      active = undefined
      for (const effect of pending.splice(0)) effect()
      return value
    },
    unmount() {
      for (const cell of instance.slots) cell.cleanup?.()
    },
  }
  return instance
}

function deferredCalls() {
  const calls = []
  context.__chatCall = (endpoint, payload, signal) => new Promise((resolve, reject) => {
    calls.push({ endpoint, payload, signal, resolve, reject })
  })
  return calls
}

// The old transport is deliberately allowed to resolve after abort: the sequence guard is
// what protects the new conversation when cancellation cannot stop a response in flight.
test('a stale conversation load cannot populate a newly selected conversation', async () => {
  const calls = deferredCalls()
  const feed = { on: () => () => {} }
  const view = mount({ botId: 'alpha', part: 'part-alpha', feed })
  view.render()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].payload.botId, 'alpha')

  view.render({ botId: 'beta', part: 'part-beta', feed })
  assert.equal(calls.length, 2, 'a new selection starts a load instead of being skipped as busy')
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(calls[1].payload.botId, 'beta')

  calls[0].resolve(page('alpha'))
  await tick()
  assert.equal(view.render().view.sessionId, null, 'the stale response is ignored')

  calls[1].resolve(page('beta'))
  await tick()
  assert.equal(view.render().view.sessionId, 'beta')
  view.unmount()
})

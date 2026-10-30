import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/deliver-cards.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom'],
})
const effects = []
const initials = []
const states = []
const fetchCalls = []
let fetchAnswer = null
const module = { exports: {} as {
  FileCards: (props: Record<string, unknown>) => unknown
  FilePreview: (props: Record<string, unknown>) => unknown
  fileKind: (name: string) => string
  timeBucket: (at: number, now?: number) => string
  useTurnFiles: (sessionId: string, turn: number) => unknown
} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  // The hook's one fetch: answered from `fetchAnswer`, so the cache it builds is real.
  fetch: async (_route: string, init: { body: string }) => {
    fetchCalls.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ ok: true, value: fetchAnswer }) }
  },
  require: name => {
    const platform = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initial => { initials.push(initial); return [initial, value => states.push(value)] },
        useEffect: run => { effects.push(run); return () => {} },
        useRef: current => ({ current }),
      },
      'react-dom': { createPortal: node => node },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { FileCards, FilePreview, fileKind, timeBucket, useTurnFiles } = module.exports

function nodes(tree, match) {
  if (!tree || typeof tree !== 'object') return []
  return [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, match))]
}
const textOf = (tree, className) => nodes(tree, node => node.props.className === className).map(node => node.children[0])

test('file kinds group by extension, case-blind, and drop the rest', () => {
  const named = [
    ['shot.png', 'image'], ['PHOTO.JPG', 'image'], ['art.svg', 'image'],
    ['report.pdf', 'document'], ['notes.md', 'document'], ['brief.docx', 'document'], ['deck.pptx', 'document'],
    ['data.xlsx', 'sheet'], ['rows.csv', 'sheet'],
    ['main.ts', 'code'], ['run.py', 'code'], ['readme.txt', 'code'], ['config.yaml', 'code'],
    ['clip.mp4', 'media'], ['song.mp3', 'media'],
    ['bundle.zip', 'other'], ['setup.exe', 'other'], ['noextension', 'other'], ['archive.tar.gz', 'other'],
  ]
  assert.deepEqual(named.map(([name]) => fileKind(name)), named.map(entry => entry[1]))
})

test('a file lands in today, this week, or earlier by the local calendar', () => {
  const local = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime()
  const now = local(2026, 10, 28, 15)
  assert.equal(timeBucket(local(2026, 10, 28, 0), now), 'today')
  assert.equal(timeBucket(local(2026, 10, 27, 23), now), 'week')
  assert.equal(timeBucket(local(2026, 10, 18, 12), now), 'earlier')
})

test('the cards show name, size and the relative path, and warn about a big file', () => {
  const files = [
    { name: 'report.md', path: 'docs/report.md', size: 2048, createdAt: 1 },
    { name: 'chart.png', path: 'img/chart.png', size: 70 * 1024 * 1024, createdAt: 2 },
  ]
  const opened = []
  const tree = FileCards({ files, sessionId: 'b', onOpen: file => opened.push(file) })
  const cards = nodes(tree, node => node.props.className === 'bt-dcard')
  assert.equal(cards.length, 2)
  assert.deepEqual(cards.map(card => card.props.title), ['docs/report.md', 'img/chart.png'])
  assert.deepEqual(textOf(tree, 'bt-dcard-name'), ['report.md', 'chart.png'])
  assert.deepEqual(textOf(tree, 'bt-dcard-meta'), ['2.0 KB · MD file', '70 MB · PNG file'])
  assert.deepEqual(textOf(tree, 'bt-dcard-big'), ['Large file. The download may take a while.'])
  cards[0].props.onClick()
  assert.deepEqual(opened, [files[0]])
})

test('the preview says what a Word file cannot do, and offers the download', () => {
  const tree = FilePreview({ file: { name: 'brief.docx', path: 'out/brief.docx', size: 4096, createdAt: 1 }, sessionId: 'b', onClose: () => {} })
  assert.equal(nodes(tree, node => node.props.role === 'dialog').length, 1)
  assert.equal(textOf(tree, 'bt-fpreview-name')[0], 'brief.docx')
  assert.match(textOf(tree, 'bt-fpreview-meta')[0], /^out\/brief\.docx/)
  assert.equal(nodes(tree, node => node.props.className === 'bt-fpreview-none').length, 1)
  assert.match(textOf(tree, 'bt-fpreview-note')[0], /no preview/)
  assert.deepEqual(textOf(tree, 'bt-fpreview-download'), ['Download'])
})

test('a preview that needs its bytes waits for them behind a loading line', () => {
  const tree = FilePreview({ file: { name: 'chart.png', path: 'img/chart.png', size: 2048, createdAt: 1 }, sessionId: 'b', onClose: () => {} })
  assert.deepEqual(textOf(tree, 'bt-fpreview-loading'), ['Loading…'])
  assert.equal(nodes(tree, node => node.type === 'img').length, 0)
})

test('the turn files hook asks once per turn and keeps the answer for the next mount', async () => {
  fetchAnswer = { files: [{ name: 'a.md', path: 'a.md', size: 1, createdAt: 1 }] }
  effects.length = 0
  states.length = 0
  assert.equal(useTurnFiles('s1', 3), null)
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fetchCalls, [{ endpoint: 'turn-files', payload: { sessionId: 's1', turn: 3 } }])
  assert.deepEqual(states[0].map(file => file.name), ['a.md'])
  // The chat remounts tail cells as it scrolls; the cached turn answers without a call.
  fetchCalls.length = 0
  effects.length = 0
  const again = useTurnFiles('s1', 3) as { name: string }[]
  assert.deepEqual(again.map(file => file.name), ['a.md'])
  effects[effects.length - 1]()
  assert.equal(fetchCalls.length, 0)
})

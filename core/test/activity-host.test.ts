import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

// The activity row ("正在琢磨…") mounts into the shell's running status. DSH 0.2.1 wraps
// that status in a [data-slot] div inside the transcript column; the row looked only for
// a direct child, so nothing showed between sending a message and the first reply text.

// A tiny element tree with querySelector(All) for "[a] [b]" and "[a] > [b]" attribute selectors.
const el = (attrs = {}, ...children) => {
  const node = { attrs, children, parentElement: null }
  for (const child of children) child.parentElement = node
  const all = () => children.flatMap(child => [child, ...child.all()])
  const has = (n, attr) => Object.hasOwn(n.attrs, attr)
  const matches = (n, sel) => {
    const parts = sel.trim().split(/\s+/)
    const last = parts.pop().slice(1, -1)
    if (!has(n, last)) return false
    let cursor = n
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index]
      if (part === '>') { const attr = parts[--index].slice(1, -1); cursor = cursor.parentElement; if (!cursor || !has(cursor, attr)) return false; continue }
      const attr = part.slice(1, -1)
      do cursor = cursor.parentElement; while (cursor && !has(cursor, attr))
      if (!cursor) return false
    }
    return true
  }
  Object.assign(node, {
    all,
    getAttribute: name => node.attrs[name] ?? null,
    closest: (sel) => { const alts = sel.split(',').map(s => s.trim().slice(1, -1)); let n = node; while (n && !alts.some(a => has(n, a))) n = n.parentElement; return n },
    querySelectorAll: sel => all().filter(n => matches(n, sel)),
    querySelector: sel => all().find(n => matches(n, sel)) ?? null,
  })
  return node
}

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/activity-row.tsx', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, setTimeout, clearTimeout,
  require: name => ({ react: { createElement: () => null }, 'react-dom': { createPortal: () => null }, '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null } })[name] ?? {},
})
const { runningSlot, flowRows } = module.exports

test('the activity row finds the running status inside DSH\'s slot wrapper', () => {
  const running = el({ 'data-chat-running': '' })
  const doc = el({}, el({ 'data-chat-flow': '' }, el({ 'data-chat-flow-key': '1' }), el({ 'data-slot': 'x' }, running)))
  assert.equal(runningSlot(doc), running)
})

test('the activity row still finds a running status that is a direct child', () => {
  const running = el({ 'data-chat-running': '' })
  const doc = el({}, el({ 'data-chat-flow': '' }, running))
  assert.equal(runningSlot(doc), running)
})

test('no running status, no row', () => {
  assert.equal(runningSlot(el({}, el({ 'data-chat-flow': '' }))), null)
})

test('transcript rows are found wrapped or not, but not rows nested in a row', () => {
  const nested = el({ 'data-chat-flow-key': 'inner' })
  const a = el({ 'data-chat-flow-key': 'a' }, nested)
  const b = el({ 'data-chat-flow-key': 'b' })
  const column = el({ 'data-chat-flow': '' }, a, el({ 'data-slot': 'y' }, b))
  assert.equal(flowRows(column).map(row => row.attrs['data-chat-flow-key']).join(), 'a,b')
})

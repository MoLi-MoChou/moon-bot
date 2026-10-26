// OpenUI specs lowered onto the product's own cards (plan §阶段 6): a generated
// interface coexists with the eight card types, an unknown node degrades to text
// instead of failing, and an interaction is an ordinary options card whose answer
// travels the existing view-reply channel — the front end never approves anything.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { lowerOpenUi } from '../src/shared/openui.ts'
import { checkShownView } from '../src/shared/views.ts'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.ts'

const spec = (elements: Record<string, unknown>, root?: string) => ({ ...(root === undefined ? {} : { root }), elements })

test('a dashboard spec lowers onto the existing cards', () => {
  const lowered = lowerOpenUi(spec({
    root: { type: 'Stack', children: ['title', 'cpu', 'rows'] },
    title: { type: 'Text', props: { text: 'Cluster health' } },
    cpu: { type: 'Metric', props: { label: 'CPU', value: 42, tone: 'warn' } },
    rows: { type: 'Table', props: { columns: [{ key: 'pod', label: 'Pod' }], rows: [{ pod: 'api-1' }] } },
  }, 'root'))
  assert.ok('view' in lowered)
  if (!('view' in lowered)) return
  assert.equal(lowered.view.type, 'stack')
  const children = lowered.view.type === 'stack' ? lowered.view.children : []
  assert.deepEqual(children.map(child => child.type), ['text', 'metric', 'table'])
  assert.deepEqual(children[1], { type: 'metric', label: 'CPU', value: 42, tone: 'warn' })
  // The lowered card passes the same validator as any other blueprint.
  assert.equal(checkShownView('Cluster', lowered.view).interactive, false)
})

test('an interaction lowers to a card whose answer must come back through view-reply', () => {
  const lowered = lowerOpenUi(spec({
    pick: { type: 'Actions', props: { id: 'pick', options: [{ label: 'Retry the deploy', description: 'again' }, { label: 'Hold' }] } },
  }, 'pick'))
  assert.ok('view' in lowered)
  if (!('view' in lowered)) return
  assert.deepEqual(lowered.view, {
    type: 'options',
    id: 'pick',
    options: [{ label: 'Retry the deploy', description: 'again' }, { label: 'Hold' }],
  })
  // Interactive, so it waits — the answer is the user's, never the page's.
  assert.equal(checkShownView('Pick', lowered.view).interactive, true)
})

test('an unknown node degrades to text and never throws', () => {
  const lowered = lowerOpenUi(spec({
    root: { type: 'Stack', children: ['weird', 'note'] },
    weird: { type: 'QuantumChart', props: { text: 'still shows something' } },
    note: { type: 'Text', props: { text: 'and keeps its sibling' } },
  }, 'root'))
  assert.ok('view' in lowered)
  if (!('view' in lowered)) return
  assert.equal(lowered.view.type, 'stack')
  const children = lowered.view.type === 'stack' ? lowered.view.children : []
  assert.equal(children[0]?.type, 'text')
  assert.match(children[0]?.type === 'text' ? children[0].text : '', /still shows something/)
  // Malformed specs answer an error the tool turns into one readable line.
  assert.deepEqual(lowerOpenUi({ elements: {} }), { error: 'An OpenUI spec needs at least one element.' })
  const cycle = lowerOpenUi(spec({ root: { type: 'Stack', children: ['root'] } }, 'root'))
  assert.ok('view' in cycle)
  assert.deepEqual(lowerOpenUi({ root: 'x' }), { error: 'An OpenUI spec needs an `elements` map.' })
})

test('show_view shows a lowered OpenUI card, and a bad spec as a readable line', async (t) => {
  const scene = async (): Promise<{ tool: (name: string, args: Record<string, unknown>) => Promise<unknown>, views: () => Record<string, unknown> }> => {
    const home = mkdtempSync(join(tmpdir(), 'ds-bot-openui-'))
    t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
    writeFileSync(join(home, 'state.json'), JSON.stringify({
      version: 1, mainBotIds: ['a'], bots: { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 } },
      rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
    }))
    const ctx = fakeContext()
    Object.assign(ctx, {
      llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
      workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
      sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, calls: [], inbox: { nextStep: [], nextTurn: [], remove: () => false }, followup() {}, steer() {}, cancel() {} } }), selectModel: async () => {} },
      sessionTitle: { rename: async () => {} },
      sessions: { flush: async () => {} },
    })
    const rt = createRuntime(ctx, { home }) as unknown as { state: Record<string, unknown>, load(): Promise<void> }
    await rt.load()
    return {
      tool: (name, args) => ctx.registeredTools.get(name).execute(args, { agent: { id: 'a' } }) as Promise<unknown>,
      views: () => (rt.state.views ?? {}) as Record<string, unknown>,
    }
  }

  const shown = await scene()
  // A display-only card renders from the call itself; the tool confirms it is shown.
  const answer = await shown.tool('show_view', {
    title: 'Cluster',
    view: spec({ root: { type: 'Text', props: { text: 'All green' } } }, 'root'),
  })
  assert.equal(answer, 'The view is on screen.')

  // An interactive spec is stored as an ordinary card — its answer comes back
  // through view-reply, and the page itself can approve nothing.
  await shown.tool('show_view', {
    title: 'Pick',
    view: spec({ pick: { type: 'Actions', props: { id: 'pick', options: [{ label: 'Retry' }, { label: 'Hold' }] } } }, 'pick'),
  })
  const card = shown.views().a as { title: string, view: { type: string, id?: string } } | undefined
  assert.equal(card?.title, 'Pick')
  assert.deepEqual([card?.view.type, card?.view.id], ['options', 'pick'])

  // A spec that cannot be lowered answers the reason, so the model can fix it.
  const bad = await shown.tool('show_view', { title: 'Broken', view: { elements: {} } })
  assert.equal(bad, 'An OpenUI spec needs at least one element.')
})

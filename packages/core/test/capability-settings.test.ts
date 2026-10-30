// The capabilities page as a component tree: grouping, the search and empty states, the
// detail block, delete confirmation, and a Bot switch that rolls back when the host says no.
// Bundled with esbuild and driven with a small stateful React, the pattern the client tests use.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: `
      export { CapabilitiesPage, BotCapabilitiesCard } from './src/client/capability-settings'
      export { CapabilityRow } from './src/client/capability-row'
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react-dom'],
})

let current = { index: 0, slots: [] as { value?: unknown }[] }
const slot = (make: () => { value?: unknown }) => {
  const index = current.index++
  return (current.slots[index] ??= make())
}
const react = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...(props ?? {}), children: children.flat(Infinity) },
  }),
  Fragment: 'fragment',
  useState: (initial: unknown) => {
    const cell = slot(() => ({ value: typeof initial === 'function' ? (initial as () => unknown)() : initial }))
    return [
      cell.value,
      (next: unknown) => {
        cell.value = typeof next === 'function' ? (next as (value: unknown) => unknown)(cell.value) : next
      },
    ]
  },
  useRef: (initial: unknown) => slot(() => ({ current: initial })),
  useEffect() {},
  useLayoutEffect() {},
  useCallback: (fn: unknown) => fn,
  useMemo: (make: () => unknown) => make(),
}
const module = {
  exports: {} as {
    CapabilitiesPage: (props: Record<string, unknown>) => unknown
    BotCapabilitiesCard: (props: Record<string, unknown>) => unknown
    CapabilityRow: (props: Record<string, unknown>) => unknown
  },
}
runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  URL,
  JSON,
  Date,
  Intl,
  Promise,
  setTimeout,
  clearTimeout,
  require: (name: string) => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: (node: unknown) => node }
    throw new Error(`no platform module ${name}`)
  },
})
const { CapabilitiesPage, BotCapabilitiesCard, CapabilityRow } = module.exports
type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown }; children?: unknown }
const childrenOf = (node: Node): unknown[] => {
  const raw = node.props?.children ?? node.children
  return Array.isArray(raw) ? raw.flat(Infinity) : raw === undefined ? [] : [raw]
}
function find(node: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const candidate = node as Node
  if (predicate(candidate)) return candidate
  for (const child of childrenOf(candidate)) {
    const found = find(child, predicate)
    if (found !== undefined) return found
  }
  return undefined
}
function nodes(node: unknown, predicate: (node: Node) => boolean, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) nodes(child, predicate, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  const candidate = node as Node
  if (predicate(candidate)) out.push(candidate)
  for (const child of childrenOf(candidate)) nodes(child, predicate, out)
  return out
}
function textOf(node: unknown): string {
  if (node === null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(childrenOf(node as Node))
}
const materialize = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(materialize)
  if (node === null || typeof node !== 'object') return node
  const candidate = node as Node
  if (typeof candidate.type === 'function')
    return materialize((candidate.type as (props: Record<string, unknown>) => unknown)(candidate.props))
  const props = { ...candidate.props }
  if ('children' in props) props.children = materialize(props.children)
  return { ...candidate, props }
}
const render = (component: (props: Record<string, unknown>) => unknown, props: Record<string, unknown>) => {
  current = { index: 0, slots: current.slots }
  return materialize(component(props))
}
const reset = () => {
  current = { index: 0, slots: [] }
}
const rerender = (component: (props: Record<string, unknown>) => unknown, props: Record<string, unknown>) =>
  render(component, props)
const tick = async (times = 4) => {
  for (let index = 0; index < times; index += 1) await new Promise(resolve => setImmediate(resolve))
}

const postgres = {
  name: 'postgres',
  kind: 'mcp',
  description: 'Inspect schemas',
  transport: 'stdio',
  command: 'npx',
  args: ['server-postgres', '$MOON_BOT_SECRET_POSTGRES_URL'],
  env: {},
  headers: {},
  approved: true,
  items: [],
}
const guide = {
  name: 'guide',
  kind: 'skill',
  description: 'How we write',
  content: 'Do it.',
  approved: true,
  items: [],
}
const team = { name: 'team', kind: 'pack', description: 'Team pack', items: ['postgres', 'guide'], approved: true }
const bots = [
  { id: 'chief', name: 'Chief', capabilities: ['postgres', 'team'] },
  { id: 'writer', name: 'Writer', capabilities: [] },
]
const actions = () => ({
  saveCapability: async () => true,
  deleteCapability: async () => true,
  approveCapability: async () => true,
  setBotCapability: async () => true,
  retryCapability: async () => true,
  openSettings: () => {},
})

test('the empty library says what to do next and both actions navigate', () => {
  reset()
  const opened: string[] = []
  const props = {
    roster: { capabilities: [], bots: [], secrets: [] },
    actions: { ...actions(), openSettings: (page: string) => opened.push(page) },
    run: async () => true,
  }
  const tree = render(CapabilitiesPage, props)
  assert.match(textOf(tree), /No capabilities yet/)
  assert.match(textOf(tree), /Install one from the connector market/)
  const buttons = nodes(tree, node => node.type === 'button')
  const browse = buttons.find(node => textOf(node) === 'Browse connector market')
  const add = buttons.find(node => textOf(node) === 'Add capability')
  assert.ok(browse, 'the empty state offers the market')
  assert.ok(add, 'the empty state offers the add form')
  ;(browse?.props.onClick as () => void)()
  assert.deepEqual(opened, ['connectors'])
})

test('the library groups by type, shows key readiness and the live state per Bot', () => {
  reset()
  let tree = render(CapabilitiesPage, {
    roster: {
      capabilities: [postgres, guide, team],
      bots,
      secrets: [],
      capabilityStatuses: { chief: { postgres: { state: 'ready' } }, writer: {} },
      capabilityTools: { postgres: ['mcp__postgres__query'] },
    },
    actions: actions(),
    run: async () => true,
  })
  assert.match(textOf(tree), /MCP servers/)
  assert.match(textOf(tree), /Skills/)
  assert.match(textOf(tree), /Packs/)
  assert.match(textOf(tree), /Missing POSTGRES_URL/)
  assert.match(textOf(tree), /Ready for Chief/)
  const guideSummary = nodes(tree, node => node.props.className === 'bt-cap-summary').find(node =>
    textOf(node).includes('guide'),
  )
  assert.ok(guideSummary)
  ;(guideSummary?.props.onClick as () => void)()
  tree = rerender(CapabilitiesPage, {
    roster: {
      capabilities: [postgres, guide, team],
      bots,
      secrets: [],
      capabilityStatuses: { chief: { postgres: { state: 'ready' } }, writer: {} },
      capabilityTools: { postgres: ['mcp__postgres__query'] },
    },
    actions: actions(),
    run: async () => true,
  })
  assert.match(textOf(tree), /Instructions for the Bot/)
  assert.ok(find(tree, node => node.props.className === 'bt-market-search'))
})

test('search narrows the rows and a miss clears the filters', () => {
  reset()
  const props = {
    roster: { capabilities: [postgres, guide, team], bots, secrets: [] },
    actions: actions(),
    run: async () => true,
  }
  let tree = render(CapabilitiesPage, props)
  const input = find(tree, node => node.props.className === 'bt-market-search-input')
  assert.ok(input)
  ;(input?.props.onChange as (event: unknown) => void)({ target: { value: 'schemas' } })
  tree = rerender(CapabilitiesPage, props)
  assert.match(textOf(tree), /Showing 1 of 3/)
  ;(find(tree, node => node.props.className === 'bt-market-search-input')?.props.onChange as (event: unknown) => void)({
    target: { value: 'nothing-matches' },
  })
  tree = rerender(CapabilitiesPage, props)
  assert.match(textOf(tree), /No capabilities match/)
  const clear = nodes(tree, node => node.type === 'button').find(node => textOf(node) === 'Clear filters')
  assert.ok(clear)
  ;(clear?.props.onClick as () => void)()
  tree = rerender(CapabilitiesPage, props)
  assert.match(textOf(tree), /MCP servers/)
})

test('a row opens into description, tools and usage, and delete asks first with its consequences', () => {
  reset()
  const deleted: string[] = []
  const props = {
    roster: {
      capabilities: [postgres],
      bots,
      secrets: [{ name: 'POSTGRES_URL' }],
      capabilityStatuses: { chief: { postgres: { state: 'error', error: 'ECONNREFUSED' } } },
      capabilityTools: { postgres: ['mcp__postgres__query', 'mcp__postgres__list'] },
    },
    actions: {
      ...actions(),
      deleteCapability: async (name: string) => {
        deleted.push(name)
        return true
      },
    },
    run: async () => true,
  }
  let tree = render(CapabilitiesPage, props)
  const summary = find(tree, node => node.props.className === 'bt-cap-summary')
  assert.ok(summary)
  ;(summary?.props.onClick as () => void)()
  tree = rerender(CapabilitiesPage, props)
  assert.match(textOf(tree), /mcp__postgres__query/)
  assert.match(textOf(tree), /Used by/)
  assert.match(textOf(tree), /Chief/)
  assert.match(textOf(tree), /Could not connect: ECONNREFUSED/)
  const firstDelete = nodes(tree, node => node.type === 'button').find(node => textOf(node) === 'Delete')
  assert.ok(firstDelete)
  ;(firstDelete?.props.onClick as () => void)()
  tree = rerender(CapabilitiesPage, props)
  assert.match(textOf(tree), /Delete postgres\? Bots using it lose its tools/)
  assert.match(textOf(tree), /saved keys stay/)
  assert.deepEqual(deleted, [], 'the first click only asks')
  const confirm = nodes(tree, node => node.type === 'button').find(node => textOf(node) === 'Delete')
  ;(confirm?.props.onClick as () => void)()
  assert.deepEqual(deleted, ['postgres'])
})

test('approving a local command is optimistic and rolls back when the host refuses', async () => {
  reset()
  const local = { ...postgres, approved: false }
  let tree = render(CapabilityRow, {
    item: local,
    health: { state: 'needs-approval', using: bots.slice(0, 1) },
    keys: { total: 0, missing: [] },
    tools: [],
    expanded: true,
    confirming: false,
    busy: false,
    onExpand() {},
    onEdit() {},
    onDelete() {},
    onCancelDelete() {},
    onApprove() {},
    onRetry() {},
    onOpenSecrets() {},
    onOpenBots() {},
  })
  assert.match(textOf(tree), /waits for your approval/)
  assert.ok(nodes(tree, node => node.type === 'button').some(node => textOf(node) === 'Allow'))
})

test('a Bot switch flips at once, shows it is saving, and rolls back on failure', async () => {
  reset()
  let finish: (ok: boolean) => void = () => {}
  const run = () =>
    new Promise<boolean>(resolve => {
      finish = resolve
    })
  const switched: { name: string; on: boolean }[] = []
  const SwitchRow = (props: Record<string, unknown>) => ({
    type: 'button',
    props: { ...props, onClick: () => props.onChange(!props.on) },
  })
  const Card = (props: Record<string, unknown>) => ({ type: 'div', props: { children: props.children } })
  const props = {
    bot: { id: 'chief', capabilities: [] as string[] },
    roster: { capabilities: [postgres], bots, capabilityStatuses: {} },
    actions: {
      ...actions(),
      setBotCapability: async (_bot: string, name: string, on: boolean) => {
        switched.push({ name, on })
        return true
      },
    },
    run,
    Card: Card as unknown as React.ComponentType<Record<string, unknown>>,
    SwitchRow: SwitchRow as unknown as React.ComponentType<Record<string, unknown>>,
  }
  let tree = render(BotCapabilitiesCard, props)
  let row = find(tree, node => node.props.label === 'postgres')
  assert.ok(row)
  assert.equal(row?.props.on, false)
  ;(row?.props.onChange as (on: boolean) => void)(true)
  tree = rerender(BotCapabilitiesCard, props)
  row = find(tree, node => node.props.label === 'postgres')
  assert.equal(row?.props.on, true, 'the switch flips before the host answers')
  assert.equal(row?.props.hint, 'Saving…')
  finish(false)
  await tick()
  tree = rerender(BotCapabilitiesCard, props)
  row = find(tree, node => node.props.label === 'postgres')
  assert.equal(row?.props.on, false, 'a refused change rolls back')
  assert.equal(row?.props.hint, 'Off')
  assert.deepEqual(switched, [{ name: 'postgres', on: true }])
})

test('a narrow viewport renders the same page without a crash', () => {
  reset()
  const tree = render(CapabilitiesPage, {
    roster: {
      capabilities: [postgres, guide, team],
      bots,
      secrets: [],
      capabilityTools: { postgres: ['mcp__postgres__query'] },
    },
    actions: actions(),
    run: async () => true,
  })
  assert.ok(find(tree, node => node.props.className === 'bt-cap-head'))
  assert.equal(nodes(tree, node => node.props.className === 'bt-cap-row').length, 3)
})

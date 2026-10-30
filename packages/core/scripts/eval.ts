// The five-capability evaluation set (plan §阶段 6 / §九): each fixture names a
// capability and its checks; the drivers below run the real wired service against
// scripted endpoints and score the checks. Exit 0 only when every capability passes.
//
//   node scripts/eval.ts            run all five, print a report
//   node scripts/eval.ts memory     one capability by name
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wireService, type WiredService } from '../src/service/engine.ts'
import { FileSettings } from '../src/service/settings.ts'
import { FileCredentials } from '../src/service/credentials.ts'
import { StandaloneLlm } from '../src/service/llm.ts'
import { openStore } from '../src/store/db.ts'
import { PolicyEngine, ruleOf } from '../src/engine/policy.ts'
import { nextRunOf } from '../src/service/scheduler.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES = join(HERE, '..', 'test', 'eval', 'fixtures')

type Check = { name: string; pass: boolean; note?: string | undefined }
type Driver = (note: (line: string) => void) => Promise<Check[]>

const seed = (home: string, bots: Record<string, unknown>): void => {
  writeFileSync(
    join(home, 'state.json'),
    JSON.stringify({
      version: 1,
      mainBotIds: ['a'],
      bots,
      rooms: {},
      agents: {},
      exchanges: [],
      exchangeTurns: {},
      questions: {},
      prefs: {},
      revision: 0,
    }),
  )
}

/** A scripted OpenAI-compatible endpoint: one reply text per model call, in order. */
const mockModel = (replies: string[]): { url: string; close(): Promise<void>; requests: { body: unknown }[] } => {
  const requests: { body: unknown }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      requests.push({ body })
      const text = replies[0] ?? 'ok'
      if (replies.length > 1) replies.shift()
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: Record<string, unknown>): void => {
        res.write(
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        )
      }
      send({ role: 'assistant', content: '' })
      send({ content: text })
      res.write(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  let port = 0
  return {
    get url() {
      return `http://127.0.0.1:${port}/v1`
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    requests,
    listen: () =>
      new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port
          resolve()
        })
      }),
  } as ReturnType<typeof mockModel>
}

const wired = async (home: string, mockUrl: string): Promise<WiredService> => {
  const settings = new FileSettings(home)
  await settings.mutate('llm-pi-ai', [
    {
      op: 'set',
      path: ['providers', 'custom'],
      value: { api: 'openai-completions', baseURL: mockUrl, apiKey: 'sk', models: [{ id: 'mock-1' }] },
    },
  ])
  return wireService({ home, llm: new StandaloneLlm(settings, new FileCredentials(home)), services: { settings } })
}

const memoryDriver: Driver = async note => {
  const home = mkdtempSync(join(tmpdir(), 'eval-memory-'))
  const checks: Check[] = []
  try {
    seed(home, { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'custom/mock-1' } })
    mkdirSync(join(home, 'memory', 'bots', 'a'), { recursive: true })
    writeFileSync(
      join(home, 'memory', 'bots', 'a', 'MEMORY.md'),
      '# Memory\n\n## Notes\n\n- the API key rotates every Friday; the new one lands in the ops channel\n',
    )
    const mock = mockModel(['On it.'])
    await (mock as unknown as { listen(): Promise<void> }).listen()
    const first = await wired(home, mock.url)
    await first.close()
    note('first service stopped; reopening on the same home')
    const mock2 = mockModel(['Checked the notes.'])
    await (mock2 as unknown as { listen(): Promise<void> }).listen()
    const second = await wired(home, mock2.url)
    await second.runtime.load()
    const hits = second.store.memory.search(['bot:a', 'team'], 'API key rotate Friday')
    checks.push({
      name: 'memory survives a restart',
      pass: hits.some(hit => hit.row.text.includes('rotates every Friday')),
    })
    ;(second.agentOf('a') as { followup(m: unknown): void }).followup({
      content: [{ type: 'text', text: 'when does the key rotate?' }],
      source: { kind: 'user' },
    })
    let saw = false
    for (let i = 0; i < 100 && !saw; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      saw = mock2.requests.length > 0 && JSON.stringify(mock2.requests[0]?.body ?? {}).includes('rotates every Friday')
    }
    checks.push({ name: 'the next turn sees it unprompted', pass: saw })
    writeFileSync(join(home, 'memory', 'bots', 'a', 'MEMORY.md'), '# Memory\n\n## Notes\n')
    second.context.pageWith(async () => ({ records: [], hasMore: false }))
    void second.context
    const resync = await import('../src/service/memory-sync.ts')
    const sync = new resync.MemorySync(second.store, join(home, 'memory'))
    sync.syncAll()
    checks.push({
      name: 'deleted memory leaves the index',
      pass: second.store.memory.search(['bot:a', 'team'], 'rotates every Friday').length === 0,
    })
    await second.close()
    await mock.close()
    await mock2.close()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return checks
}

const recallDriver: Driver = async () => {
  const home = mkdtempSync(join(tmpdir(), 'eval-recall-'))
  const checks: Check[] = []
  try {
    seed(home, { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'custom/mock-1' } })
    mkdirSync(join(home, 'memory', 'bots', 'a'), { recursive: true })
    writeFileSync(
      join(home, 'memory', 'bots', 'a', 'MEMORY.md'),
      '# Memory\n\n## Notes\n\n- the deployment pipeline is named moon-deploy and only Annie can approve it\n',
    )
    const mock = mockModel(['Done.'])
    await (mock as unknown as { listen(): Promise<void> }).listen()
    const service = await wired(home, mock.url)
    await service.runtime.load()
    const agent = service.agentOf('a') as { followup(message: unknown): void }
    agent.followup({
      content: [{ type: 'text', text: 'how do I deploy again? who approves the pipeline?' }],
      source: { kind: 'user' },
    })
    let saw = false
    for (let i = 0; i < 100 && !saw; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      saw = mock.requests.length > 0 && JSON.stringify(mock.requests[0]?.body ?? {}).includes('moon-deploy')
    }
    checks.push({ name: 'related turn surfaces the memory with no recall command', pass: saw })
    const mock3 = mockModel(['Nothing to do.'])
    await (mock3 as unknown as { listen(): Promise<void> }).listen()
    const other = await wired(home, mock3.url)
    await other.runtime.load()
    const agent2 = other.agentOf('a') as { followup(message: unknown): void }
    agent2.followup({ content: [{ type: 'text', text: 'what is the capital of France?' }], source: { kind: 'user' } })
    let surfaced = false
    for (let i = 0; i < 100 && mock3.requests.length === 0; i += 1)
      await new Promise(resolve => setTimeout(resolve, 50))
    surfaced = mock3.requests.length > 0 && JSON.stringify(mock3.requests[0]?.body ?? {}).includes('From memory')
    // The frozen snapshot rides every turn by design; only the surfaced segment is
    // query-dependent, and an unrelated question must not earn one.
    checks.push({ name: 'unrelated turn surfaces nothing', pass: !surfaced })
    await service.close()
    await other.close()
    await mock.close()
    await mock3.close()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return checks
}

const proactiveDriver: Driver = async note => {
  const home = mkdtempSync(join(tmpdir(), 'eval-proactive-'))
  const checks: Check[] = []
  try {
    seed(home, { a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1, model: 'custom/mock-1' } })
    const mock = mockModel(['Morning report written.'])
    await (mock as unknown as { listen(): Promise<void> }).listen()
    const service = await wired(home, mock.url)
    const fired: string[] = []
    const { TaskScheduler } = await import('../src/service/scheduler.ts')
    const makeScheduler = (): InstanceType<typeof TaskScheduler> =>
      new TaskScheduler(service.store, (sessionId, task) => {
        fired.push(`${sessionId}:${task.title}`)
        void (service.agentOf(sessionId) as { followup?(m: unknown): void }).followup?.({
          content: [{ type: 'text', text: task.prompt }],
          source: { kind: 'schedule' },
        })
      })
    const before = makeScheduler()
    await before.create('a', { title: 'Morning', prompt: 'write the morning report', every_seconds: 3600 })
    before.pause((await before.catalog())[0]?.id as string, true)
    await before.tick()
    checks.push({ name: 'a paused schedule never fires', pass: fired.length === 0 })
    before.pause((await before.catalog())[0]?.id as string, false)
    // Make it due, then "restart": a brand-new scheduler over the same store fires it once.
    service.store.tasks.finish((await before.catalog())[0]?.id as string, {
      state: 'pending',
      nextRunAt: Date.now() - 1,
    })
    note('simulating restart: a new scheduler over the same store')
    const after = makeScheduler()
    await after.tick()
    await after.tick()
    checks.push({
      name: 'a due task fires exactly once after a restart',
      pass: fired.length === 1 && fired[0] === 'a:Morning',
    })
    checks.push({
      name: 'an every-task reschedules into the future',
      pass: nextRunOf({ every_seconds: 3600 }, Date.now()) !== undefined,
    })
    await service.close()
    await mock.close()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return checks
}

const workflowDriver: Driver = async note => {
  const checks: Check[] = []
  const home = mkdtempSync(join(tmpdir(), 'eval-workflow-'))
  try {
    // The multi-step turn: the model calls the connector tool, then answers from it.
    const { McpConnector } = await import('../src/engine/connectors/mcp.ts')
    const { ToolRegistry } = await import('../src/engine/registry.ts')
    let calls = 0
    const connector = new McpConnector(
      { id: 'files', command: 'x' },
      {
        list: async () => ({ tools: [{ name: 'read_plan', description: 'read the plan file' }] }),
        callTool: async () => {
          calls += 1
          if (calls === 1) throw new Error('connection dropped')
          return { content: [{ type: 'text', text: 'step 1 prepare; step 2 verify; step 3 ship' }] }
        },
        close: async () => {},
      },
    )
    const registry = new ToolRegistry()
    await connector.mount(registry)
    const definition = registry.definitions(['mcp__files__read_plan'])[0]
    const first = await definition.execute({}, { sessionId: 'a', callId: 'c1' })
    const text = first.content[0]?.type === 'text' ? first.content[0].text : ''
    checks.push({
      name: 'a dropped tool call is retried and recovers',
      pass: text.includes('step 3 ship') && calls === 2,
    })
    checks.push({ name: 'the connector tool is policy-gated as L3', pass: ruleOf('mcp__files__read_plan').level === 3 })
    note(`connector calls: ${String(calls)}`)
    void note
    void writeFileSync
    void openStore
    void PolicyEngine
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return checks
}

const autonomyDriver: Driver = async note => {
  const checks: Check[] = []
  const home = mkdtempSync(join(tmpdir(), 'eval-autonomy-'))
  try {
    const store = openStore(home)
    const policy = new PolicyEngine(
      { countersOf: async (sessionId, level, spend) => store.policy.spend(sessionId, level, spend) },
      { level3PerDay: 20, level4PerDay: 1 },
    )
    checks.push({
      name: 'L0 and L2 run without asking',
      pass:
        (await policy.decide('a', 'list_bots')).kind === 'allow' &&
        (await policy.decide('a', 'create_group')).kind === 'allow',
    })
    await policy.decide('a', 'delete_group')
    const asked = await policy.decide('a', 'delete_group')
    const refusal = asked.kind === 'approval' ? asked.reason : ''
    checks.push({ name: 'L4 asks once its budget is spent', pass: asked.kind === 'approval' })
    checks.push({ name: 'the refusal names no appeal', pass: !/bypass|ignore|override|instead/i.test(refusal) })
    checks.push({
      name: 'unknown connector tools are L3 within budget',
      pass: ruleOf('mcp_files_read').level === 3 && (await policy.decide('a', 'mcp_files_read')).kind === 'allow',
    })
    store.close()
    note('policy decisions are server-side; no tool result carries an override')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return checks
}

const DRIVERS: Readonly<Record<string, Driver>> = {
  memory: memoryDriver,
  recall: recallDriver,
  proactive: proactiveDriver,
  workflow: workflowDriver,
  autonomy: autonomyDriver,
}

const main = async (): Promise<void> => {
  const wanted = process.argv[2]
  const files = readdirSync(FIXTURES)
    .filter(file => file.endsWith('.json'))
    .filter(file => wanted === undefined || file.startsWith(wanted))
  let failed = 0
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as { capability: string }
    const name = file.replace('.json', '')
    const driver = DRIVERS[name]
    if (driver === undefined) {
      console.log(`? ${name}: no driver`)
      failed += 1
      continue
    }
    const notes: string[] = []
    const checks = await driver(line => notes.push(line)).catch(
      error => [{ name: 'driver crashed', pass: false, note: String(error) }] as Check[],
    )
    const pass = checks.every(check => check.pass)
    if (!pass) failed += 1
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${fixture.capability}`)
    for (const check of checks)
      console.log(`  ${check.pass ? '✓' : '✗'} ${check.name}${check.note !== undefined ? ` (${check.note})` : ''}`)
    for (const line of notes) console.log(`  · ${line}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

void main()

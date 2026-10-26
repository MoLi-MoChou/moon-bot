// The standalone host context (plan §阶段 3): the surface the host modules install on,
// without DSH. It is the production sibling of the test fakeContext — routes are
// captured for the service to serve, listeners fan out for real, effects are disposed
// on close — while services the standalone product does not ship yet stay absent, which
// the host modules already tolerate (the whole suite runs on less than this).
import type { Disposer } from '../host/dsh-types.js'

/** A history page request, as the host's pagers ask it. */
export interface PageRequest {
  readonly address: { readonly kind: string, readonly sessionId: string }
  readonly throughSeq?: number | undefined
  readonly beforeSeq?: number | undefined
  readonly maxMessages?: number | undefined
}

/** A history page answer: session events with their sequence numbers. */
export interface PageAnswer {
  readonly records: readonly { readonly seq: number, readonly event: { readonly type: string, readonly time?: number, readonly data?: unknown } }[]
  readonly hasMore: boolean
}

/**
 * The standalone host context: the surface the host modules install on, shaped like the
 * test fakeContext (a plain object cast at the composition site) rather than the full
 * DSH context type, which names services the standalone product does not ship.
 */

/** One registered fetch route, as the host modules register them. */
export interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  fetch(request: Request): Promise<Response>
}

export interface ServiceContextOptions {
  /** Service implementations by name, for the ctx.get surface (attachments, approval…). */
  readonly services?: Readonly<Record<string, unknown>> | undefined
  /** The LLM service the host modules read (providers, models); absent, a stub answers. */
  readonly llm?: unknown | undefined
  /** The engine-backed agents, for sessionController.resolveAgent. */
  readonly resolveAgent?: (sessionId: string) => Promise<unknown> | unknown
}

interface Listener {
  readonly name: string
  readonly run: (payload: unknown, second: unknown) => unknown
}

/** The LLM surface the host modules call; the real one comes from the wiring. */
export interface LlmServiceLike {
  listProviders(): readonly unknown[]
  listModels(provider: string): Promise<readonly unknown[]>
  resolveModelInfo(provider: string, model: string): Promise<Record<string, unknown>>
  listConfigurableProviders?(): readonly unknown[]
  [key: string]: unknown
}

export class ServiceContext {
  readonly logger = { info: () => {}, warn: () => {}, error: () => {} }
  private readonly listeners = new Map<string, Listener[]>()
  private readonly routes = new Map<string, FetchRoute>()
  private readonly disposers: (() => void)[] = []
  private readonly registeredTools = new Map<string, unknown>()
  private readonly sections = new Map<string, unknown>()
  private readonly services: Readonly<Record<string, unknown>>
  private agentOf: ServiceContextOptions['resolveAgent']
  private pageImpl: ((input: PageRequest) => Promise<PageAnswer>) | undefined

  constructor(options: ServiceContextOptions = {}) {
    this.services = options.services ?? {}
    this.agentOf = options.resolveAgent
    this.llm = (options.llm as LlmServiceLike | undefined) ?? {
      listProviders: (): readonly unknown[] => [],
      listModels: async (): Promise<readonly unknown[]> => [],
      resolveModelInfo: async (): Promise<Record<string, unknown>> => ({}),
    }
  }

  // Bound arrow properties: host modules extract these (const on = ctx.on), so they
  // must not lose their receiver the way a class method would.
  /** Registers one more named service, for what the wiring builds after construction. */
  provide(name: string, service: unknown): void {
    ;(this.services as Record<string, unknown>)[name] = service
  }

  get = <T>(name: string): T | undefined => this.services[name] as T | undefined

  on = (name: string, listener: (payload: unknown, second: unknown) => unknown, options?: { readonly prepend?: boolean }): Disposer => {
    const entry = { name, run: listener }
    const list = this.listeners.get(name) ?? []
    this.listeners.set(name, options?.prepend === true ? [entry, ...list] : [...list, entry])
    return () => { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== entry)) }
  }

  /** Fans an event out in registration order; middleware (with `next`) is not used here. */
  emit = (name: string, payload: unknown, second?: unknown): void => {
    for (const listener of this.listeners.get(name) ?? []) void listener.run(payload, second)
  }

  effect = (execute: () => void | Disposer, label?: string): void => {
    const dispose = execute()
    if (typeof dispose === 'function') this.disposers.push(dispose)
    void label
  }

  /**
   * DSH's late service injection. The standalone service has no sub-plugins: a named
   * service that exists is handed over at once, one that does not never arrives — the
   * calling module keeps its absent-service behavior (goals stay unblocked, and so on).
   */
  inject(names: readonly string[], inject: (scope: unknown) => void): void {
    const first = names[0]
    if (first === undefined) return
    const service = this.services[first]
    if (service !== undefined) inject({ [first]: service, effect: (execute: () => (() => void) | void) => { const dispose = execute(); if (typeof dispose === 'function') this.disposers.push(dispose) } })
  }

  readonly connection = {
    fetch: {
      register: (route: FetchRoute): (() => void) => {
        this.routes.set(route.path, route)
        return () => { this.routes.delete(route.path) }
      },
    },
  }

  readonly tools = {
    register: (tool: unknown): (() => void) => {
      const name = (tool as { name?: string }).name ?? ''
      this.registeredTools.set(name, tool)
      return () => { this.registeredTools.delete(name) }
    },
    guard: (): (() => void) => () => {},
    schemas: (): readonly unknown[] => [],
  }

  readonly systemPrompt = {
    section: (section: unknown): (() => void) => {
      const name = (section as { name?: string }).name ?? ''
      this.sections.set(name, section)
      return () => { this.sections.delete(name) }
    },
  }

  readonly llm: LlmServiceLike

  /** The engine-backed agent resolver, installed by the wiring once it exists. */
  resolveAgentWith(resolver: (sessionId: string) => unknown): void {
    this.agentOf = resolver
  }

  /** A store-backed history page, installed by the wiring (empty until then). */
  pageWith(page: (input: PageRequest) => Promise<PageAnswer>): void {
    this.pageImpl = page
  }

  readonly sessionController = {
    create: async (): Promise<{ sessionId: string }> => ({ sessionId: `s${Math.random().toString(36).slice(2, 10)}` }),
    resolveAgent: async (sessionId: string): Promise<{ agent: unknown }> => {
      if (this.agentOf === undefined) throw Object.assign(new Error('Session unavailable'), { code: 'bot/unavailable' })
      const agent = await this.agentOf(sessionId)
      return { agent }
    },
    selectModel: async (): Promise<void> => {},
    page: async (input: PageRequest): Promise<PageAnswer> => {
      if (this.pageImpl === undefined) return { records: [], hasMore: false }
      return this.pageImpl(input)
    },
    // A user message into a session: DSH queued it in the inbox; the standalone engine
    // takes it as the turn's trigger, with the user source the route expects.
    prompt: async (input: { readonly sessionId: string, readonly content: readonly unknown[], readonly mode?: string }, signal?: AbortSignal): Promise<void> => {
      if (this.agentOf === undefined) throw Object.assign(new Error('Session unavailable'), { code: 'bot/unavailable' })
      const agent = await this.agentOf(input.sessionId) as { followup?(message: unknown): void, steer?(message: unknown): void }
      const message = { content: input.content, source: { kind: 'user' } }
      if (input.mode === 'steer') agent.steer?.(message)
      else agent.followup?.(message)
      void signal
    },
  }

  readonly sessionTitle = { rename: async (): Promise<void> => {} }
  readonly sessions = { flush: async (): Promise<void> => {} }
  readonly workspaceRegistry = {
    get: (): undefined => undefined,
    resolveByPath: async (): Promise<undefined> => undefined,
    create: async (path: string): Promise<{ id: string, path: string }> => ({ id: path, path }),
    archiveSession: async (): Promise<void> => {},
  }

  /** The registered prompt sections, in registration order. */
  sectionsInOrder(): readonly unknown[] {
    return [...this.sections.values()]
  }

  /** The captured fetch routes, keyed by path, for the service to serve. */
  routeOf(path: string): FetchRoute | undefined {
    return this.routes.get(path)
  }

  /** Runs every disposer, in reverse registration order. */
  async dispose(): Promise<void> {
    for (const dispose of this.disposers.splice(0).reverse()) {
      try { dispose() } catch { /* a failing cleanup does not stop the others */ }
    }
  }
}

import { createUserMessage } from './llm-bits.ts'
import type { LlmUserMessage } from './dsh-types.js'
import type { Agent } from './dsh-types.js'
import type { HostRuntime } from './runtime.js'

const SOURCE = 'ds-bot-time-context'
const isClock = (source: { readonly kind?: unknown } | undefined): boolean => source?.kind === SOURCE || source?.kind === 'time-context'

/** The decision a pre-step listener may rewrite. */
interface PreStepDecision {
  readonly kind: string
  readonly messages: readonly LlmUserMessage[]
}

interface PreStepPayload {
  readonly agent: Agent
  readonly signal: AbortSignal
}

/** DSH's projection state for a Session, by projection key. */
interface SessionProjectionsService {
  stateOf(session: unknown, key: string): unknown
}

export function install(rt: HostRuntime): void {
  const { ctx, config } = rt
  const interval = config.timeRefreshIntervalMs ?? 600_000
  if (!Number.isSafeInteger(interval) || interval < 0) throw new TypeError('timeRefreshIntervalMs must be a non-negative safe integer')
  const formatter = new Intl.DateTimeFormat('en-CA', {
    ...(config.timeZone ? { timeZone: config.timeZone } : {}),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
  const zone = formatter.resolvedOptions().timeZone

  ctx.on<PreStepPayload, () => Promise<PreStepDecision>>('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    await rt.load()
    if (!rt.isBotSession(agent.id) || signal.aborted) return decision
    // A loaded DSH clock covers every step itself. Its listener may run before or
    // after this one (a reload reorders them), so its presence is read from its
    // projection, not from the messages added so far.
    if (ctx.get<SessionProjectionsService>('sessionProjections')?.stateOf(agent.session, 'timeContext') !== undefined) return decision
    if (decision.messages.some(message => isClock(message.source))) return decision
    const now = Date.now()
    for await (const event of rt.eventsBackwards(agent.id, signal, Infinity)) {
      const at = event.time
      if (event.type === 'user/message' && isClock(event.data?.source)) {
        if (typeof at === 'number' && now >= at && now - at < interval) return decision
        break
      }
      if (typeof at === 'number' && at <= now - interval) break
    }
    if (signal.aborted) return decision
    const text = `Current time: ${formatter.format(now)} (${zone}).`
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: SOURCE, form: 'snapshot', sections: [{ name: SOURCE, text }] },
      })],
    }
  }, { prepend: true })
}

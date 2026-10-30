// The Bot tool surface: the registration order every module's tools go out in, the tools
// a Bot Session hides from itself, and the goal refusal. The tools themselves live in
// `tools/` by area.
import type { Agent, Disposer, ToolExecution } from './host-types.js'
import type { HostRuntime } from './runtime.ts'
import { ToolRegistry, type ToolEntry } from '../engine/registry.ts'
import { registerCollectedTool } from './tools/collector.ts'
import { LEAN_HIDDEN_TOOLS } from 'moon-bot-contracts'
import {
  BLOCKING_QUESTION_TOOL, GOAL_REFUSAL, HIDDEN_TOOLS, createShared,
  type ToolShared,
} from './tools/shared.ts'
import { installTeamTools } from './tools/team-tools.ts'
import { installBotTools } from './tools/bot-tools.ts'
import { installChatTools } from './tools/chat-tools.ts'
import { installCapabilityTools } from './tools/capability-tools.ts'
import { installWebSearchTool } from './tools/web-search-tool.ts'

export { GROUP_REF, output } from './tools/shared.ts'

/** The goal service, as far as blocking a goal in a Bot Session needs it. */
interface Goal {
  readonly id: string
  readonly revision: number
  readonly phase?: string
}

interface GoalService {
  get(agent: Agent): Goal | undefined
  block(agent: Agent, ref: { readonly id: string; readonly revision: number }, reason: { readonly code: string; readonly message: string }): void
}

/** A context that carries the goal service: the host injects it, or the runtime keeps its own. */
interface GoalHost {
  readonly goals: GoalService
  effect(execute: () => void | Disposer, label?: string): void
}

/** `session/event` for a goal change: the part of the payload the refusal reads. */
interface GoalEvent {
  readonly type: string
  readonly data?: { readonly goal?: { readonly phase?: string } }
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt
  // The Zod registry: every tool registers here, and the same entry goes to the context's
  // collector (tools/collector.ts), so both paths run the same code.
  const registry = new ToolRegistry()
  const shared: ToolShared = createShared(rt, registry)
  // Host modules outside tools/ register the same way: the Zod registry entry and the
  // collector's copy, from one executor. (tools/ modules use shared.register, which also
  // reaches the shared helpers.)
  const registerTool = (entry: ToolEntry): void => {
    registry.register(entry)
    registerCollectedTool(ctx, entry, rt)
  }
  Object.assign(rt, { toolRegistry: registry, registerTool })

  const hiddenTools = new WeakSet<Agent>()
  const hideBotUnusedTools = (agent: Agent | undefined): void => {
    if (agent === undefined || hiddenTools.has(agent)) return
    const sessionId = agent.session?.id
    if (sessionId === undefined || !rt.isBotSession(sessionId)) return
    const owner = agent.ctx?.tools
    if (owner === undefined || typeof owner.restrict !== 'function') return
    try {
      // restrict() throws on a name this profile does not serve.
      const served = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
      const deny = HIDDEN_TOOLS.filter(name => served.has(name))
      if (deny.length === 0) return
      owner.restrict({ deny })
      hiddenTools.add(agent)
    } catch (error) {
      rt.warn('moon-bot: %s stay in the tool list of %s: %s', HIDDEN_TOOLS.join(', '), agent.session?.id, error)
    }
  }

  installTeamTools(rt, shared)
  installBotTools(rt, shared)
  installChatTools(rt, shared)
  installWebSearchTool(rt, shared)

  // the host's own question tool holds the turn open until the user answers, and every
  // message from another Bot or a group round queues behind it. Bot Sessions ask
  // through ask_user instead, so the tool is taken out of their tool list, as are the
  // goal tools.
  const botSession = (exec: ToolExecution): boolean => {
    const id = exec.agent?.id
    return id !== undefined && rt.isBotSession(id)
  }
  // A new Bot, part, or group Session gets its Agent before the host records it, so the
  // list is only trimmed once the host resolves that Agent again; meanwhile the guard
  // refuses the question tool in any Bot Session, and a goal made there is blocked.
  ctx.tools.guard((exec: ToolExecution) => (exec.name === BLOCKING_QUESTION_TOOL && botSession(exec)
    ? `Bots cannot use ${BLOCKING_QUESTION_TOOL}. Ask with ask_user in your own chat, or ask in your reply.`
    : undefined))
  // Moon Bot patch: until the list is trimmed, the hidden features' tools refuse too.
  ctx.tools.guard((exec: ToolExecution) => (LEAN_HIDDEN_TOOLS.includes(exec.name ?? '') && botSession(exec)
    ? 'This app does not offer group chats or scheduled tasks. Do the work in this chat instead.'
    : undefined))
  // Creation waits for this listener, so the Agent's first step already lacks the tool.
  ctx.on<{ readonly agent: Agent }>('agent/created', async ({ agent }) => {
    try {
      await rt.load()
      hideBotUnusedTools(agent)
    } catch (error) {
      rt.warn('moon-bot: hiding %s on agent/created failed: %s', HIDDEN_TOOLS.join(', '), error)
    }
  })

  // The /goal command stays open in every Session, so a goal started in a Bot chat or a
  // group is blocked at once; the round driver then starts no round for it.
  let goals: GoalService | null = null
  const attachGoals = (sub: GoalHost): void => {
    const own = sub.goals
    goals = own
    sub.effect(() => () => { if (goals === own) goals = null }, 'moon-bot: goal service')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['goals'], sub => attachGoals(sub as unknown as GoalHost))
  else {
    const service = ctx.get<GoalService>('goals')
    if (service !== undefined) attachGoals({ goals: service, effect: (execute, label) => ctx.effect(execute, label) })
  }
  const blockGoal = async (sessionId: string): Promise<void> => {
    const service = goals
    if (service === null) return
    try {
      const agent = await rt.resolveAgent(sessionId)
      const goal = service.get(agent)
      if (goal?.phase !== 'active') return
      service.block(agent, { id: goal.id, revision: goal.revision }, { code: 'not-supported', message: GOAL_REFUSAL })
    } catch (error) {
      rt.warn('moon-bot: blocking the goal in %s failed: %s', sessionId, error)
    }
  }
  ctx.on<{ readonly id?: string } | undefined, GoalEvent>('session/event', (session, event) => {
    if (event.type !== 'goal/change' || event.data?.goal?.phase !== 'active') return
    const id = session?.id
    if (id === undefined || (!rt.isBotSession(id) && rt.roomOf(id) === undefined)) return
    // block() appends to the same log, so it waits until every listener has seen this change.
    setTimeout(() => void blockGoal(id), 0)
  })

  installCapabilityTools(rt, shared)

  Object.assign(rt, { pickRoom: shared.pickRoom, hideBotUnusedTools })
}

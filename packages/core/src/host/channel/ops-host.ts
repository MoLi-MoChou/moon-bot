// The host half of the channel: model providers, questions, views and sending, plus
// keys, connectors, capabilities, schedules, memory, updates, browsers and diagnostics.
// These endpoints change the host's own profile or an external service; none of them
// edits the team.
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '../llm-bits.ts'
import { validateViewAnswer } from 'moon-bot-contracts'
import type { RpcEndpoint } from 'moon-bot-contracts'
import { questionReply as questionReplyJs, viewReply as viewReplyJs } from '../parts.ts'
import type {
  ChannelBody,
  ChannelHandler,
  ChannelHandlers,
  ChannelResult,
  PendingQuestion,
  PendingView,
} from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'
import { fail, ok } from './envelope.ts'

/** What `questionReply` and `viewReply` hand back for `followup`. */
interface AnsweredReply {
  readonly text: string
  readonly source: Readonly<Record<string, unknown>>
}

// These are the contracts this module relies on, said once instead of at every call;
// `parts.ts` re-exports them from `parts-text.ts`. `views.ts` carries its own types.
const questionReply = questionReplyJs as (question: PendingQuestion, answer: unknown) => AnsweredReply | undefined
const viewReply = viewReplyJs as (record: PendingView, action: unknown, values: unknown) => AnsweredReply | undefined

/** The handlers one endpoint group shares: load first, then run the group's call. */
function grouped<E extends RpcEndpoint>(
  rt: ChannelRuntime,
  names: readonly E[],
  run: (endpoint: E, body: ChannelBody) => Promise<unknown>,
): ChannelHandlers {
  const handlers: Partial<Record<RpcEndpoint, ChannelHandler>> = {}
  for (const name of names) {
    handlers[name] = async (body): Promise<ChannelResult> => {
      await rt.load()
      return ok(await run(name, body))
    }
  }
  return handlers
}

/** The host-level handlers. */
export function hostHandlers(rt: ChannelRuntime): ChannelHandlers {
  const { ctx, state } = rt

  return {
    // Model providers and their keys, for a window without the host's own Models page.
    providers: async () => ok(await rt.providersView()),
    'provider-key': async (body) => {
      if (body.value === null) await rt.clearProviderKey(String(body.provider ?? ''))
      else await rt.setProviderKey(String(body.provider ?? ''), body.value)
      return ok(await rt.providersView())
    },
    'provider-add': async (body) => ok(await rt.addProvider(body)),
    'provider-models': async (body) => ok(await rt.discoverModels(body)),
    'provider-remove': async (body) => ok(await rt.removeProvider(String(body.provider ?? ''))),

    ...grouped(rt, ['secret-set', 'secret-allow', 'secret-cancel', 'secret-update', 'secret-delete'] as const,
      (endpoint, body) => rt.secretEndpoint(endpoint, body)),
    ...grouped(rt, ['connector-connect', 'connector-disconnect', 'connector-retry'] as const,
      (endpoint, body) => rt.connectorEndpoint(endpoint, body)),
    ...grouped(rt, ['capability-save', 'capability-delete', 'capability-approve', 'capability-test', 'capability-retry', 'bot-capability'] as const,
      (endpoint, body) => rt.capabilityEndpoint(endpoint, body)),
    ...grouped(rt, ['schedules', 'schedule-create', 'schedule-delete'] as const,
      (endpoint, body) => rt.scheduleEndpoint(endpoint, body)),
    ...grouped(rt, ['memory-view', 'memory-ask', 'memory-forget'] as const,
      (endpoint, body) => rt.memoryEndpoint(endpoint, body)),

    'answer-question': async (body) => {
      if (typeof body.sessionId !== 'string') return fail('Nothing to send', 'bot/invalid')
      await rt.load()
      const past = rt.pastOwners.get(body.sessionId)
      const sessionId = rt.botOf(body.sessionId) ? rt.chatOf(body.sessionId) : past && past.roomId === undefined ? rt.chatOf(past.botId) : body.sessionId
      const questions = state.questions
      const question = questions === undefined ? undefined : rt.own(questions, sessionId) as PendingQuestion | undefined
      if (question === undefined || question.id !== body.questionId) return fail('This question is no longer open', 'bot/stale')
      const reply = questionReply(question, body.answer)
      if (reply === undefined) return fail('Nothing to send', 'bot/invalid')
      // Claim the question before queueing so a second answer is refused.
      if (questions !== undefined) delete questions[sessionId]
      try {
        await rt.ensureCapabilities(sessionId)
        const agent = await rt.resolveAgent(sessionId)
        agent.followup(createUserMessage({ content: [{ type: 'text', text: reply.text }], source: reply.source }))
        await ctx.sessions.flush(agent.session)
      } catch (error) {
        if (questions !== undefined) questions[sessionId] ??= question
        throw error
      }
      await rt.save()
      return ok(true)
    },
    'view-reply': async (body) => {
      if (typeof body.sessionId !== 'string') return fail('Nothing to send', 'bot/invalid')
      await rt.load()
      const past = rt.pastOwners.get(body.sessionId)
      const sessionId = rt.botOf(body.sessionId) ? rt.chatOf(body.sessionId) : past && past.roomId === undefined ? rt.chatOf(past.botId) : body.sessionId
      const views = state.views
      const pending = views === undefined ? undefined : rt.own(views, sessionId) as PendingView | undefined
      if (pending === undefined || pending.id !== body.viewId) return fail('This view is no longer open', 'bot/stale')
      const checked = validateViewAnswer(pending.view, body.action, body.values)
      if ('error' in checked) return fail(checked.error, 'bot/invalid')
      const reply = viewReply(pending, body.action, body.values)
      if (reply === undefined) return fail('Nothing to send', 'bot/invalid')
      // Claim the view before queueing so a second answer is refused.
      if (views !== undefined) delete views[sessionId]
      try {
        await rt.ensureCapabilities(sessionId)
        const agent = await rt.resolveAgent(sessionId)
        agent.followup(createUserMessage({ content: [{ type: 'text', text: reply.text }], source: reply.source }))
        await ctx.sessions.flush(agent.session)
      } catch (error) {
        if (views !== undefined) views[sessionId] ??= pending
        throw error
      }
      await rt.save()
      return ok(true)
    },
    send: async (body) => {
      const text = String(body.text ?? '').trim()
      if (text === '' || typeof body.sessionId !== 'string') return fail('Nothing to send', 'bot/invalid')
      await rt.load()
      if (typeof rt.roomOf(body.sessionId)?.archivedAt === 'number') return fail('This group chat is archived', 'bot/invalid')
      // A Bot id or an earlier part of its own chat means the current part.
      const past = rt.pastOwners.get(body.sessionId)
      const sessionId = rt.botOf(body.sessionId) ? rt.chatOf(body.sessionId) : past && past.roomId === undefined ? rt.chatOf(past.botId) : body.sessionId
      await rt.ensureCapabilities(sessionId)
      // The window shows the Bot working from the send on: the engine's first event may be
      // a moment away (a turn queued behind another, an agent being spawned), and a turn
      // that fails says so in the chat. A send the engine never took takes the mark back.
      rt.noteSent?.(sessionId, true)
      try {
        await ctx.sessionController.prompt({
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, AbortSignal.timeout(30_000))
      } catch (error) {
        rt.noteSent?.(sessionId, false)
        throw error
      }
      return ok(true)
    },
    'approval-answer': async (body) => {
      rt.answerApproval(body.id, body.choice)
      return ok(true)
    },
    'stop-member-work': async (body) => ok(await rt.stopMemberWork(String(body.roomId ?? ''), String(body.botId ?? ''))),
    'dismiss-question': async (body) => {
      await rt.load()
      const questions = state.questions
      if (questions !== undefined && rt.own(questions, body.sessionId as string | undefined) !== undefined) {
        delete questions[body.sessionId as string]
        await rt.save()
      }
      return ok(true)
    },
    'dismiss-view': async (body) => {
      await rt.load()
      const views = state.views
      if (views !== undefined && rt.own(views, body.sessionId as string | undefined) !== undefined) {
        delete views[body.sessionId as string]
        await rt.save()
      }
      return ok(true)
    },

    'update-check': async (body) => {
      const fresh = body.fresh === true
      return ok(await rt.updateCheck({ fresh }))
    },
    'update-install': async () => ok(rt.updateStart()),
    'repo-stars': async () => ok(await rt.repoStars()),

    // The Desktop window's long poll for read_browser, and its answers.
    'browser-wait': async (body) => {
      if (rt.browserChannel === undefined) return fail('Bot browsers are off on this host', 'bot/browser-off')
      const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 100) : ''
      if (clientId === '') return fail('A browser poll needs a clientId', 'bot/invalid')
      await rt.load()
      return ok(await rt.browserChannel.wait(clientId, rt.browserOpen(body.open)))
    },
    'browser-result': async (body) => {
      if (rt.browserChannel === undefined) return fail('Bot browsers are off on this host', 'bot/browser-off')
      return ok(rt.browserChannel.result(body))
    },

    diagnostics: async (body) => {
      await rt.load()
      return ok(await rt.diagnostics.report(body))
    },
    'diagnostics-log': async () => ok(await rt.diagnostics.logText()),
    'diagnostics-clear': async () => {
      await rt.diagnostics.clear()
      return ok(true)
    },
  }
}

// Approvals. A member's group Session is hidden, so the host's approval card never shows
// there and the turn would wait forever: DS Bot answers those requests itself, from
// the group chat. A Bot's own chat keeps the host's card too, so every request can be
// answered from the team view.
import { randomUUID } from 'node:crypto'
import type { ApprovalDetail, ApprovalNote, HostRuntime } from './runtime.js'

const OUTCOMES: Readonly<Record<string, string>> = { allow: 'allowed-once', reject: 'rejected' }

interface ApprovalRequestPayload {
  readonly agent?: { readonly id?: string; readonly session?: { readonly id?: string } }
  readonly approvalId?: string
  readonly toolName?: string
  readonly callId?: string
  readonly reason?: string
  readonly detail?: ApprovalDetail
  readonly signal?: AbortSignal
}

type ApprovalNext = (approvalId?: string) => Promise<string>

interface ApprovalAnswerer {
  answer?(id: string, outcome: string): boolean
}

interface PendingApproval {
  readonly id: string
  readonly sessionId: string | undefined
  readonly botId: string
  readonly roomId?: string
  readonly tool: string
  readonly reason: string
  readonly detail: ApprovalDetail
  readonly at: number
  answer?: (outcome: string) => void
}

export function install(rt: HostRuntime): void {
  const { ctx } = rt
  const pending = new Map<string, PendingApproval>()

  // Ahead of the host's own answerer, which would hold a hidden Session's request unseen.
  ctx.on<ApprovalRequestPayload, ApprovalNext>(
    'approval/request',
    (request, next) => {
      const sessionId = request.agent?.session?.id ?? request.agent?.id
      const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
      const botId =
        owner?.botId ?? (sessionId === undefined ? undefined : (rt.chatOwners.get(sessionId) ?? rt.selfOf?.(sessionId)))
      if (botId === undefined) return next(request.approvalId)

      // ServiceApproval passes its id in the request and uses the same id when it opens the
      // card. Direct ACP requests may not have one yet, so this host-side fallback still gets
      // passed into `next` instead of creating a second, invisible waiter.
      const id = request.approvalId ?? randomUUID()
      let resolve!: (outcome: string) => void
      const answered = new Promise<string>(done => {
        resolve = done
      })
      const entry: PendingApproval = {
        id,
        sessionId,
        botId,
        ...(owner ? { roomId: owner.roomId } : {}),
        tool: String(request.toolName ?? ''),
        reason: String(request.reason ?? '').slice(0, 500),
        detail: request.detail ?? rt.callDetail?.(sessionId, request.callId) ?? {},
        at: Date.now(),
      }
      pending.set(id, entry)
      const note: ApprovalNote = { tool: entry.tool, reason: entry.reason.slice(0, 200) }
      rt.noteApproval?.(sessionId, note)
      const settled = (): void => {
        pending.delete(id)
        rt.noteApproval?.(sessionId, undefined)
      }
      entry.answer = outcome => {
        if (!pending.has(id)) return
        // Own-chat cards are backed by ServiceApproval. Group cards have a local waiter;
        // calling the optional bridge for both keeps this path safe for direct ACP events.
        ctx.get<ApprovalAnswerer>('approval')?.answer?.(id, outcome)
        resolve(outcome)
        settled()
      }
      if (request.signal?.aborted) entry.answer('cancelled')
      request.signal?.addEventListener('abort', () => entry.answer?.('cancelled'), { once: true })

      // In the standalone service, the shared approval bridge is present and both private
      // and group requests must open its card under this id. The host-only test/runtime has
      // no bridge; preserve the group's local waiter there and let private chats delegate to
      // their existing next() answerer.
      const bridge = ctx.get<ApprovalAnswerer>('approval')
      if (pending.has(id) && (owner === undefined || bridge !== undefined)) {
        try {
          void Promise.resolve(next(id)).then(
            outcome => entry.answer?.(outcome),
            () => entry.answer?.('cancelled'),
          )
        } catch {
          entry.answer('cancelled')
        }
      }
      if (owner !== undefined) rt.yieldRoomTurn?.(sessionId)
      return answered.finally(settled)
    },
    { prepend: true },
  )

  const approvalsView = () =>
    [...pending.values()].map(({ answer, ...entry }) => ({ ...entry, answerable: answer !== undefined }))
  const waitsForApproval = (sessionId: string): boolean =>
    [...pending.values()].some(entry => entry.sessionId === sessionId)

  function answerApproval(id: unknown, choice: string): void {
    const entry = pending.get(String(id ?? ''))
    if (entry?.answer === undefined)
      throw Object.assign(new Error('This approval is no longer open'), { code: 'bot/stale' })
    const outcome = OUTCOMES[choice]
    if (outcome === undefined) throw Object.assign(new Error('Choose allow or reject'), { code: 'bot/invalid' })
    entry.answer(outcome)
  }

  // A group Session that leaves its group has no card left to answer from. Match the exact
  // Session rather than a Bot, because one Bot can wait in its own chat and in a group.
  const cancelApprovals = (sessionId: string): void => {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) entry.answer?.('cancelled')
    }
  }

  Object.assign(rt, { approvalsView, waitsForApproval, answerApproval, cancelApprovals })
}

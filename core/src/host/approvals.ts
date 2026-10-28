// Approvals. A member's group Session is hidden, so DSH's approval card never shows
// there and the turn would wait forever: DS Bot answers those requests itself, from
// the group chat. A Bot's own chat keeps DSH's card; its requests are only noted, so
// the team view can say who is waiting.
import { randomUUID } from 'node:crypto'
import type { ApprovalDetail, ApprovalNote, HostRuntime } from './runtime.js'

const OUTCOMES: Readonly<Record<string, string>> = { allow: 'allowed-once', reject: 'rejected' }

interface ApprovalRequestPayload {
  readonly agent?: { readonly id?: string; readonly session?: { readonly id?: string } }
  readonly toolName?: string
  readonly callId?: string
  readonly reason?: string
  readonly detail?: ApprovalDetail
  readonly signal?: AbortSignal
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

  // Ahead of DSH's own answerer, which would hold a hidden Session's request unseen.
  ctx.on<ApprovalRequestPayload, () => Promise<string>>('approval/request', (request, next) => {
    const sessionId = request.agent?.session?.id ?? request.agent?.id
    const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
    const botId = owner?.botId ?? (sessionId === undefined ? undefined : (rt.chatOwners.get(sessionId) ?? rt.selfOf?.(sessionId)))
    if (botId === undefined) return next()
    const id = randomUUID()
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
    if (owner === undefined) return Promise.resolve(next()).finally(settled)
    rt.yieldRoomTurn?.(sessionId)
    return new Promise<string>((resolve) => {
      entry.answer = (outcome) => {
        if (!pending.has(id)) return
        settled()
        resolve(outcome)
      }
      if (request.signal?.aborted) entry.answer('cancelled')
      request.signal?.addEventListener('abort', () => entry.answer?.('cancelled'), { once: true })
    })
  }, { prepend: true })

  const approvalsView = () => [...pending.values()].map(({ answer, ...entry }) => ({ ...entry, answerable: answer !== undefined }))
  const waitsForApproval = (sessionId: string): boolean => [...pending.values()].some(entry => entry.sessionId === sessionId)

  function answerApproval(id: unknown, choice: string): void {
    const entry = pending.get(String(id ?? ''))
    if (entry?.answer === undefined) throw Object.assign(new Error('This approval is no longer open'), { code: 'bot/stale' })
    const outcome = OUTCOMES[choice]
    if (outcome === undefined) throw Object.assign(new Error('Choose allow or reject'), { code: 'bot/invalid' })
    entry.answer(outcome)
  }

  // A group Session that leaves its group has no card left to answer from.
  const cancelApprovals = (sessionId: string): void => {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) entry.answer?.('cancelled')
    }
  }

  Object.assign(rt, { approvalsView, waitsForApproval, answerApproval, cancelApprovals })
}

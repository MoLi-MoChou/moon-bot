// The standalone approval service (plan §阶段 3): the ApprovalService face the host's
// folder approvals already call, bridged onto the team's own approval cards. A request
// rides the 'approval/request' event the approvals module answers for group Sessions;
// for an own chat the module hands it back to `next`, which here is the card's promise —
// so one card flow serves both, and `approval-answer` on the channel settles it.
import { randomUUID } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequest, ApprovalService } from '../host/host-types.js'

export interface ApprovalRequestWithId extends ApprovalRequest {
  readonly approvalId: string
}

export type ApprovalNext = (approvalId?: string) => Promise<string>
export type EmitApproval = (request: ApprovalRequestWithId, next: ApprovalNext) => unknown

interface WaitingApproval {
  readonly resolve: (outcome: string) => void
  readonly promise: Promise<string>
}

/** The service-side half of the one pending approval registry. */
export class ServiceApproval implements ApprovalService {
  private readonly waiting = new Map<string, WaitingApproval>()

  private readonly emitEvent: EmitApproval

  constructor(emitEvent: EmitApproval) {
    this.emitEvent = emitEvent
  }

  /** Opens the card promise under the id already shown by the host. */
  card(id: string): Promise<string> {
    const existing = this.waiting.get(id)
    if (existing !== undefined) return existing.promise
    let resolve!: (outcome: string) => void
    const promise = new Promise<string>(done => {
      resolve = done
    })
    this.waiting.set(id, { resolve, promise })
    return promise
  }

  /** Answers an open card by id — the shape the channel's approval flow can drive. */
  answer(id: string, outcome: string): boolean {
    const waiting = this.waiting.get(id)
    if (waiting === undefined) return false
    this.waiting.delete(id)
    waiting.resolve(outcome)
    return true
  }

  async request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const approvalId = randomUUID()
    const outcome = await new Promise<string>(resolve => {
      let settled = false
      const settle = (value: string): void => {
        if (settled) return
        settled = true
        this.waiting.delete(approvalId)
        resolve(value)
      }
      const next: ApprovalNext = () => {
        const card = this.card(approvalId)
        void card.then(settle, () => settle('cancelled'))
        return card
      }
      if (request.signal?.aborted) {
        settle('cancelled')
        return
      }
      request.signal?.addEventListener(
        'abort',
        () => {
          this.answer(approvalId, 'cancelled')
          settle('cancelled')
        },
        { once: true },
      )
      try {
        const emitted = this.emitEvent({ ...request, approvalId }, next)
        void Promise.resolve(emitted).then(
          value => {
            if (typeof value === 'string') settle(value)
          },
          () => settle('cancelled'),
        )
      } catch {
        settle('cancelled')
      }
    })
    if (outcome === 'allowed-once' || outcome === 'allowed') return 'allowed-once'
    if (outcome === 'rejected') return 'rejected'
    return 'cancelled'
  }
}

// Keep the service's callback shape available to host wiring without exposing its map.
export type ApprovalResponder = Pick<ServiceApproval, 'answer'>

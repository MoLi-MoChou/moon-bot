// The standalone approval service (plan §阶段 3): the ApprovalService face the host's
// folder approvals already call, bridged onto the team's own approval cards. A request
// rides the 'approval/request' event the approvals module answers for group Sessions;
// for an own chat the module hands it back to `next`, which here is the card's promise —
// so one card flow serves both, and `approval-answer` on the channel settles it.
import { randomUUID } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequest, ApprovalService } from '../host/dsh-types.js'

export type EmitApproval = (request: ApprovalRequest, next: () => Promise<string>) => void

export class ServiceApproval implements ApprovalService {
  private readonly waiting = new Map<string, (outcome: string) => void>()

  private readonly emitEvent: EmitApproval

  constructor(emitEvent: EmitApproval) {
    this.emitEvent = emitEvent
  }

  /** Opens a card-backed promise: the approvals module's pending entry answers it. */
  card(): Promise<string> {
    return new Promise(resolve => {
      const id = randomUUID()
      this.waiting.set(id, outcome => {
        this.waiting.delete(id)
        resolve(outcome)
      })
    })
  }

  /** Answers an open card by id — the shape the channel's approval flow can drive. */
  answer(id: string, outcome: string): boolean {
    const settle = this.waiting.get(id)
    if (settle === undefined) return false
    settle(outcome)
    return true
  }

  async request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const outcome = await new Promise<string>(resolve => {
      this.emitEvent(request, () => {
        const card = this.card()
        // A card nobody answers would hang the request; the request's own signal ends it.
        request.signal?.addEventListener('abort', () => resolve('cancelled'), { once: true })
        return card
      })
    })
    if (outcome === 'allowed-once' || outcome === 'allowed') return 'allowed-once'
    if (outcome === 'rejected') return 'rejected'
    return 'cancelled'
  }
}

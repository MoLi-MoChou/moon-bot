// How a turn noted in the last process is classified at the next start. This does not
// read the disk or send a message: resume.ts applies the decision.

/** The first turn event this process saw for that session, if any. */
export type RecoveryFact = 'turn/end' | 'turn/start' | undefined

/** drop: it finished. keep: still running. park: the user may continue. stop: already continued once. */
export type RecoveryDecision = 'drop' | 'keep' | 'park' | 'stop'

export interface ResumeTrigger {
  readonly role?: string | undefined
  readonly exchangeId?: string | undefined
  readonly senderSessionId?: string | undefined
  readonly roomId?: string | undefined
  readonly work?: string | undefined
  readonly audience?: string | undefined
  readonly askedBy?: string | undefined
  readonly senderRoomId?: string | undefined
}

/** A running turn noted in `inflight.json`. */
export interface TurnNote {
  readonly botId?: string | undefined
  readonly roomId?: string
  readonly since: number
  trigger?: ResumeTrigger
  approval?: { readonly tool: string; readonly reason: string }
  resumed?: boolean
}

/** What a sender's open work is told when the turn is not run again. */
export const INTERRUPTED_WORK = 'Moon Bot restarted before this finished, and it was not run again.'

export function recoveryOf(fact: RecoveryFact, running: boolean, resumed: boolean): RecoveryDecision {
  if (fact === 'turn/end') return 'drop'
  if (fact === undefined && running) return 'keep'
  if (resumed) return 'stop'
  return 'park'
}

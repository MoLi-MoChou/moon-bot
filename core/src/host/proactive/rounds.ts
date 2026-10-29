// The quiet round: a proactive run that had nothing to say still happened, and the panel
// says so in one line without counting as unread or raising a notification (plan §6).
//
// Kept apart from the turn history in tasks-panel: those rows are turns a Bot ran, and a
// run that decided not to speak is not a turn. Mixing them would make "what is it working
// on" answer with things that never worked on anything.
import type { HostRuntime } from '../runtime.js'

/** What one run did, as the panel shows it. */
export interface ProactiveRound {
  readonly subscriptionId: string
  readonly botId: string
  readonly botName: string
  readonly at: number
  /** 'sent' and 'withheld:reason' did something; 'nothing' and 'failed' left no trace. */
  readonly outcome: string
}

/** The most recent rounds kept for the panel. */
const KEPT = 20

export interface RoundLog {
  note(round: ProactiveRound): void
  recent(): readonly ProactiveRound[]
}

export function createRoundLog(limit: number = KEPT): RoundLog {
  const rounds: ProactiveRound[] = []
  return {
    note(round: ProactiveRound): void {
      rounds.unshift(round)
      if (rounds.length > limit) rounds.length = limit
    },
    recent(): readonly ProactiveRound[] {
      return [...rounds]
    },
  }
}

/**
 * The line the panel shows for a round. Sending and withholding both say what happened;
 * a run that found nothing says only that — never why, because there is no why worth
 * interrupting for.
 */
export function roundLine(outcome: string): string {
  if (outcome === 'sent') return 'brought something up'
  if (outcome.startsWith('withheld:')) return `held back (${outcome.slice('withheld:'.length)})`
  if (outcome === 'failed') return 'could not finish'
  return 'found nothing to say'
}

/** Installs the log on the runtime so the task panel can read it. */
export function install(rt: HostRuntime, log: RoundLog): void {
  Object.assign(rt, { proactiveRounds: () => log.recent() })
}

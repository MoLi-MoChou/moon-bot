// One run of the proactive pipeline: prepare, screen, then either deliver, quiet, delay or
// drop. The orchestration lives here so every trigger — a schedule, the no-progress hook,
// or the user pressing "look back over today" — goes through the same decisions.
//
// Nothing here decides what is worth saying (prep does) or whether it may be said (the
// screen does). This module's only job is the order, and the rule that a failure at any
// step leaves the user undisturbed.
import type { Candidate, PrepareAsk } from './prep.ts'
import { prepare } from './prep.ts'
import { screenHard, type EarlierCandidate, type ScreenVerdict, type TriggerSource } from './screen-hard.ts'
import { judge, type JudgeAsk } from './screen-judge.ts'

/** What a run needs from the outside, injected so the pipeline can be tested alone. */
export interface RunDeps {
  readonly ask: PrepareAsk
  /** The soft judgement. Optional: a run without it stops after the hard rules. */
  readonly judgeAsk?: JudgeAsk | undefined
  readonly newId: () => string
  readonly now: () => number
  readonly log: (message: string, ...rest: readonly unknown[]) => void
}

export interface RunCandidates {
  /** The subject to watch, in the user's own words. */
  readonly topics: string
  /** What the Bot remembers, already read. */
  readonly memory: readonly { readonly topic: string | null, readonly text: string, readonly added: string | null }[]
  readonly messages: readonly { readonly role: string, readonly text: string, readonly at: number }[]
  readonly alreadySaid: readonly string[]
}

export interface RunScreen {
  readonly deliveredToday: number
  readonly dailyCap: number
  readonly earlier: readonly EarlierCandidate[]
  readonly mentionedRecently: boolean
  readonly localTime: string
  readonly quiet: { readonly from: string, readonly to: string } | null
}

export interface RunRequest {
  readonly subscriptionId: string
  readonly botId: string
  readonly sessionId: string
  readonly triggerSource: TriggerSource
  readonly candidates: RunCandidates
  readonly screen: RunScreen
  /** `manual` runs never deliver: the user asked to see them, so they are listed instead. */
  readonly readOnly: boolean
}

export type RunOutcome =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'prepared'; readonly candidate: Candidate; readonly verdict: ScreenVerdict; readonly why?: string | undefined }

/**
 * Runs the pipeline once and reports what happened, without delivering anything: the caller
 * owns delivery, so the same run can be shown in a panel instead of sent.
 */
export async function runOnce(request: RunRequest, deps: RunDeps): Promise<RunOutcome> {
  let candidate: Candidate | undefined
  try {
    candidate = await prepare({
      subscription: {
        id: request.subscriptionId,
        botId: request.botId,
        sessionId: request.sessionId,
        topics: request.candidates.topics,
        // Reading paid capabilities during prep stays off unless a subscription says so;
        // this build never enables it, and the field carries the decision forward.
        allowPaidPrep: false,
      },
      memory: request.candidates.memory,
      messages: request.candidates.messages,
      alreadySaid: request.candidates.alreadySaid,
      now: deps.now(),
      triggerSource: request.triggerSource,
    }, deps.ask, deps.newId)
  } catch (error) {
    // A failed preparation is silence: the user is not told that a check went wrong.
    const reason = error instanceof Error ? error.message : String(error)
    deps.log('moon-bot: proactive prep failed for %s: %s', request.subscriptionId, reason)
    return { kind: 'failed', reason }
  }
  if (candidate === undefined) return { kind: 'nothing' }
  const verdict = screenHard({
    candidate,
    deliveredToday: request.screen.deliveredToday,
    dailyCap: request.screen.dailyCap,
    earlier: request.screen.earlier,
    mentionedRecently: request.screen.mentionedRecently,
    localTime: request.screen.localTime,
    quiet: request.screen.quiet,
  })
  // The soft question is only asked about a candidate the hard rules already allowed: the
  // other ones are decided, and asking would spend a request to learn nothing.
  if (verdict.kind === 'accept' && deps.judgeAsk !== undefined) {
    const judged = await judge(candidate, deps.judgeAsk).catch(() => ({ kind: 'drop' as const, reason: 'the judge failed' }))
    if (judged.kind === 'drop') return { kind: 'prepared', candidate, verdict: { kind: 'drop', reason: 'not-worth-it' }, why: judged.reason }
  }
  return { kind: 'prepared', candidate, verdict }
}

/** Types extracted. */

// -------------------------------------------------------------------------
// Question cards. `ask_user` cards sit in the transcript and never block the Bot;
// typing in the composer instead answers them. The blocking ask_user_question tool
// keeps the shell's composer takeover and gains an own-answer field.
// A question as the host asks it. An option may be a bare label or a labelled row.
export interface QuestionOption {
  label: string
  description?: string | undefined
}
export interface Question {
  id: string
  header?: string | undefined
  question?: string | undefined
  detail?: string | undefined
  options?: readonly (string | QuestionOption)[] | undefined
  multiSelect?: boolean | undefined
  allowCustom?: boolean | undefined
  callId?: string | undefined
}
export interface QuestionAnswer {
  selected?: readonly string[] | undefined
  custom?: string | undefined
}
export interface QuestionActions {
  answerQuestion: (
    sessionId: string,
    questionId: string,
    answer: {
      selected: readonly string[]
      custom: string
    },
  ) => Promise<unknown>
  dismissQuestion: (sessionId: string) => Promise<unknown>
  noteHeldCard?: (sessionId: string, kind: string, requestId: string, delta: number) => void
}
// The pending ask_user card the transcript hands over.
export interface PendingAsk {
  question?: string
  questions?: readonly Question[] | undefined
  answer: (payload: {
    answers: readonly (QuestionAnswer & {
      id: string
    })[]
  }) => void
  dismiss: () => void
}
// The card an answered question leaves in the transcript.
export interface AnsweredNode {
  data?: {
    questions?: unknown
    answers?: unknown
    text?: string
  }
}

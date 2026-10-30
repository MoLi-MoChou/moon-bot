// The text side of parts: what a card asked and what the user answered, the reply a
// card answer becomes, one history entry, and a note's headings.
import { REPLY_KIND, SOURCE_KIND } from './constants.ts'
import { textOf } from './text.ts'
import { validateViewAnswer, viewSummary } from 'moon-bot-contracts'
import type { SessionEvent } from './host-types.js'

interface AskQuestion {
  readonly id?: string
  readonly callId?: string
  readonly question?: string
  readonly detail?: string
  readonly multiSelect?: boolean
  readonly options?: readonly { readonly label?: string }[]
}

interface ReplyAnswer {
  readonly id: string
  readonly action?: string
  readonly values?: unknown
  readonly selected?: readonly string[] | undefined
  readonly custom?: string | undefined
}

interface ReplyView {
  readonly id: string
  readonly title: string
  readonly view: Record<string, unknown>
}

interface ReplyQuestion {
  readonly id: string
  readonly question: string
  readonly callId?: string
  readonly multiSelect?: boolean
  readonly options?: readonly { readonly label?: string }[]
}

export interface ReadReply {
  readonly views?: readonly ReplyView[]
  readonly questions?: readonly ReplyQuestion[]
  readonly answers: readonly ReplyAnswer[]
}

export interface HistoryEntry {
  readonly answer: boolean
  readonly text: string
  readonly who?: string
  readonly keepAnswers?: boolean
}

export interface CardReply {
  readonly text: string
  readonly source: { readonly kind: string; readonly callId: unknown; readonly outcome: string }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

// An ask_user card as the user saw it. The user's reply is often just an option label,
// which means nothing without the card. Arguments the tool would refuse (no question,
// options that are not { label } objects) showed no card, so they give no text.
export function cardText(args: unknown): string {
  let card = args
  if (typeof card === 'string') {
    try {
      card = JSON.parse(card)
    } catch {
      return ''
    }
  }
  const whole = asRecord(card)
  const question = typeof whole?.question === 'string' ? whole.question.trim() : ''
  const given = Array.isArray(whole?.options) ? whole.options : []
  if (given.some(option => typeof asRecord(option)?.label !== 'string')) return ''
  const options = given.map(option => String(asRecord(option)?.label ?? '').trim()).filter(Boolean)
  if (question === '' || options.length === 0) return ''
  const detail = typeof whole?.detail === 'string' ? whole.detail.trim() : ''
  return `[Question card] ${question}${detail ? ` (${detail})` : ''}\nOptions: ${options.join(' / ')}`
}

// A show_view card as the user saw it. A call the tool would refuse (no title,
// or a view that is not a component object) showed no card, so it gives no text.
export function viewCardText(args: unknown): string {
  let card = args
  if (typeof card === 'string') {
    try {
      card = JSON.parse(card)
    } catch {
      return ''
    }
  }
  const whole = asRecord(card)
  const title = typeof whole?.title === 'string' ? whole.title.trim() : ''
  const view = whole?.view
  if (title === '' || view === null || typeof view !== 'object' || Array.isArray(view)) return ''
  const summary = viewSummary(view)
  return summary === '' ? `[View card] ${title}` : `[View card] ${title}\n${summary}`
}

// The user's answer to an ask_user card. The message carries the question with the
// answer, so the answer still makes sense after a checkpoint drops the card.
export function questionReply(
  question: AskQuestion | undefined,
  answer: { readonly selected?: unknown; readonly custom?: unknown } | undefined,
): CardReply | undefined {
  const labels = new Set((question?.options ?? []).map(option => option.label))
  const picked = (Array.isArray(answer?.selected) ? answer.selected : []).filter(
    (label): label is string => typeof label === 'string' && labels.has(label),
  )
  const selected = question?.multiSelect === true ? [...new Set(picked)] : picked.slice(0, 1)
  const custom = typeof answer?.custom === 'string' ? answer.custom.trim() : ''
  if (selected.length === 0 && custom === '') return undefined
  const callId = question?.callId ?? question?.id
  const asked = {
    id: question?.id,
    question: question?.question,
    ...(question?.detail ? { detail: question.detail } : {}),
    options: question?.options,
    multiSelect: question?.multiSelect === true,
  }
  const given = { id: question?.id, selected, ...(custom !== '' ? { custom } : {}) }
  return {
    text: JSON.stringify({
      kind: 'answer_to_pending_question',
      tool: 'ask_user',
      callId,
      questions: [asked],
      answers: [given],
    }),
    source: { kind: REPLY_KIND, callId, outcome: 'answered' },
  }
}

// The user's answer to a show_view card. The message carries the blueprint with
// the answer, so the answer still makes sense after a checkpoint drops the card.
export function viewReply(
  record:
    | { readonly id?: string; readonly callId?: string; readonly title?: string; readonly view?: unknown }
    | undefined,
  action: string,
  values: unknown,
): CardReply | undefined {
  const checked = validateViewAnswer(record?.view, action, values)
  if ('error' in checked) return undefined
  const callId = record?.callId ?? record?.id
  const shown = { id: record?.id, title: record?.title, view: record?.view }
  const given = { id: record?.id, action, values: checked }
  return {
    text: JSON.stringify({
      kind: 'answer_to_pending_view',
      tool: 'show_view',
      callId,
      views: [shown],
      answers: [given],
    }),
    source: { kind: REPLY_KIND, callId, outcome: 'answered' },
  }
}

export const isRecord = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function readReply(text: string): ReadReply | undefined {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  const whole = asRecord(value)
  if (
    whole?.kind === 'answer_to_pending_view' ||
    (Array.isArray(whole?.views) && whole.views.length > 0 && whole?.kind !== 'answer_to_pending_question')
  ) {
    const views = (Array.isArray(whole?.views) ? whole.views : []).filter(
      item => typeof item?.id === 'string' && typeof item.title === 'string' && isRecord(item.view),
    )
    if (views.length === 0) return undefined
    const answers = (Array.isArray(whole?.answers) ? whole.answers : []).filter(
      item => typeof item?.id === 'string' && typeof item.action === 'string' && isRecord(item.values),
    )
    return { views: views as ReplyView[], answers: answers as ReplyAnswer[] }
  }
  const questions = Array.isArray(whole?.questions)
    ? whole.questions.filter(item => typeof item?.id === 'string' && typeof item.question === 'string')
    : []
  if (questions.length === 0) return undefined
  const answers = (Array.isArray(whole?.answers) ? whole.answers : []).filter(
    item => typeof item?.id === 'string' && Array.isArray(item.selected),
  )
  return { questions: questions as ReplyQuestion[], answers: answers as ReplyAnswer[] }
}

// The submitted component only. A long form is cut so a checkpoint stays small.
function actionSummary(answer: ReplyAnswer | undefined): string {
  const values = asRecord(answer?.values)
  if (values === undefined) return '(skipped)'
  let text
  if (Array.isArray(values.selected)) text = `selected: ${values.selected.join(', ')}`
  else if (typeof values.confirmed === 'boolean') text = values.confirmed ? 'confirmed' : 'cancelled'
  else if (isRecord(values.fields))
    text = Object.entries(values.fields as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('; ')
  else text = typeof answer?.action === 'string' && answer.action !== '' ? answer.action : '(skipped)'
  if (text === '') text = '(empty)'
  return text.length > 500 ? text.slice(0, 500) : text
}

export function replyText(text: string): string {
  const reply = readReply(text)
  if (reply === undefined) return text
  if (reply.views !== undefined) {
    return reply.views
      .map(view => {
        const answer = reply.answers.find(item => item.id === view.id)
        return `[Answer to view card] ${view.title}\nAnswer: ${actionSummary(answer)}`
      })
      .join('\n\n')
  }
  return (reply.questions ?? [])
    .map(question => {
      const answer = reply.answers.find(item => item.id === question.id)
      const values = [...(answer?.selected ?? []), ...(answer?.custom ? [answer.custom] : [])]
      return `[Answer to question card] ${question.question}\nAnswer: ${values.length > 0 ? values.join(', ') : '(skipped)'}`
    })
    .join('\n\n')
}

// What one event adds to a Bot's chat history: an answer of the Bot's (its text, or a
// question card), or a message from the user (`who: 'user'`) or another Bot
// (`who: 'bot'`) that the answers after it belong to. Context that other plugins append
// (time, attachments) adds nothing. Setup kickoffs, handoff packages, and, in an own
// chat, group turns from before group Sessions existed show no text, and drop the
// answers to them.
export function historyEntry(event: SessionEvent, group: boolean): HistoryEntry | undefined {
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === 'assistant/message') {
    const message = asRecord(data.message)
    const text = textOf(message?.content)
    return text === '' ? undefined : { answer: true, text }
  }
  // Cards only show in an own chat. A PTC program's sub-call asks too.
  const named = event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start' ? data.name : undefined
  if ((named === 'ask_user' || named === 'show_view') && !group) {
    const text = named === 'ask_user' ? cardText(data.arguments) : viewCardText(data.arguments)
    return text === '' ? undefined : { answer: true, text }
  }
  const source = asRecord(data.source)
  if (event.type === 'user/message' && source?.kind === REPLY_KIND) {
    return { answer: false, who: 'user', text: replyText(textOf(data.content)), keepAnswers: true }
  }
  if (event.type !== 'user/message' || (source?.kind !== 'user' && source?.kind !== SOURCE_KIND)) return undefined
  const text = textOf(data.content)
  const ours = source.kind === SOURCE_KIND
  const skipped =
    (ours && (source.handoff === true || source.role === 'kickoff')) || (!group && text.startsWith('[Group chat'))
  // A turn that went on after a handoff did real work, so its answers stay.
  return {
    answer: false,
    who: ours ? 'bot' : 'user',
    text: skipped ? '' : text,
    keepAnswers: !skipped || (ours && source.resume === true),
  }
}

// A note with every heading in order but some translated (e.g. "## 目标" for "## Goals")
// gets the headings as written, so the note is not thrown away over its headings alone.
// A known heading in another place (repeated or out of order) keeps the note as it is.
export function canonicalHeadings(note: string, names: readonly string[]): string {
  const lines = note.split('\n')
  const at = lines.flatMap((line, index) => (/^##\s+\S/.test(line) ? [index] : []))
  const heading = (index: number): string => (lines[index] ?? '').replace(/^##\s+/, '').trim()
  if (at.length !== names.length || at.every((index, n) => heading(index) === names[n])) return note
  if (at.some((index, n) => names.includes(heading(index)) && heading(index) !== names[n])) return note
  at.forEach((index, n) => {
    lines[index] = `## ${names[n]}`
  })
  return lines.join('\n')
}

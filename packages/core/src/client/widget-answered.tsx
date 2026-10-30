import { createElement as h } from 'react'
import { AnsweredCell } from './questions.tsx'
import type { AnsweredNode } from './questions.tsx'
import { WidgetCard } from './widget-cell.tsx'
import type { AnswerValue } from './widget-cell.tsx'

interface ShownLike {
  id?: string | undefined
  title?: string | undefined
  view?: unknown
}
interface ReplyData {
  kind?: string | undefined
  views?: ShownLike[] | undefined
  answers?: readonly AnswerValue[] | undefined
  text?: unknown
  questions?: readonly unknown[] | undefined
}
interface ReplyNode {
  data?: ReplyData | undefined
}

// An answered view rides on the reply message itself: the settled card, read-only.
export function AnsweredView({ node }: { node: ReplyNode }) {
  const data = node.data ?? {}
  let payload: ReplyData | null = null
  if (Array.isArray(data.views)) payload = data
  else {
    try {
      payload = typeof data.text === 'string' ? JSON.parse(data.text) : null
    } catch {
      payload = null
    }
    if (payload?.kind !== 'answer_to_pending_view') payload = null
  }
  const view = payload?.views?.[0]
  if (view === null || typeof view !== 'object' || view.view === undefined) return null
  const answers = Array.isArray(payload?.answers) ? payload.answers : []
  const answer = answers.find(entry => entry.id === view.id) ?? answers[0] ?? null
  return (
    <div className='bt-q-inline'>
      <WidgetCard
        title={view.title ?? ''}
        view={view.view as Parameters<typeof WidgetCard>[0]['view']}
        settled
        answer={answer}
      />
    </div>
  )
}
// A question reply node carries either questions (data.questions) or a view answer
// (JSON text discriminated by kind); each shape gets its own renderer.
export function AnsweredReply({ node }: { node?: ReplyNode | undefined }) {
  // The same call as before: a node the shell hands over without data draws nothing.
  if (node === undefined) return <AnsweredCell node={node as unknown as AnsweredNode} />
  const data = node.data ?? {}
  if (Array.isArray(data.views) && data.views.length > 0) return <AnsweredView node={node} />
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    let parsed = null
    try {
      parsed = typeof data.text === 'string' ? JSON.parse(data.text) : null
    } catch {
      parsed = null
    }
    if (parsed?.kind === 'answer_to_pending_view') return <AnsweredView node={node} />
  }
  return <AnsweredCell node={node as unknown as AnsweredNode} />
}

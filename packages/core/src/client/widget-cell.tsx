import { createElement as h, useState } from 'react'
import { useDockHold } from './card-hold.ts'
import { heldCardKey } from './sources.ts'
import { checkShownView, normalizeView } from 'moon-bot-contracts'
import type {
  AnswerValues,
  WidgetActions,
  WidgetCallArgs,
  RosterHook,
  CardsHook,
  ShownLike,
  WidgetNode,
} from './widget-cell-types.ts'
import { WidgetCard } from './widget-cell-nodes.tsx'

export type { AnswerValue, WidgetActions } from './widget-cell-types.ts'
export { WidgetView, WidgetCard } from './widget-cell-nodes.tsx'

export function PendingView({
  sessionId,
  view,
  actions,
  inline,
}: {
  sessionId: string
  view: ShownLike
  actions: WidgetActions
  inline: boolean
}) {
  const [answered, setAnswered] = useState<string | null>(null)
  const hold = useDockHold(sessionId, 'view', view.id, actions, inline)
  const onSubmit = (action: string | undefined, values: AnswerValues): void => {
    setAnswered(view.id)
    void actions.answerView(sessionId, view.id, action, values).catch(() => setAnswered(null))
  }
  const onDismiss = () => {
    setAnswered(view.id)
    void Promise.resolve(actions.dismissView(sessionId)).catch(() => setAnswered(null))
  }
  // Hidden, not unmounted, while the answer is on its way: if it fails the card comes
  // back with what the user had typed or picked.
  return (
    <div
      className={inline ? 'bt-q-inline' : 'bt-q-dock'}
      style={answered === view.id ? { display: 'none' } : undefined}
      onFocusCapture={hold}
      onPointerDownCapture={hold}>
      <WidgetCard
        key={view.id}
        title={view.title ?? ''}
        view={view.view}
        onSubmit={onSubmit}
        onDismiss={onDismiss}
        raised={!inline}
      />
    </div>
  )
}
// The show_view call in the transcript.
export function WidgetCell({
  sessionId,
  callId,
  args,
  done,
  isError,
  roster,
  actions,
  heldCards,
}: {
  sessionId: string
  callId: string
  args?: WidgetCallArgs | undefined
  done: boolean
  isError: boolean
  roster: {
    views?: Record<string, ShownLike | undefined> | undefined
  }
  actions: WidgetActions
  heldCards?: Record<string, number> | undefined
}) {
  const record = roster.views?.[sessionId]
  if (record !== undefined && record.callId === callId) {
    if ((heldCards?.[heldCardKey('view', record.id)] ?? 0) > 0) return null
    return <PendingView sessionId={sessionId} view={record} actions={actions} inline />
  }
  // A refused call (bad blueprint) drew no card; don't render an empty one.
  if (done && isError) return <span className='bt-q-gone' hidden />
  // Display-only cards draw from the recorded call arguments, which keep the
  // provider's encoding: unwrap it the same way the host does before storing. The
  // args accessor reads strings through `text`; `value` drops them.
  const blueprint = normalizeView(args?.value?.('view')) as WidgetNode
  const shown = checkShownView(args?.text?.('title'), blueprint)
  // A call the host refused — a blueprint it would not show, or a reply it cannot
  // wait for — leaves no card; the model's retry then stays the only one. So does
  // a settled interactive call: answered, dismissed or replaced, it leaves no gap
  // where it was (same as ask_user).
  if (shown.error !== undefined || shown.interactive || args?.value?.('await_reply') === true) {
    return <span className='bt-q-gone' hidden />
  }
  return (
    <div className='bt-q-inline'>
      <WidgetCard title={shown.title} view={blueprint} />
    </div>
  )
}
// Views asked by a call the transcript does not draw wait above the composer,
// mirroring the question dock.
export function WidgetDock({
  sessionId,
  useRoster,
  useCards,
  useHeldCards,
  actions,
}: {
  sessionId: string
  useRoster: RosterHook
  useCards?: CardsHook | undefined
  useHeldCards?: CardsHook | undefined
  actions: WidgetActions
}) {
  const view = useRoster(value => value.views?.[sessionId])
  const drawn = useCards?.(state => view?.callId !== undefined && (state[sessionId]?.[view.callId] ?? 0) > 0) === true
  const held =
    useHeldCards?.(state => view !== undefined && (state[sessionId]?.[heldCardKey('view', view.id)] ?? 0) > 0) === true
  if (view === undefined || (view.callId && drawn && !held)) return null
  return <PendingView sessionId={sessionId} view={view} actions={actions} inline={false} />
}
export { WIDGET_CSS } from './widget-cell-css.ts'

export { AnsweredView, AnsweredReply } from './widget-answered.tsx'

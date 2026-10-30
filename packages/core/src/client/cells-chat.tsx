import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from './primitives.tsx'
import { language, t } from './i18n.ts'
import { failureLabel } from './diagnostics.ts'
import { clockLabel, dayLabel } from './text.ts'
import { FOLD_HUGE, useFold } from './fold.tsx'
import { AnsweredReply } from './widget-cell.tsx'
import { Bubbles, mdLabels } from './cells-bubbles.tsx'
import type {
  ChatItem,
  ChatRowsProps,
  ChatStackedRow,
  ChatRowContext,
  EarlierPartsProps,
  EarlierUserProps,
  PartLineProps,
  EarlierView,
} from './cells-chat-types.ts'
import { SEPARATOR_GAP_MS } from './cells-chat-types.ts'
import { EventLine, GroupEvent, Shimmer } from './cells-chat-events.tsx'

export { SEPARATOR_GAP_MS } from './cells-chat-types.ts'
export type {
  ChatBotItem,
  ChatUserItem,
  ChatDividerItem,
  ChatAnswerItem,
  ChatEventItem,
  ChatErrorItem,
  ChatItem,
  ChatStackedBot,
  ChatStackedRow,
  ChatRowsProps,
  ShimmerProps,
  ElapsedProps,
} from './cells-chat-types.ts'
export {
  EventLine,
  GroupEvent,
  Shimmer,
  Elapsed,
  type EventBot,
  type EventLineProps,
  type GroupEventProps,
} from './cells-chat-events.tsx'

function PartLine({ time }: PartLineProps) {
  return (
    <div className='bt-part-line' role='separator'>
      {time !== undefined && Number.isFinite(time) ? <span>{dayLabel(time)}</span> : null}
    </div>
  )
}
const scrollParent = (node: Element | null): Element | null => {
  for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at
  }
  return null
}
function EarlierUser({ row }: EarlierUserProps) {
  const { shown, folded, control } = useFold(row.text ?? '')
  const body = row.text ? <MarkdownText text={shown} labels={mdLabels()} variant='compact' /> : null
  // A proactive message is marked, and the mark comes before the text: the user has to be
  // able to tell what they did not say before they read it.
  const mark = row.proactive === true ? <span className='bt-upmark'>{t('Brought up on its own')}</span> : null
  return (
    <div className='bt-urow' data-proactive={row.proactive === true || undefined}>
      <div className='bt-ububble' data-folded={folded || undefined}>
        {mark}
        {control ? <div className='bt-fold-body'>{body}</div> : body}
        {control}
        {row.images ? (
          <span className='bt-uimages'>
            {row.images === 1 ? t('1 image') : t('{count} images', { count: row.images })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
// The chat line a failed turn leaves: what failed, in words a person reads, and the
// model's own text under it when that says more. `failureLabel` keeps the words for a
// code; the code itself never reaches the chat.
export interface TurnErrorRowProps {
  code?: string | undefined
  text?: string | undefined
}
export function TurnErrorRow({ code, text }: TurnErrorRowProps) {
  const words = text?.trim() ?? ''
  const reason =
    code !== undefined
      ? failureLabel(code, words === '' ? undefined : words)
      : words !== ''
        ? words
        : t('Unknown error')
  // The model's own words under the sentence, when they say more. In Chinese they are
  // left out unless they are Chinese too: the sentence already says what happened.
  const more = words !== '' && words.toLowerCase() !== reason.trim().toLowerCase()
  const detail =
    more && (!language().startsWith('zh') || code === undefined || /[一-鿿]/.test(words)) ? words : undefined
  return (
    <div className='bt-turn-error' role='alert' data-code={code}>
      <span className='bt-turn-error-title'>{t('Model request failed')}</span>
      <span className='bt-turn-error-why'>{reason}</span>
      {detail !== undefined ? <span className='bt-turn-error-detail'>{detail}</span> : null}
    </div>
  )
}
// The earlier parts of a Bot's own chat, above its current part as one conversation.
// Pages load from the host as the user scrolls up; a thin line marks where each
// part begins, the last one where the current part begins.
export function EarlierParts({ sessionId, roster, actions }: EarlierPartsProps) {
  const [view, setView] = useState<EarlierView>({
    items: [],
    cursor: undefined,
    loading: true,
    failed: false,
    startedAt: undefined,
  })
  const top = useRef<HTMLDivElement | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const restore = useRef<{
    scroller: Element
    fromEnd: number
  } | null>(null)
  const load = (cursor: string | undefined): void => {
    if (busy.current) return
    busy.current = true
    setView(current => ({ ...current, loading: true, failed: false }))
    actions.earlier(sessionId, cursor).then(
      page => {
        busy.current = false
        if (!alive.current) return
        // The chat's scroller does not anchor content prepended above the viewport,
        // so the page keeps its distance from the end by hand.
        const scroller = top.current === null ? null : scrollParent(top.current)
        if (scroller) restore.current = { scroller, fromEnd: scroller.scrollHeight - scroller.scrollTop }
        setView(current => ({
          items: [...page.items, ...current.items],
          cursor: page.cursor,
          loading: false,
          failed: false,
          startedAt: page.startedAt ?? current.startedAt,
        }))
      },
      () => {
        busy.current = false
        if (alive.current) setView(current => ({ ...current, loading: false, failed: true }))
      },
    )
  }
  useEffect(() => {
    alive.current = true
    load(undefined)
    return () => {
      alive.current = false
    }
  }, [sessionId])
  useLayoutEffect(() => {
    const pending = restore.current
    restore.current = null
    if (pending) pending.scroller.scrollTop = pending.scroller.scrollHeight - pending.fromEnd
  }, [view.items])
  useEffect(() => {
    const node = top.current
    const cursor = view.cursor
    if (!node || view.loading || view.failed || cursor === undefined || typeof IntersectionObserver !== 'function')
      return undefined
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) load(cursor)
      },
      { root: scrollParent(node), rootMargin: '600px 0px 0px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [view.cursor, view.loading, view.failed])
  return (
    <div className='bt-earlier' role='feed' aria-label={t('Earlier messages')} aria-busy={view.loading}>
      <div ref={top} className='bt-earlier-top'>
        {view.loading ? (
          <Shimmer>{t('Loading earlier messages…')}</Shimmer>
        ) : view.failed ? (
          <button type='button' className='bt-soft' onClick={() => load(view.cursor)}>
            {t('Couldn’t load earlier messages · Retry')}
          </button>
        ) : view.cursor ? (
          <button type='button' className='bt-soft' onClick={() => load(view.cursor)}>
            {t('Load earlier')}
          </button>
        ) : null}
      </div>
      {h(ChatRows, { items: view.items, sessionId, roster, actions })}
      <PartLine time={view.startedAt} />
    </div>
  )
}
// A Bot chat's entries as the host lists them (the `earlier` and `chat` endpoints): the
// Bot's messages in a row are one block, and a thin line marks where a part begins.
// `clock` adds the time separators: one above the first entry, and one after each pause.
export function stackChatItems(items: readonly ChatItem[]): ChatStackedRow[] {
  const rows: ChatStackedRow[] = []
  for (const item of items) {
    const last = rows.at(-1)
    if (item.kind === 'bot' && last !== undefined && last.kind === 'bot') {
      last.texts.push(item.text)
      last.end = item.time
    } else rows.push(item.kind === 'bot' ? { kind: 'bot', texts: [item.text], time: item.time, end: item.time } : item)
  }
  return rows
}
export function ChatRows({ items, sessionId, roster, actions, useUi, clock = false }: ChatRowsProps) {
  const selfId = roster.byId[sessionId]?.id
  const rows = useMemo(() => stackChatItems(items), [items])
  let before: number | undefined
  return rows.flatMap((row, index) => {
    // Pages are prepended, so a row keeps its distance from the end.
    const key = rows.length - index
    const shown = chatRow(row, key, { sessionId, selfId, roster, actions, useUi })
    // A part's first entry shows its time under the part's line, as a chat's first one does.
    if (row.kind === 'divider') {
      before = undefined
      return [shown]
    }
    const at = row.time
    const pause =
      clock && at !== undefined && Number.isFinite(at) && (before === undefined || at - before >= SEPARATOR_GAP_MS)
    const stamp = (row.kind === 'bot' ? row.end : undefined) ?? row.time
    if (stamp !== undefined && Number.isFinite(stamp)) before = stamp
    return pause && at !== undefined
      ? [
          <div key={`${key}:clock`} className='bt-time-sep' role='separator'>
            {clockLabel(at)}
          </div>,
          shown,
        ]
      : [shown]
  })
}
// `useUi` gives a block its reactions and its Reply tool.
function chatRow(row: ChatStackedRow, key: number, { sessionId, selfId, roster, actions, useUi }: ChatRowContext) {
  switch (row.kind) {
    case 'divider':
      return <PartLine key={key} time={row.time} />
    case 'user':
      return <EarlierUser key={key} row={row} />
    case 'answer':
      return <AnsweredReply key={key} node={{ data: row }} />
    case 'bot':
      return (
        <Bubbles
          key={key}
          texts={row.texts}
          roster={roster}
          selfId={selfId}
          actions={actions}
          sessionId={useUi ? sessionId : undefined}
          msgKey={useUi ? `${sessionId}:${row.time}` : undefined}
          useUi={useUi}
          fold={FOLD_HUGE}
        />
      )
    case 'error':
      return <TurnErrorRow key={key} code={row.code} text={row.text} />
    case 'event': {
      if (row.role === 'report')
        return (
          <GroupEvent
            key={key}
            prefix={t('Replies from')}
            room={row.roomId === undefined ? undefined : roster.roomsById[row.roomId]}
            name={t('a group chat')}
            roster={roster}
            actions={actions}
          />
        )
      const known = row.botId === undefined ? undefined : roster.byId[row.botId]
      const other = known ?? { id: row.botId ?? '', name: row.name ?? t('a Bot'), color: 'gray' }
      const prefix =
        row.role === 'stopped' ? t('Stopped by') : row.role === 'reply' ? t('Reply from') : t('Message from')
      return (
        <EventLine
          key={key}
          prefix={prefix}
          bots={[other]}
          onOpen={() => {
            if (selfId && other.id) actions.openExchange(selfId, other.id)
          }}
          whole
        />
      )
    }
    default:
      return null
  }
}
/** A Bot as an event line names it: the mark, its name, and the id its chat opens by. */

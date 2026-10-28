// One conversation in the main view, drawn with the Bot views' own rows, cards and docks:
// pages from the `chat` endpoint, new entries and the reply being written from the feed.
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { call } from '../../../core/src/client/api.ts'
import { Bubbles, ChatRows, Shimmer } from '../../../core/src/client/cells.ts'
import { ComposerPlus, ComposerVoice } from '../../../core/src/client/composer.tsx'
import { t } from '../../../core/src/client/i18n.ts'
import { ArrowUpIcon } from '../../../core/src/client/icons.tsx'
import { ModelChoiceDock } from '../../../core/src/client/model-menu.tsx'
import { PendingQuestion } from '../../../core/src/client/questions.tsx'
import type { ChatItem } from '../../../core/src/client/cells-chat.tsx'
import type { ModelChoiceActions, ModelChoiceDockProps } from '../../../core/src/client/model-choice.tsx'
import { asActions, type Team } from './team.ts'
import { ActivityIndicator } from '../../../core/src/client/activity-row.tsx'
import { ComposerMenu, detectTrigger, type TriggerContext, type TriggerItem } from './composer-menu.tsx'

// The chat follows its end while the user is this close to it.
const FOLLOW_PX = 80

const textOf = (item: ChatItem): string | undefined => ('text' in item && typeof item.text === 'string' ? item.text : undefined)
const sameItem = (a: ChatItem, b: ChatItem): boolean => a.kind === b.kind && a.time === b.time && textOf(a) === textOf(b)

interface ChatPage {
  readonly sessionId: string
  readonly items: readonly ChatItem[]
  readonly cursor?: string | undefined
}

interface ChatView {
  sessionId: string | null
  items: readonly ChatItem[]
  cursor: string | null
  loading: boolean
  failed: boolean
}

interface StreamState {
  attemptId: string
  text: string
}

interface EarlyEntry {
  readonly sessionId: string
  readonly item: ChatItem
}

interface PendingEntry {
  kind: 'user'
  text: string
  time: number
}

/** The caret and text a composer's voice button works with. */
export interface InputActions {
  readonly captureInsertion: () => unknown
  readonly insertText: (text: string, insertion: unknown) => void
}

interface Insertion { readonly start: number, readonly end: number }

const insertionOf = (value: unknown): Insertion | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  const at = value as { start?: unknown, end?: unknown }
  return typeof at.start === 'number' && typeof at.end === 'number' ? { start: at.start, end: at.end } : undefined
}

function useChat(botId: string | undefined, part: string, feed: Team['chat']) {
  const [view, setView] = useState<ChatView>({ sessionId: null, items: [], cursor: null, loading: botId !== undefined, failed: false })
  const [stream, setStream] = useState<StreamState | null>(null)
  const [pending, setPending] = useState<readonly PendingEntry[]>([])
  const ready = useRef(false)
  const early = useRef<readonly EarlyEntry[]>([])
  const busy = useRef(false)
  const keep = useRef<number | null>(null)

  const load = useCallback(async (cursor: string | null | undefined, scroller?: HTMLElement | null): Promise<void> => {
    if (busy.current || botId === undefined) return
    busy.current = true
    if (cursor === undefined) ready.current = false
    setView(current => ({ ...current, loading: true, failed: false }))
    try {
      const page = await call<ChatPage>('chat', { botId, ...(cursor ? { cursor } : {}) })
      if (cursor === undefined) {
        const later = early.current.filter(entry => entry.sessionId === page.sessionId && !page.items.some(item => sameItem(item, entry.item)))
        early.current = []
        ready.current = true
        setView({ sessionId: page.sessionId, items: [...page.items, ...later.map(entry => entry.item)], cursor: page.cursor ?? null, loading: false, failed: false })
      } else {
        // Content added above the viewport would push the view down; keep its distance from the end.
        if (scroller !== null && scroller !== undefined) keep.current = scroller.scrollHeight - scroller.scrollTop
        setView(current => ({ ...current, items: [...page.items, ...current.items], cursor: page.cursor ?? null, loading: false }))
      }
    } catch {
      ready.current = cursor !== undefined || ready.current
      setView(current => ({ ...current, loading: false, failed: true }))
    } finally {
      busy.current = false
    }
  }, [botId])

  // A new part starts the chat over.
  useEffect(() => { void load(undefined) }, [load, part])

  useEffect(() => feed.on((event: string, data: Record<string, unknown>) => {
    // The feed came back after a break: entries may have been missed.
    if (event === 'hello') { if (ready.current) void load(undefined); return }
    if (botId === undefined || data.botId !== botId) return
    if (event === 'message') {
      const item = data.item as ChatItem
      if (!ready.current) { early.current = [...early.current, { sessionId: String(data.sessionId), item }]; return }
      setView(current => (data.sessionId !== current.sessionId || current.items.some(entry => sameItem(entry, item))
        ? current
        : { ...current, items: [...current.items, item] }))
      if (item.kind === 'user') {
        setPending((list) => {
          const at = list.findIndex(entry => entry.text === textOf(item))
          return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)]
        })
      }
      if (item.kind === 'bot') setStream(null)
    } else if (event === 'stream') {
      const attemptId = String(data.attemptId)
      if (data.phase === 'start') setStream({ attemptId, text: '' })
      else if (data.phase === 'end') setStream(current => (current?.attemptId === attemptId ? null : current))
      else setStream(current => (current?.attemptId === attemptId ? { ...current, text: current.text + String(data.text ?? '') } : current))
    }
  }), [feed, botId, load])

  // Shown at once: the message can come back on the feed before the request returns.
  const send = async (text: string, actions: Team['actions'], sessionId: string): Promise<void> => {
    const entry: PendingEntry = { kind: 'user', text, time: Date.now() }
    setPending(list => [...list, entry])
    actions.noteSent(sessionId)
    try {
      await actions.send(sessionId, text)
    } catch (error) {
      setPending(list => list.filter(item => item !== entry))
      throw error
    }
  }
  return { view, stream, pending, load, send, keep }
}

// What the Bot views' voice button asks of a composer: where the caret is, and text put in there.
function useInput(field: React.RefObject<HTMLTextAreaElement | null>, setText: (update: (current: string) => string) => void): InputActions {
  return useMemo(() => ({
    captureInsertion: () => (field.current ? { start: field.current.selectionStart, end: field.current.selectionEnd } : null),
    insertText: (value, insertion) => {
      const at = insertionOf(insertion)
      setText((current) => {
        const start = Math.min(at?.start ?? current.length, current.length)
        return current.slice(0, start) + value + current.slice(Math.max(start, at?.end ?? start))
      })
    },
  }), [field, setText])
}

interface ComposerProps {
  readonly sessionId: string
  readonly placeholder: string
  readonly disabled: boolean
  readonly onSend: (text: string) => Promise<void>
  readonly actions: Team['actions']
  readonly useUi: Team['hooks']['useUi']
  readonly useRoster: Team['hooks']['useRoster']
}

function Composer({ sessionId, placeholder, disabled, onSend, actions, useUi, useRoster }: ComposerProps): ReactElement {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<TriggerContext | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuItems, setMenuItems] = useState<readonly TriggerItem[]>([])
  const field = useRef<HTMLTextAreaElement>(null)
  const inputActions = useInput(field, setText)

  const updateTrigger = (newText: string, caret: number): void => {
    const next = detectTrigger(newText, caret)
    setTrigger(next)
    setDismissed(false)
    setActiveIndex(0)
  }

  const handlePick = (item: TriggerItem): void => {
    if (trigger === null) return
    if (item.onSelect) {
      item.onSelect()
      setText(current => current.slice(0, trigger.range.start) + current.slice(trigger.range.end))
    } else if (item.textToInsert) {
      const before = text.slice(0, trigger.range.start)
      const after = text.slice(trigger.range.end)
      const inserted = item.textToInsert
      const newText = before + inserted + after
      setText(newText)
      requestAnimationFrame(() => {
        const input = field.current
        if (input) {
          input.focus()
          const newPos = before.length + inserted.length
          input.setSelectionRange(newPos, newPos)
        }
      })
    }
    setTrigger(null)
  }
  useLayoutEffect(() => {
    const node = field.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${String(node.scrollHeight)}px`
  }, [text])
  useEffect(() => { if (!disabled) field.current?.focus() }, [sessionId, disabled])
  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (value === '' || disabled) return
    setError(null)
    setText('')
    try {
      await onSend(value)
    } catch (failure) {
      setText(current => (current === '' ? value : current))
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  return h('div', { className: 'dsb-composer-wrap' },
    trigger !== null && !dismissed ? h(ComposerMenu, {
      trigger,
      sessionId,
      useRoster,
      actions,
      activeIndex,
      onActiveIndexChange: setActiveIndex,
      onItemsChange: setMenuItems,
      onPick: handlePick,
      onDismiss: () => setDismissed(true),
    }) : null,
    error !== null ? h('p', { className: 'dsb-composer-error', role: 'alert' }, error) : null,
    h('div', { className: 'dsb-composer', 'data-composer-card': '', 'data-multiline': text.includes('\n') || undefined },
      h('div', { className: 'dsb-composer-tools' }, h(ComposerPlus, { sessionId, inputActions, useRoster, actions })),
      h('div', { className: 'dsb-composer-input', 'data-input-scroll': '' },
        h('textarea', {
          ref: field,
          rows: 1,
          value: text,
          disabled,
          placeholder,
          'aria-label': placeholder,
          'data-composer-input': '',
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            const val = event.target.value
            setText(val)
            updateTrigger(val, event.target.selectionStart ?? val.length)
          },
          onSelect: (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
            const target = event.target as HTMLTextAreaElement
            updateTrigger(target.value, target.selectionStart ?? target.value.length)
          },
          onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (trigger !== null && !dismissed && menuItems.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex(i => (i + 1) % menuItems.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex(i => (i - 1 + menuItems.length) % menuItems.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const selected = menuItems[activeIndex]
                if (selected) handlePick(selected)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissed(true)
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          },
        })),
      h('div', { className: 'dsb-composer-trailing' },
        h(ComposerVoice, { sessionId, inputActions, actions, useUi }),
        h('button', { type: 'button', className: 'dsb-send', disabled: disabled || text.trim() === '', 'aria-label': t('Send message'), title: t('Send message'), onClick: () => { void submit() } }, h(ArrowUpIcon)))))
}

/** One conversation in the main view. */
export function Chat({ sessionId, team }: { readonly sessionId: string, readonly team: Team }): ReactElement {
  const { actions, cellActions, cellUi, hooks, chat: feed } = team
  const roster = hooks.useRoster(value => value)
  const bot = (roster.byId as Record<string, { id: string, name?: string, waiting?: boolean } | undefined>)[sessionId]
  const name = bot?.name ?? (roster.roomsById as Record<string, { name?: string } | undefined>)[sessionId]?.name ?? ''
  const { view, stream, pending, load, send, keep } = useChat(bot?.id, sessionId, feed)
  const scroller = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const question = (roster.questions as Record<string, { id: string } | undefined> | undefined)?.[sessionId]
  const running = hooks.useSessionStatus(map => map.get(sessionId)?.running === true)

  useLayoutEffect(() => {
    const node = scroller.current
    if (node === null) return
    if (keep.current !== null) {
      node.scrollTop = node.scrollHeight - keep.current
      keep.current = null
    } else if (follow.current) node.scrollTop = node.scrollHeight
  }, [view.items, stream, pending, running, question])

  const onScroll = (): void => {
    const node = scroller.current
    if (node === null) return
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX
  }
  const earlier = view.loading && view.sessionId !== null ? h(Shimmer, null, t('Loading earlier messages…'))
    : view.failed ? h('button', { type: 'button', className: 'bt-soft', onClick: () => { void load(view.cursor, scroller.current) } }, t('Couldn’t load earlier messages · Retry'))
      : view.cursor !== null ? h('button', { type: 'button', className: 'bt-soft', onClick: () => { void load(view.cursor, scroller.current) } }, t('Load earlier')) : null
  const waiting = bot?.waiting === true

  return h('div', { className: 'dsb-chat' },
    h('div', { ref: scroller, className: 'dsb-scroll', 'data-conversation-scroll': '', onScroll },
      h('div', { className: 'dsb-column' },
        earlier !== null ? h('div', { className: 'bt-earlier-top' }, earlier) : null,
        h('div', { className: 'dsb-flow', 'data-chat-flow': '', role: 'feed', 'aria-label': name, 'aria-busy': view.loading },
          h(ChatRows, { items: view.items, sessionId, roster, actions: cellActions, useUi: cellUi, clock: true }),
          pending.length > 0 ? h('div', { className: 'dsb-pending' }, h(ChatRows, { items: pending, sessionId, roster, actions: cellActions, useUi: cellUi })) : null,
          stream !== null && stream.text !== '' ? h(Bubbles, { texts: [stream.text], roster, selfId: bot?.id, actions: cellActions, streaming: true, sessionId, useUi: cellUi }) : null,
          // The Bot views' activity row (from the header pill) draws itself in here.
          h('div', { 'data-chat-running': '' }),
          h(ActivityIndicator, {
            key: `activity:${sessionId}`,
            sessionId,
            useRoster: hooks.useRoster,
            useSessionStatus: hooks.useSessionStatus,
            useLive: hooks.useLive,
            useSession: ((<R,>(select: (state: unknown) => R): R => select(null)) as never),
            useWork: hooks.useWork as never,
            actions: { clearLive: actions.clearLive },
          }),
          question !== undefined ? h(PendingQuestion, { key: JSON.stringify([sessionId, question.id]), sessionId, question, actions, inline: true }) : null))),
    h('div', { className: 'dsb-composer-root' },
      h(ModelChoiceDock, { sessionId, useRoster: hooks.useRoster as unknown as ModelChoiceDockProps['useRoster'], actions: asActions<ModelChoiceActions>(actions) }),
      h(Composer, {
        sessionId,
        disabled: waiting,
        placeholder: waiting ? t('Pick a model and {name} can start.', { name }) : name !== '' ? t('Message {name}', { name }) : t('Message'),
        onSend: text => send(text, actions, sessionId),
        actions,
        useUi: hooks.useUi,
        useRoster: hooks.useRoster,
      })))
}

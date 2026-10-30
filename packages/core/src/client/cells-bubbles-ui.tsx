import { createElement as h, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownText } from './primitives.tsx'
import { t } from './i18n.ts'
import { linkMentions, mentionTarget } from './text.ts'
import { SmileIcon, ReplyIcon, DotsIcon, CheckIcon, DownloadIcon, CopyIcon } from './icons.tsx'
import { FOLD_AT, useFold } from './fold.tsx'
import { useMenuKeys } from './overlay-hooks.ts'
import type { BubbleProps, BubblesProps, MessageToolsProps, PopoverPlace } from './cells-bubbles-types.ts'

export const mdLabels = () => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') })
// `lead` (a sender avatar in group chats) sits beside the last bubble, in the same
// row, so it lines up with the bubble whether or not reactions hang below it.
// `fold`: past what a bubble folds (fold.js); `whole`: the last text is only the start
// of its message (see useFold).
/** The message bubbles of one turn. A caller passes only what it has: streaming, session
 * and fold props stay optional, as their defaults say.
 */
export function Bubbles({
  texts,
  roster,
  selfId,
  actions,
  streaming,
  sessionId,
  msgKey,
  useUi,
  lead,
  mentions,
  mentionBots = roster.bots,
  everyoneBots,
  fold = FOLD_AT,
  whole,
}: BubblesProps) {
  const onClick = (event: ReactMouseEvent): void => {
    const target = mentionTarget(event.nativeEvent)
    if (target === null) return
    event.preventDefault()
    event.stopPropagation()
    actions.openSession(target)
  }
  const reactions = useUi ? useUi(state => (msgKey ? (state.reactions?.[msgKey] ?? null) : null)) : null
  return (
    <div className='bt-astack' data-lead={lead ? '' : undefined} onClickCapture={onClick}>
      {texts.map((text, index) => {
        const last = index === texts.length - 1
        return (
          <Bubble
            key={index}
            text={text}
            index={index}
            roster={roster}
            selfId={selfId}
            actions={actions}
            sessionId={sessionId}
            msgKey={msgKey}
            mentions={mentions}
            mentionBots={mentionBots}
            everyoneBots={everyoneBots}
            fold={fold}
            picked={msgKey ? (reactions?.[index] ?? []) : []}
            live={streaming && last}
            lead={lead && last ? lead : null}
            whole={last ? whole : undefined}
          />
        )
      })}
    </div>
  )
}
function Bubble({
  text,
  index,
  roster,
  selfId,
  actions,
  sessionId,
  msgKey,
  mentions,
  mentionBots = roster.bots,
  everyoneBots,
  fold,
  picked,
  live,
  lead,
  whole,
}: BubbleProps) {
  const { shown, folded, control } = useFold(text, {
    limit: fold,
    ...(whole === undefined ? {} : { whole }),
    ...(live === undefined ? {} : { live }),
  })
  const key = msgKey ? `${msgKey}:${index}` : undefined
  const body = (
    <MarkdownText
      text={linkMentions(shown, mentionBots, selfId, everyoneBots)}
      streaming={live}
      labels={mdLabels()}
      variant='compact'
      fileMentions={mentions}
    />
  )
  return (
    <div className='bt-msg'>
      <div className='bt-msg-line'>
        {lead}
        <div className='bt-bubble' data-folded={folded || undefined}>
          {control ? <div className='bt-fold-body'>{body}</div> : body}
          {control}
        </div>
        {live ? null : (
          <MessageTools
            text={folded ? text : shown}
            name={(selfId === undefined ? undefined : roster.byId[selfId])?.name ?? t('Bot')}
            sessionId={sessionId}
            react={key && msgKey !== undefined ? emoji => actions.toggleReaction(msgKey, index, emoji) : undefined}
            actions={actions}
          />
        )}
      </div>
      {picked.length && msgKey !== undefined ? (
        <div className='bt-reacts'>
          {picked.map(emoji => (
            <button
              key={emoji}
              type='button'
              className='bt-react'
              aria-label={t('Remove reaction {emoji}', { emoji })}
              onClick={() => actions.toggleReaction(msgKey, index, emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
// Closes a popover on a press outside the given elements or on Escape.
function useDismiss(open: boolean, close: () => void, refs: readonly RefObject<HTMLElement | null>[]): void {
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && refs.some(ref => ref.current?.contains(target))) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        const trigger = refs[0]?.current?.querySelector<HTMLElement>('[aria-expanded="true"]')
        close()
        trigger?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
}
// The hover toolbar beside a reply bubble: Add reaction, Reply, More.
function MessageTools({ text, name, sessionId, react, actions }: MessageToolsProps) {
  const [panel, setPanel] = useState<string | null>(null)
  const [place, setPlace] = useState<PopoverPlace | null>(null)
  const [copied, setCopied] = useState(false)
  const tools = useRef<HTMLDivElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const close = (): void => setPanel(null)
  useDismiss(panel !== null, close, [tools, pop])
  useMenuKeys(pop, panel !== null)
  const open = (kind: string, event: ReactMouseEvent<HTMLElement>): void => {
    if (panel === kind) {
      close()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const below = rect.bottom + 220 < window.innerHeight
    setPlace(
      kind === 'react'
        ? { left: rect.left + rect.width / 2, top: rect.top - 6, '--bt-origin': 'bottom center' }
        : {
            left: Math.min(rect.left, window.innerWidth - 208),
            ...(below
              ? { top: rect.bottom + 4 }
              : { bottom: window.innerHeight - rect.top + 4, '--bt-origin': 'bottom left' }),
          },
    )
    setPanel(kind)
  }
  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    })
  }
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: `${name}-message.md` })
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const item = (label: string, Icon: () => ReactNode, run: () => void): ReturnType<typeof h> => (
    <button
      key={label}
      type='button'
      role='menuitem'
      onClick={() => {
        close()
        run()
      }}>
      {h(Icon)}
      {label}
    </button>
  )
  return (
    <div ref={tools} className='bt-tools' data-open={panel !== null || undefined}>
      {react ? (
        <button
          type='button'
          className='bt-tool'
          aria-label={t('Add reaction')}
          title={t('Add reaction')}
          aria-expanded={panel === 'react'}
          onClick={event => open('react', event)}>
          <SmileIcon />
        </button>
      ) : null}
      {sessionId ? (
        <button
          type='button'
          className='bt-tool'
          aria-label={t('Reply')}
          title={t('Reply')}
          onClick={() => actions.quote(sessionId, text)}>
          <ReplyIcon />
        </button>
      ) : null}
      <button
        type='button'
        className='bt-tool'
        aria-label={t('More message actions')}
        title={t('More')}
        aria-haspopup='menu'
        aria-expanded={panel === 'more'}
        onClick={event => open('more', event)}>
        {copied ? <CheckIcon /> : <DotsIcon />}
      </button>
      {panel === 'react'
        ? createPortal(
            <div
              ref={pop}
              className='bt-react-strip'
              role='menu'
              aria-label={t('Reactions')}
              style={place ?? undefined}>
              {REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  type='button'
                  role='menuitem'
                  aria-label={emoji}
                  onClick={() => {
                    close()
                    react?.(emoji)
                  }}>
                  {emoji}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {panel === 'more'
        ? createPortal(
            <div ref={pop} className='bt-menu' role='menu' aria-label={t('Message actions')} style={place ?? undefined}>
              {item(t('Copy'), CopyIcon, copy)}
              {item(t('Download'), DownloadIcon, download)}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
// One Bot message inside a group chat: avatar, name (with its group role), when it ran
// and how long it took, bubble.

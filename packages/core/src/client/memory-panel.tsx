// The memory dialog of a Bot or a group chat (`owner`: { id, name, group }): a summary
// a model writes from every saved entry, the entries themselves behind the ⋯ menu,
// and "Ask or update", one model call that answers from the entries or changes them.
// Modeled on ChatGPT's memory summary.
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useEscape, useMenuKeys } from './overlay-hooks.ts'
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DotsIcon, MemoryIcon } from './icons.tsx'
import { hostText, t } from './i18n.ts'
import { MENU_EXIT_MS, useLinger } from './motion.tsx'
import { ago, Skeleton, useNow } from './memory-time.tsx'
import type {
  MemoryEntry,
  MemoryAnswer,
  MemoryActions,
  MemoryDialogProps,
  MemoryRowProps,
} from './memory-panel-helpers.tsx'
import { useMemoryView, Summary, Entries, noteCount, Reply, counts, countListeners } from './memory-panel-helpers.tsx'
export type {
  MemoryView,
  MemoryEntry,
  MemoryChange,
  MemoryActions,
  MemoryOwner,
  MemoryDialogProps,
  MemoryRowProps,
} from './memory-panel-helpers.tsx'

export function useMemoryCount(id: string, actions: Pick<MemoryActions, 'memoryView'>): number | null {
  const [count, setCount] = useState(counts.get(id) ?? null)
  useEffect(() => {
    const listener = () => setCount(counts.get(id) ?? null)
    countListeners.add(listener)
    listener()
    let stop = false
    actions
      .memoryView?.(id)
      .then(view => {
        if (!stop) noteCount(id, view.entries.length)
      })
      .catch(() => {})
    return () => {
      stop = true
      countListeners.delete(listener)
    }
  }, [id])
  return count
}
// The details pane's row: how much the Bot or group keeps, and the way into the dialog.
export function MemoryRow({ owner, actions }: MemoryRowProps) {
  const count = useMemoryCount(owner.id, actions)
  const label =
    count === null
      ? t('Loading…')
      : count === 0
        ? t('Nothing saved yet')
        : count === 1
          ? t('1 entry')
          : t('{count} entries', { count })
  return (
    <div>
      <div className='bt-section-title'>{t('Memory')}</div>
      <button
        type='button'
        className='bt-mem-row'
        aria-label={t("Manage {name}'s memory", { name: owner.name })}
        onClick={() => actions.openMemory(owner.id)}>
        <MemoryIcon />
        <span className='bt-mem-row-copy'>{label}</span>
        <span className='bt-mem-row-go'>
          {t('Manage')}
          <ChevronRightIcon />
        </span>
      </button>
    </div>
  )
}
export function MemoryDialog({ owner, actions, leaving = false }: MemoryDialogProps) {
  const { view, error, load, show } = useMemoryView(owner.id, actions)
  const [page, setPage] = useState('summary')
  const [menu, setMenu] = useState(false)
  const [menuShown, menuLeaving] = useLinger(menu, MENU_EXIT_MS)
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const dotsRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const now = useNow(30000)
  const close = useCallback(() => actions.closeMemory(), [])
  useEscape(close)
  useEscape(() => {
    setPage('summary')
    void load({ summarize: true })
  }, page === 'entries')
  useEscape(() => {
    setMenu(false)
    dotsRef.current?.focus()
  }, menu)
  useMenuKeys(menuRef, menu)
  useEffect(() => {
    if (!menu) return undefined
    const onDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || dotsRef.current?.contains(event.target as Node)) return
      setMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('mousedown', onDown)
    }
  }, [menu])
  const regenerate = () => {
    setMenu(false)
    setPage('summary')
    void load({ regenerate: true })
  }
  const openEntries = () => {
    setMenu(false)
    setPage('entries')
  }
  const backToSummary = () => {
    setPage('summary')
    void load({ summarize: true })
  }
  const remove = async (entry: MemoryEntry): Promise<boolean> => {
    try {
      show(await actions.memoryForget(owner.id, entry))
      return true
    } catch (failure) {
      setAnswer({
        asked: entry.text,
        error:
          (
            failure as {
              message?: string
            } | null
          )?.message ?? String(failure),
      })
      return false
    }
  }
  const ask = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const asked = text.trim()
    if (asked === '' || answer?.pending) return
    setText('')
    setAnswer({ asked, pending: true })
    try {
      const result = await actions.memoryAsk(owner.id, asked)
      setAnswer({ asked, reply: result.reply, changes: result.changes })
      show(result.view)
      if (result.changes.some(change => change.ok)) void load({ summarize: page === 'summary' })
    } catch (failure) {
      setAnswer({
        asked,
        error:
          (
            failure as {
              message?: string
            } | null
          )?.message ?? String(failure),
      })
    }
    inputRef.current?.focus()
  }
  const count = view?.entries.length ?? 0
  const when = view?.summary ? ago(view.summary.at, now) : null
  const status =
    view === null
      ? ''
      : page === 'entries'
        ? count === 1
          ? t('1 entry')
          : t('{count} entries', { count })
        : view.summarizing && view.summary
          ? t('Updating…')
          : view.summary && view.fresh
            ? when
              ? t('Updated {time}', { time: when })
              : t('Updated just now')
            : ''
  const busy = answer?.pending === true
  return (
    <div className='bt-mem-layer' data-leaving={leaving || undefined}>
      <div className='bt-scrim bt-mem-scrim' onMouseDown={close} />
      <div className='bt-mem' role='dialog' aria-modal aria-label={t("{name}'s memory", { name: owner.name })}>
        <div className='bt-mem-head'>
          {page === 'entries' ? (
            <button type='button' className='bt-icon-btn' aria-label={t('Back to the summary')} onClick={backToSummary}>
              <ChevronLeftIcon />
            </button>
          ) : null}
          <h2>{page === 'entries' ? t('All entries') : t('Memory summary')}</h2>
          <span className='bt-mem-status'>
            {page === 'summary' ? [owner.name, status].filter(Boolean).join(' · ') : status}
          </span>
          <span className='bt-mem-head-gap' />
          <button
            ref={dotsRef}
            type='button'
            className='bt-icon-btn'
            aria-label={t('Memory options')}
            aria-haspopup='menu'
            aria-expanded={menu}
            onClick={() => setMenu(value => !value)}>
            <DotsIcon />
          </button>
          <button type='button' className='bt-icon-btn' aria-label={t('Close memory')} onClick={close}>
            <CloseIcon />
          </button>
          {menuShown ? (
            <div
              ref={menuRef}
              className='bt-menu bt-mem-menu'
              role='menu'
              aria-label={t('Memory options')}
              data-leaving={menuLeaving || undefined}>
              <button type='button' role='menuitem' onClick={openEntries}>
                <span className='bt-menu-label'>{t('All entries')}</span>
                <span className='bt-menu-hint'>{String(count)}</span>
              </button>
              <button type='button' role='menuitem' disabled={count === 0 || view?.summarizing} onClick={regenerate}>
                <span className='bt-menu-label'>{t('Regenerate summary')}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className='bt-mem-body'>
          {error ? (
            <div className='bt-error' role='alert' style={{ padding: 0 }}>
              {hostText(error)}
            </div>
          ) : null}
          {view === null ? (
            error ? null : (
              <Skeleton />
            )
          ) : page === 'entries' ? (
            <Entries owner={owner} view={view} remove={remove} />
          ) : (
            <Summary owner={owner} view={view} regenerate={regenerate} />
          )}
        </div>
        <div className='bt-mem-foot'>
          {answer ? <Reply answer={answer} dismiss={() => setAnswer(null)} /> : null}
          <form className='bt-mem-ask' onSubmit={ask}>
            <input
              ref={inputRef}
              className='bt-mem-input'
              value={text}
              maxLength={2000}
              disabled={view === null}
              placeholder={t('Ask or update')}
              aria-label={t("Ask about or update {name}'s memory", { name: owner.name })}
              onChange={event => setText(event.target.value)}
            />
            <button type='submit' className='bt-mem-send' disabled={busy || text.trim() === ''} aria-label={t('Send')}>
              {busy ? <span className='bt-mem-spin' aria-hidden /> : <ArrowUpIcon />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

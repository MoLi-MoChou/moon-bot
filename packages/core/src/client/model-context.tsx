import { createElement as h, useEffect, useState } from 'react'
import { hostText, t } from './i18n.ts'
import { formatTokens } from './text.ts'

export interface ContextPressure {
  contextWindow?: number | undefined
  projectedTokens?: number | undefined
  pressureTokens?: number | undefined
}
export interface ContextValues {
  contextPressure?: ContextPressure | undefined
}
export interface ContextUsage {
  used: number
  total: number
  ratio: number
}
// Moon Bot: how much of the model's context the Bot's chat uses, as a ring and a line at
// the top of its model menu (after open-claude-ui's token gauge, MIT).
export function contextOf(values: ContextValues | null | undefined): ContextUsage | undefined {
  const pressure = values?.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const total = pressure?.contextWindow
  if (typeof used !== 'number' || !Number.isFinite(used) || total === undefined || !(total > 0)) return undefined
  return { used, total, ratio: Math.min(1, used / total) }
}
export function ContextGauge({ context }: { context: ContextUsage }) {
  const r = 7
  const length = 2 * Math.PI * r
  const tone = context.ratio >= 0.9 ? 'high' : context.ratio >= 0.7 ? 'mid' : 'low'
  return (
    <div
      className='bt-ctx'
      data-tone={tone}
      role='status'
      title={t('{used} of {total} tokens of context in use', {
        used: formatTokens(context.used),
        total: formatTokens(context.total),
      })}>
      <svg width={18} height={18} viewBox='0 0 18 18' aria-hidden>
        <circle cx={9} cy={9} r={r} fill='none' stroke='currentColor' strokeOpacity={0.15} strokeWidth={2} />
        <circle
          className='bt-ctx-arc'
          cx={9}
          cy={9}
          r={r}
          fill='none'
          stroke='currentColor'
          strokeWidth={2}
          strokeLinecap='round'
          strokeDasharray={length}
          strokeDashoffset={length * (1 - context.ratio)}
          transform='rotate(-90 9 9)'
        />
      </svg>
      <span key={Math.round(context.ratio * 100)} className='bt-ctx-pct'>
        {t('Context {percent}%', { percent: Math.round(context.ratio * 100) })}
      </span>
      <span className='bt-ctx-n'>{`${formatTokens(context.used)} / ${formatTokens(context.total)}`}</span>
    </div>
  )
}
export function useContext(
  botId: string,
  isOpen: boolean,
  actions: { runStats?: ((botId: string) => Promise<ContextValues | undefined>) | undefined },
): ContextUsage | undefined {
  const [context, setContext] = useState<ContextUsage | undefined>(undefined)
  useEffect(() => {
    if (!isOpen || actions?.runStats === undefined || !botId || botId === 'new-bot') return undefined
    let live = true
    void actions.runStats(botId).then(
      values => {
        if (live) setContext(contextOf(values))
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [botId, isOpen])
  return context
}
export interface CompactResult {
  readonly compacted: boolean
  readonly reason?: string | undefined
}
// Asks the host to condense this Bot's current part. The host's sentence is the note.
export function CompactChat({
  botId,
  compact,
}: {
  botId: string
  compact?: ((botId: string) => Promise<CompactResult>) | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  if (compact === undefined || botId === '' || botId === 'new-bot') return null
  const run = (): void => {
    setBusy(true)
    setNote(undefined)
    void compact(botId).then(
      result => {
        setBusy(false)
        setNote(
          result.compacted
            ? t('This chat was condensed.')
            : hostText(result.reason ?? 'Condensing this chat did not make room.'),
        )
      },
      () => {
        setBusy(false)
        setNote(hostText('Condensing this chat did not make room.'))
      },
    )
  }
  return (
    <div className='bt-ctx-act'>
      {note ? <span role='status'>{note}</span> : null}
      <button type='button' disabled={busy} onClick={run}>
        {busy ? t('Condensing…') : t('Condense this chat')}
      </button>
    </div>
  )
}

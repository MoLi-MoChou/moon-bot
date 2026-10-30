import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, RefObject } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.tsx'
import { t } from './i18n.ts'
import { DAY_MS, HOUR, dayKey, hourMs, mondayOf, tokensOf } from './usage-data.ts'
import type { UsageRow } from './usage-data.ts'
import type { UsagePageView } from './usage-page-types.ts'
import { HEAT_WEEKS } from './usage-page-types.ts'
import { dates, daysText, full, soften, spanText, yearOf } from './usage-helpers.tsx'

export const monthOf = (ms: number): number => Date.UTC(yearOf(ms), new Date(ms).getUTCMonth(), 1)
export const addMonths = (ms: number, count: number): number =>
  Date.UTC(yearOf(ms), new Date(ms).getUTCMonth() + count, 1)
export interface Span {
  readonly from: string
  readonly to: string
}
export interface SpanPickerProps {
  span: Span | null
  today: string
  oldest: number
  active: ReadonlySet<string>
  near: RefObject<HTMLElement | null>
  onPick: (from: string, to: string) => void
  onClose: () => void
}
// Two months of days under the time range. The first press picks one end of the span,
// the second the other; days with usage carry a dot.
export function SpanPicker({ span, today, oldest, active, near, onPick, onClose }: SpanPickerProps): ReactElement {
  const box = useRef<HTMLDivElement | null>(null)
  const todayMs = hourMs(today)
  const thisMonth = monthOf(todayMs)
  const [right, setRight] = useState<number>(() => Math.max(addMonths(oldest, 1), monthOf(hourMs(span?.to ?? today))))
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || ![box, near].some(ref => ref.current?.contains(target))) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
  let low: string | null = null
  let high: string | null = null
  if (anchor) {
    low = hover !== null && hover < anchor ? hover : anchor
    high = hover !== null && hover > anchor ? hover : anchor
  } else if (span) {
    low = span.from
    high = span.to
  }
  const press = (key: string): void => {
    if (!anchor) {
      setAnchor(key)
      return
    }
    const from = anchor < key ? anchor : key
    const to = anchor < key ? key : anchor
    onPick(from, to)
  }
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, at) => dates({ weekday: 'narrow' }).format(Date.UTC(2024, 0, 1 + at))),
    [],
  )
  const month = (start: number, side: 'left' | 'right'): ReactElement => {
    const length = new Date(addMonths(start, 1) - DAY_MS).getUTCDate()
    const lead = (new Date(start).getUTCDay() + 6) % 7
    const cells: ReactElement[] = Array.from({ length: lead }, (_, at) => <span key={`b${at}`} />)
    for (let day = 1; day <= length; day += 1) {
      const ms = start + (day - 1) * DAY_MS
      const key = dayKey(ms)
      const weekday = (lead + day - 1) % 7
      const flag = (on: boolean): '' | undefined => (on ? '' : undefined)
      cells.push(
        <button
          key={key}
          type='button'
          className='bt-us-day'
          disabled={ms > todayMs}
          aria-label={dates({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(ms)}
          aria-pressed={key === low || key === high}
          data-in={flag(low !== null && high !== null && key >= low && high >= key)}
          data-start={flag(key === low)}
          data-end={flag(key === high)}
          data-l={flag(weekday === 0 || day === 1)}
          data-r={flag(weekday === 6 || day === length)}
          data-today={flag(key === today)}
          data-has={flag(active.has(key))}
          onMouseEnter={() => setHover(key)}
          onClick={() => press(key)}>
          <b>{day}</b>
        </button>,
      )
    }
    const nav =
      side === 'left' ? (
        <button
          type='button'
          className='bt-us-month-nav'
          data-side='left'
          aria-label={t('Previous month')}
          disabled={start <= oldest}
          onClick={() => setRight(addMonths(right, -1))}>
          <ChevronLeftIcon />
        </button>
      ) : (
        <button
          type='button'
          className='bt-us-month-nav'
          data-side='right'
          aria-label={t('Next month')}
          disabled={start >= thisMonth}
          onClick={() => setRight(addMonths(right, 1))}>
          <ChevronRightIcon />
        </button>
      )
    return (
      <div key={start} className='bt-us-month'>
        <div className='bt-us-month-head'>
          {nav}
          <span>{dates({ year: 'numeric', month: 'long' }).format(start)}</span>
        </div>
        <div className='bt-us-weekdays' aria-hidden>
          {weekdays.map((name, at) => (
            <span key={at}>{name}</span>
          ))}
        </div>
        <div className='bt-us-days' onMouseLeave={() => setHover(null)}>
          {cells}
        </div>
      </div>
    )
  }
  const shortcuts: [string, string, string, string][] = [
    ['month', t('This month'), dayKey(thisMonth), today],
    ['last', t('Last month'), dayKey(addMonths(thisMonth, -1)), dayKey(thisMonth - DAY_MS)],
    ['year', t('This year'), `${today.slice(0, 4)}-01-01`, today],
  ]
  const count = low === null || high === null ? 0 : Math.round((hourMs(high) - hourMs(low)) / DAY_MS) + 1
  return (
    <div ref={box} className='bt-us-pick' role='dialog' aria-label={t('Custom range')}>
      <div className='bt-us-pick-quick'>
        {shortcuts.map(([id, label, from, to]) => (
          <button
            key={id}
            type='button'
            aria-pressed={span?.from === from && span?.to === to}
            onClick={() => onPick(from, to)}>
            {label}
          </button>
        ))}
      </div>
      <div className='bt-us-pick-months'>
        {month(addMonths(right, -1), 'left')}
        {month(right, 'right')}
      </div>
      <div className='bt-us-pick-foot' role='status'>
        <span>{anchor ? t('Pick the last day') : t('Pick the first day')}</span>
        {low === null || high === null ? null : (
          <span>
            <b>{spanText(low, high)}</b>
            {` · ${daysText(count)}`}
          </span>
        )}
      </div>
    </div>
  )
}
export interface HeatProps {
  view: UsagePageView
  keep: (row: UsageRow) => boolean
  paint: string
  index: number
}
// Each day of the last year, shaded by its tokens.
export function Heat({ view, keep, paint, index }: HeatProps): ReactElement {
  const [hover, setHover] = useState<{
    ms: number
    week: number
    day: number
  } | null>(null)
  const today = hourMs(`${view.now.slice(0, 10)} 00`)
  const first = mondayOf(today) - (HEAT_WEEKS - 1) * 7 * DAY_MS
  const from = dayKey(first)
  const daily = new Map<string, number>()
  for (const row of view.rows) {
    const day = row[HOUR].slice(0, 10)
    if (day >= from && keep(row)) daily.set(day, (daily.get(day) ?? 0) + tokensOf(row))
  }
  const most = Math.max(0, ...daily.values())
  const levels = [0.3, 0.52, 0.76, 1]
  const months: ReactElement[] = []
  const cells: ReactElement[] = []
  for (let week = 0; week < HEAT_WEEKS; week += 1) {
    const monday = first + week * 7 * DAY_MS
    if (week > 0 && new Date(monday).getUTCMonth() !== new Date(monday - 7 * DAY_MS).getUTCMonth()) {
      months.push(
        <span key={week} style={{ gridColumn: week + 1 }}>
          {dates({ month: 'short' }).format(monday)}
        </span>,
      )
    }
    for (let day = 0; day < 7; day += 1) {
      const ms = monday + day * DAY_MS
      const value = daily.get(dayKey(ms)) ?? 0
      const level = value > 0 ? Math.max(1, Math.ceil(4 * Math.sqrt(value / most))) : 0
      cells.push(
        <span
          key={ms}
          className='bt-us-cell'
          style={{ '--w': week }}
          data-on={hover?.ms === ms ? '' : undefined}
          data-future={ms > today ? '' : undefined}
          data-today={ms === today ? '' : undefined}
          onMouseEnter={ms > today ? undefined : () => setHover({ ms, week, day })}>
          {level > 0 ? <i style={{ background: soften(paint, levels[level - 1]) }} /> : null}
        </span>,
      )
    }
  }
  const tipSide: CSSProperties | undefined = hover
    ? {
        ...(hover.week >= HEAT_WEEKS / 2
          ? { right: `calc(${((HEAT_WEEKS - hover.week) / HEAT_WEEKS) * 100}% + 8px)` }
          : { left: `calc(${((hover.week + 1) / HEAT_WEEKS) * 100}% + 8px)` }),
        ...(hover.day < 4
          ? { top: `calc(${(hover.day / 7) * 100}% - 2px)` }
          : { top: 'auto', bottom: `calc(${((6 - hover.day) / 7) * 100}% - 2px)` }),
      }
    : undefined
  const active = [...daily.values()].filter(value => value > 0).length
  const summary =
    active === 1
      ? t('Active on 1 day in the last year')
      : t('Active on {count} days in the last year', { count: active })
  return (
    <section className='bt-us-card bt-us-heat' style={{ '--i': index }}>
      <div className='bt-us-card-head'>
        <h3>{t('Activity')}</h3>
        <span className='bt-us-head-note'>{summary}</span>
      </div>
      <div className='bt-us-heat-months' aria-hidden>
        {months}
      </div>
      <div className='bt-us-heat-plot' onMouseLeave={() => setHover(null)}>
        <div className='bt-us-heat-grid' role='img' aria-label={summary}>
          {cells}
        </div>
        {hover ? (
          <div className='bt-us-tip bt-us-heat-tip' style={tipSide}>
            <div className='bt-us-tip-title'>
              {dates({ month: 'long', day: 'numeric', weekday: 'short' }).format(hover.ms)}
            </div>
            <div className='bt-us-tip-total'>
              {t('{count} tokens', { count: full(daily.get(dayKey(hover.ms)) ?? 0) })}
            </div>
          </div>
        ) : null}
      </div>
      <div className='bt-us-heat-scale' aria-hidden>
        {t('Light')}
        {levels.map(level => (
          <span key={level} className='bt-us-cell'>
            <i style={{ background: soften(paint, level) }} />
          </span>
        ))}
        {t('Heavy')}
      </div>
    </section>
  )
}
export function Skeleton(): ReactElement {
  return (
    <div className='bt-us' aria-busy>
      <div className='bt-us-skel' style={{ height: 32, width: 320, borderRadius: 999 }} />
      <div className='bt-us-sheet bt-us-skel-sheet'>
        <div className='bt-us-skel' style={{ height: 94 }} />
        <div className='bt-us-skel' style={{ height: 318 }} />
        <div className='bt-us-pair'>
          <div className='bt-us-skel' style={{ height: 200 }} />
          <div className='bt-us-skel' style={{ height: 200 }} />
        </div>
      </div>
    </div>
  )
}

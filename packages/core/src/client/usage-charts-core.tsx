import { Fragment, createElement as h, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { t } from './i18n.ts'
import { compact, percent } from './usage-data.ts'
import type { UsageSum } from './usage-data.ts'
import type { Face } from './usage-helpers.tsx'
import type { PageRange, UsageFocus } from './usage-page-types.ts'
import { RING, RING_R } from './usage-page-types.ts'
import { Tabs, full, niceTop, rangeLabel, spanText, unitLabel } from './usage-helpers.tsx'

export type StackPart = readonly [key: string, value: number]
export interface ChartColumn {
  readonly key: string
  readonly tick: string
  readonly title: string
  readonly total: number
  readonly parts: StackPart[]
  readonly tip: StackPart[]
}
export interface ChartSeries {
  readonly key: string
  readonly name: string | undefined
  fill?: string | undefined
  readonly pick?: UsageFocus | undefined
}
export interface ChartProps {
  range: PageRange
  columns: ChartColumn[]
  series: ChartSeries[]
  tipSeries: ChartSeries[]
  by?: string | undefined
  onBy?: ((value: string) => void) | undefined
  onPick?: ((pick: UsageFocus) => void) | undefined
}
// Stacked bars, one per bucket, each stack a column of rounded pieces. Hovering a bar
// dims the others and lists its `tip` rows (named by `tipSeries`) beside it.
export function Chart({ range, columns, series, tipSeries, by, onBy, onPick }: ChartProps): ReactElement {
  const [hover, setHover] = useState<number | null>(null)
  const top = niceTop(Math.max(0, ...columns.map(column => column.total)))
  const count = columns.length
  const fillOf = new Map(series.map(entry => [entry.key, entry.fill]))
  const tipOf = new Map(tipSeries.map(entry => [entry.key, entry]))
  const tip = hover === null ? null : columns[hover]
  const tipSide: CSSProperties =
    hover === null
      ? {}
      : hover >= count / 2
        ? { right: `calc(${((count - hover) / count) * 100}% + 8px)` }
        : { left: `calc(${((hover + 1) / count) * 100}% + 8px)` }
  return (
    <section className='bt-us-card bt-us-chart' style={{ '--i': 1 }}>
      <div className='bt-us-card-head'>
        <h3>
          {t('Tokens over time')}
          <span>{unitLabel(range.unit)}</span>
        </h3>
        {onBy ? (
          <Tabs
            label={t('Group usage by')}
            value={by ?? ''}
            onChange={onBy}
            options={[
              ['bot', t('By Bot')],
              ['model', t('By model')],
            ]}
          />
        ) : null}
      </div>
      <div className='bt-us-chart-body'>
        <div className='bt-us-plot' data-hover={hover === null ? undefined : ''} onMouseLeave={() => setHover(null)}>
          {[1, 0.5].map(level => (
            <div key={level} className='bt-us-grid' style={{ bottom: `${level * 100}%` }}>
              <span>{compact(top * level)}</span>
            </div>
          ))}
          <div className='bt-us-grid bt-us-base' style={{ bottom: 0 }}>
            <span>0</span>
          </div>
          <div className='bt-us-cols'>
            {columns.map((column, at) => (
              <div
                key={`${range.from ? `${range.from}~${range.to}` : range.id}:${column.key}`}
                className='bt-us-col'
                data-on={hover === at ? '' : undefined}
                onMouseEnter={() => setHover(at)}>
                {column.total > 0 ? (
                  <div className='bt-us-stack' style={{ height: `${(column.total / top) * 100}%`, '--i': at }}>
                    {column.parts.map(([key, value]) =>
                      value > 0 ? <i key={key} style={{ flexGrow: value, background: fillOf.get(key) }} /> : null,
                    )}
                  </div>
                ) : (
                  <div className='bt-us-stub' />
                )}
              </div>
            ))}
          </div>
          {tip ? (
            <div className='bt-us-tip' style={tipSide}>
              <div className='bt-us-tip-title'>{tip.title}</div>
              <div className='bt-us-tip-total'>{t('{count} tokens', { count: full(tip.total) })}</div>
              {tip.tip
                .filter(([, value]) => value > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([key, value]) => (
                  <div key={key} className='bt-us-tip-row'>
                    <i className='bt-us-dot' style={{ background: tipOf.get(key)?.fill }} />
                    <span>{tipOf.get(key)?.name}</span>
                    <b>{compact(value)}</b>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
        <div className='bt-us-ticks' aria-hidden>
          {
            // A preset counts its labels back from now; a picked span forward from its first day.
            columns.map((column, at) => (
              <span key={column.key} data-now={at === count - 1 && range.ends !== false ? '' : undefined}>
                {(range.from ? at : count - 1 - at) % range.stride === 0 ? column.tick : ''}
              </span>
            ))
          }
        </div>
      </div>
      {series.length > 1 || series[0]?.pick ? (
        <div className='bt-us-legend'>
          {series.map(entry =>
            entry.pick ? (
              <button key={entry.key} type='button' className='bt-us-key' onClick={() => onPick?.(entry.pick!)}>
                <i className='bt-us-dot' style={{ background: entry.fill }} />
                {entry.name}
              </button>
            ) : (
              <span key={entry.key} className='bt-us-key'>
                <i className='bt-us-dot' style={{ background: entry.fill }} />
                {entry.name}
              </span>
            ),
          )}
        </div>
      ) : null}
    </section>
  )
}
export interface RowProps {
  kind?: string | undefined
  glyph?: ReactNode
  name: ReactNode
  sub?: ReactNode
  sum: UsageSum
  whole: number
  fill?: string | undefined
  index: number
  onClick?: (() => void) | undefined
}
export function Row({ kind, glyph, name, sub, sum, whole, fill, index, onClick }: RowProps): ReactElement {
  const width = whole > 0 ? Math.max(sum.total > 0 ? 2 : 0, (sum.total / whole) * 100) : 0
  const title = t('{tokens} tokens · {calls} calls', { tokens: full(sum.total), calls: full(sum.calls) })
  const style = { '--i': index }
  const body = (
    <>
      {glyph ? <span className='bt-us-row-glyph'>{glyph}</span> : null}
      <span className='bt-us-row-body'>
        <span className='bt-us-row-line'>
          <span className='bt-us-row-name'>{name}</span>
          {sub ? <span className='bt-us-row-sub'>{sub}</span> : null}
        </span>
        <span className='bt-us-track'>
          <span style={{ width: `${width}%`, background: fill }} />
        </span>
      </span>
      <span className='bt-us-row-num'>
        <b>{compact(sum.total)}</b>
        <small>{`${percent(sum.total, whole)}%`}</small>
      </span>
    </>
  )
  return onClick ? (
    <button type='button' className='bt-us-row' data-kind={kind} style={style} title={title} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className='bt-us-row' data-kind={kind} style={style} title={title}>
      {body}
    </div>
  )
}
export interface ListCardProps {
  title: ReactNode
  count?: ReactNode
  index: number
  children?: ReactNode
}
export function ListCard({ title, count, index, children }: ListCardProps): ReactElement {
  return (
    <section className='bt-us-card' style={{ '--i': index }}>
      <div className='bt-us-card-head'>
        <h3>
          {title}
          {count === undefined ? null : <span>{count}</span>}
        </h3>
      </div>
      <div className='bt-us-rows'>{children}</div>
    </section>
  )
}
export interface ProfileProps {
  face: Face
  share: number
  range: PageRange
}
// One Bot, group chat, or model: its face inside a ring as long as its share of the range.
export function Profile({ face, share, range }: ProfileProps): ReactElement {
  const arc = Math.max(0, Math.min(1, share)) * RING
  return (
    <section className='bt-us-profile'>
      <span className='bt-us-ring'>
        <svg viewBox='0 0 96 96' aria-hidden>
          {face.stops ? (
            <defs>
              <linearGradient id='bt-us-ring-paint' x1={0} y1={1} x2={1} y2={0}>
                {face.stops.map(([offset, color]) => (
                  <stop key={offset} offset={offset} stopColor={color} />
                ))}
              </linearGradient>
            </defs>
          ) : null}
          <circle className='bt-us-ring-track' cx={48} cy={48} r={RING_R} />
          {arc > 0 ? (
            <circle
              className='bt-us-ring-arc'
              cx={48}
              cy={48}
              r={RING_R}
              style={{ stroke: face.stops ? 'url(#bt-us-ring-paint)' : face.paint, strokeDasharray: `${arc} ${RING}` }}
            />
          ) : null}
        </svg>
        <span className='bt-us-ring-face'>{face.glyph(64)}</span>
      </span>
      <div className='bt-us-profile-copy'>
        <h3>{face.name}</h3>
        {face.sub ? <span className='bt-us-profile-sub'>{face.sub}</span> : null}
        <span className='bt-us-profile-share'>
          {range.from
            ? t('{share}% of all usage from {span}', {
                share: percent(share, 1),
                span: spanText(range.from, range.to!),
              })
            : t('{share}% of all usage in the last {range}', { share: percent(share, 1), range: rangeLabel(range.id) })}
        </span>
      </div>
    </section>
  )
}

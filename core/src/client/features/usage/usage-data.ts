// The Usage page's numbers: the host's hourly rows, summed by hour, day, week, or month.

// A view row: [hour, owner, model, kind, input, cacheRead, cacheWrite, output, calls].
export const HOUR = 0
export const OWNER = 1
export const MODEL = 2
export const KIND = 3

export type UsageRow = readonly [
  hour: string, owner: string, model: string, kind: string,
  input: number, cacheRead: number, cacheWrite: number, output: number, calls: number,
]

export type UsageUnit = 'hour' | 'day' | 'week' | 'month'

export interface UsageRange {
  readonly id: string
  readonly unit: UsageUnit
  readonly count: number
  readonly stride: number
  readonly from?: string
  readonly to?: string
  readonly days?: number
}

export interface UsageBucket {
  readonly start: number
  readonly end?: number
  readonly key: string
}

export interface UsageView {
  readonly now: string
  readonly rows: readonly UsageRow[]
}

export interface UsageSum {
  input: number
  cacheRead: number
  output: number
  calls: number
  total: number
}

export interface UsageBucketSum extends UsageBucket {
  readonly sum: UsageSum
  readonly stacks: Map<string, number>
}

export interface UsageSummary {
  readonly buckets: readonly UsageBucketSum[]
  readonly total: UsageSum
  previous: number
  readonly owners: Map<string, UsageSum>
  readonly models: Map<string, UsageSum>
  readonly kinds: Map<string, UsageSum>
}

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

// `stride`: every how many buckets the time axis prints a label, counted back from now.
export const RANGES: readonly UsageRange[] = [
  { id: '24h', unit: 'hour', count: 24, stride: 6 },
  { id: '7d', unit: 'day', count: 7, stride: 1 },
  { id: '30d', unit: 'day', count: 30, stride: 5 },
  { id: '12w', unit: 'week', count: 12, stride: 2 },
  { id: '12m', unit: 'month', count: 12, stride: 1 },
]

// Hour keys are wall-clock times in the browser's zone. Reading them as UTC keeps every
// calendar step exact, whatever the zone's daylight saving does.
export const hourMs = (key: string): number => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), Number(key.slice(11, 13)) || 0)
export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const hourKey = (ms: number): string => new Date(ms).toISOString().slice(0, 13).replace('T', ' ')
// Weeks start on Monday.
export const mondayOf = (ms: number): number => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS

// A span of whole days the user picks, `from` to `to` inclusive, as day keys. The unit
// keeps the bars between about 7 and 60.
export function spanRange(from: string, to: string): UsageRange {
  if (to < from) [from, to] = [to, from]
  const days = Math.round((hourMs(to) - hourMs(from)) / DAY_MS) + 1
  const unit: UsageUnit = days <= 2 ? 'hour' : days <= 62 ? 'day' : days <= 182 ? 'week' : 'month'
  const range: UsageRange = { id: 'custom', unit, from, to, days, count: 0, stride: 1 }
  const count = spanBuckets(range).length
  const stride = unit === 'hour' ? 6 : [1, 2, 3, 5, 7, 10, 14].find(step => count / step <= 12) ?? Math.ceil(count / 12)
  return { ...range, count, stride }
}

// A picked span's buckets. The first and last week or month are cut to the span, so a
// bucket's `end` (exclusive) can fall before the calendar's.
function spanBuckets(range: UsageRange): UsageBucket[] {
  const first = hourMs(range.from ?? '')
  const end = hourMs(range.to ?? '') + DAY_MS
  const buckets: UsageBucket[] = []
  if (range.unit === 'hour' || range.unit === 'day') {
    const step = range.unit === 'hour' ? HOUR_MS : DAY_MS
    for (let start = first; start < end; start += step) buckets.push({ start, end: start + step, key: range.unit === 'hour' ? hourKey(start) : dayKey(start) })
  } else if (range.unit === 'week') {
    for (let monday = mondayOf(first); monday < end; monday += 7 * DAY_MS) {
      buckets.push({ start: Math.max(monday, first), end: Math.min(monday + 7 * DAY_MS, end), key: dayKey(monday) })
    }
  } else {
    const year = new Date(first).getUTCFullYear()
    for (let month = new Date(first).getUTCMonth(); Date.UTC(year, month, 1) < end; month += 1) {
      const start = Date.UTC(year, month, 1)
      buckets.push({ start: Math.max(start, first), end: Math.min(Date.UTC(year, month + 1, 1), end), key: dayKey(start).slice(0, 7) })
    }
  }
  return buckets
}

export interface UsageSpan {
  readonly buckets: readonly UsageBucket[]
  readonly from: string
  readonly to: string
  readonly before: string
}

// The range's buckets, oldest first, and the hour keys that bound it: `from` and `to`
// for the range itself, `before` for the same span just before it.
export function spanOf(range: UsageRange, now: string): UsageSpan {
  if (range.from !== undefined) {
    return { buckets: spanBuckets(range), from: `${range.from} 00`, to: `${range.to ?? ''} 23`, before: hourKey(hourMs(range.from) - (range.days ?? 0) * DAY_MS) }
  }
  const buckets = bucketsOf(range, now)
  const start = buckets[range.count] ?? buckets[buckets.length - 1] as UsageBucket
  return { buckets: buckets.slice(range.count), from: hourKey(start.start), to: now, before: hourKey(buckets[0]?.start ?? start.start) }
}

// The range's buckets, oldest first, after as many before them for the comparison.
export function bucketsOf(range: UsageRange, now: string): UsageBucket[] {
  const end = hourMs(now)
  const today = end - (end % DAY_MS)
  const buckets: UsageBucket[] = []
  for (let back = range.count * 2 - 1; back >= 0; back -= 1) {
    let start: number
    if (range.unit === 'hour') start = end - back * HOUR_MS
    else if (range.unit === 'day') start = today - back * DAY_MS
    else if (range.unit === 'week') start = mondayOf(today) - back * 7 * DAY_MS
    else start = Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth() - back, 1)
    buckets.push({ start, key: range.unit === 'hour' ? hourKey(start) : range.unit === 'month' ? dayKey(start).slice(0, 7) : dayKey(start) })
  }
  return buckets
}

export const tokensOf = (row: UsageRow): number => row[4] + row[5] + row[6] + row[7]
const blank = (): UsageSum => ({ input: 0, cacheRead: 0, output: 0, calls: 0, total: 0 })
// Cache writes are billed as input, so they show as input.
function addRow(sum: UsageSum, row: UsageRow): UsageSum {
  sum.input += row[4] + row[6]
  sum.cacheRead += row[5]
  sum.output += row[7]
  sum.calls += row[8]
  sum.total += tokensOf(row)
  return sum
}
function addTo(map: Map<string, UsageSum>, key: string, row: UsageRow): void {
  map.set(key, addRow(map.get(key) ?? blank(), row))
}

// One range of the view, narrowed by `keep`. `seriesOf` names the stack a row joins in
// its bucket's bar. `previous` is the total of the same span just before the range.
export function summarize(
  view: UsageView,
  range: UsageRange,
  keep: (row: UsageRow) => boolean = () => true,
  seriesOf: (row: UsageRow) => string = () => 'all',
): UsageSummary {
  const { buckets, from, to, before } = spanOf(range, view.now)
  const index = new Map(buckets.map((bucket, at) => [bucket.key, at]))
  const weeks = new Map<string, string>()
  const keyOf = (hour: string): string => {
    if (range.unit === 'hour') return hour
    if (range.unit === 'day') return hour.slice(0, 10)
    if (range.unit === 'month') return hour.slice(0, 7)
    const day = hour.slice(0, 10)
    let week = weeks.get(day)
    if (week === undefined) {
      week = dayKey(mondayOf(hourMs(day)))
      weeks.set(day, week)
    }
    return week
  }
  const current: UsageBucketSum[] = buckets.map(bucket => ({ ...bucket, sum: blank(), stacks: new Map<string, number>() }))
  const result: UsageSummary = { buckets: current, total: blank(), previous: 0, owners: new Map(), models: new Map(), kinds: new Map() }
  for (const row of view.rows) {
    const hour = row[HOUR]
    if (hour < before || hour > to || !keep(row)) continue
    if (hour < from) {
      result.previous += tokensOf(row)
      continue
    }
    const at = index.get(keyOf(hour))
    if (at === undefined) continue
    const bucket = current[at] as UsageBucketSum
    addRow(bucket.sum, row)
    addRow(result.total, row)
    const series = seriesOf(row)
    bucket.stacks.set(series, (bucket.stacks.get(series) ?? 0) + tokensOf(row))
    addTo(result.owners, row[OWNER], row)
    addTo(result.models, row[MODEL], row)
    addTo(result.kinds, row[KIND], row)
  }
  return result
}

function trimmed(value: number): string {
  const text = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}
const UNITS: readonly (readonly [number, string])[] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
// 999,999 reads 1M, not 1000K.
export function compact(count: number): string {
  for (const [size, unit] of UNITS) {
    if (count >= size * 0.9995) return `${trimmed(count / size)}${unit}`
  }
  return String(Math.round(count))
}

export function percent(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return '0'
  const value = (part / whole) * 100
  return value < 1 ? '<1' : String(Math.round(value))
}

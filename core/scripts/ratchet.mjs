// A count baseline that can only go down.
//
// Leaves are numbers: check → file → count, or one level deeper (a value under the
// file). `--write` keeps the smaller count and drops what is gone. It never adds a
// key and never raises a count. `--add` records the current counts, which is how a
// baseline starts; that rise is the whole file, so review sees it.
//
//   import { lowered, added, rises, drops } from './ratchet.mjs'

/** The smaller of each listed count and what is left. A count that falls to zero drops out.
 *  An object that was already empty stays empty, so a check with nothing left keeps its key. */
export function lowered(baseline, found) {
  if (typeof baseline === 'number') return Math.min(baseline, typeof found === 'number' ? found : 0)
  if (baseline === null || typeof baseline !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(baseline)) {
    if (value !== null && typeof value === 'object') {
      const next = lowered(value, found?.[key])
      if (Object.keys(value).length === 0 || Object.keys(next).length > 0) out[key] = next
    } else if (typeof value === 'number') {
      const next = Math.min(value, typeof found === 'object' && found !== null && typeof found[key] === 'number' ? found[key] : 0)
      if (next > 0) out[key] = next
    }
  }
  return out
}

/** The measured counts, zeros dropped. This is the only way a baseline grows. */
export function added(found) {
  if (typeof found === 'number') return found
  if (found === null || typeof found !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(found)) {
    const next = added(value)
    if (typeof next === 'number') {
      if (next > 0) out[key] = next
    } else if (next !== null && typeof next === 'object' && Object.keys(next).length > 0) out[key] = next
  }
  return out
}

function walk(baseline, found, path, onNumber) {
  const lines = []
  if (typeof found === 'number' || typeof baseline === 'number') {
    onNumber(lines, path, typeof baseline === 'number' ? baseline : 0, typeof found === 'number' ? found : 0)
    return lines
  }
  const keys = new Set([
    ...Object.keys(baseline ?? {}),
    ...Object.keys(found ?? {}),
  ])
  for (const key of keys) lines.push(...walk(baseline?.[key], found?.[key], [...path, key], onNumber))
  return lines
}

/** Counts above the baseline, including a key the baseline does not have. */
export function rises(baseline, found) {
  return walk(baseline, found, [], (lines, path, allowed, actual) => {
    if (actual > allowed) lines.push(`${path.join('/')}: ${actual} (baseline ${allowed})`)
  })
}

/** Counts the baseline still lists but the tree no longer has. */
export function drops(baseline, found) {
  return walk(baseline, found, [], (lines, path, allowed, actual) => {
    if (allowed > actual) lines.push(`${path.join('/')}: ${actual} (baseline ${allowed})`)
  })
}

export const sorted = item => (item !== null && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => [key, sorted(value)]))
  : item)

export const format = item => `${JSON.stringify(sorted(item), null, 2)}\n`

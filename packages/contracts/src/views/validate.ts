// View cards: the blueprint a Bot may show, and the answer a user may send back.
// Pure, so the host can validate a card before it is stored and the client renders the
// same blueprint. No component runs model-written code.
import type { ShownViewCheck, ViewAnswerCheck, ViewCheck } from '../views.ts'
import {
  VIEW_BYTE_LIMIT,
  SUMMARY_COUNT,
  checkNode,
  interactiveNodes,
  validateOptions,
  validateConfirm,
  validateForm,
  componentSummary,
  clip,
  allowed,
  quoted,
  idsOf,
  isRecord,
  isArray,
  type JsonObject,
  type CheckContext,
} from './validate-check.ts'

export { VIEW_BYTE_LIMIT } from './validate-check.ts'

export function viewBytes(title: unknown, view: unknown): number {
  return new TextEncoder().encode(`${JSON.stringify(view) ?? ''}${String(title ?? '')}`).length
}

// Some providers serialize nested arrays as `{ item: [...] }` (XML-style) and
// numbers as strings. Normalize the blueprint before validation so a model is
// not asked to retry a call whose only fault is the provider's encoding.
// Arrays are unwrapped; metric.value and progress.percent accept a numeric
// string. Returns a new object; the input is not mutated.
export function normalizeView(value: unknown): unknown {
  if (isArray(value)) return value.map(normalizeView)
  if (!isRecord(value)) return value
  const keys = Object.keys(value)
  // Unwrap recursively: a provider may nest the wrapper, as { item: { item: [...] } }.
  if (keys.length === 1 && keys[0] === 'item') {
    const inner = normalizeView(value.item)
    if (isArray(inner)) return inner
  }
  const out: JsonObject = {}
  for (const key of keys) out[key] = normalizeView(value[key])
  for (const field of ['value', 'percent']) {
    const current = out[field]
    if (typeof current === 'string' && current.trim() !== '' && !Number.isNaN(Number(current)))
      out[field] = Number(current)
  }
  return out
}

export function validateView(view: unknown): ViewCheck {
  const ctx: CheckContext = { ids: new Set(), nodes: 0, interactive: false }
  const error = checkNode(view, 'view', 1, ctx)
  return error === undefined ? { ok: true, interactive: ctx.interactive } : { ok: false, error }
}

// What show_view checks before it shows a view: the same answer on the host and
// in the client. `view` is already normalized; the trimmed title comes back.
export function checkShownView(title: unknown, view: unknown): ShownViewCheck {
  let bytes: number
  try {
    bytes = viewBytes(title, view)
  } catch {
    return { error: 'The view is not JSON data.' }
  }
  if (bytes > VIEW_BYTE_LIMIT) return { error: `The view is ${bytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` }
  const named = String(title ?? '').trim()
  if (named === '') return { error: 'Give the view a title.' }
  const checked = validateView(view)
  if (!checked.ok) return { error: checked.error }
  return { title: named, interactive: checked.interactive }
}
export function viewSummary(view: unknown): string {
  const parts: string[] = []
  const visit = (node: unknown): void => {
    if (parts.length >= SUMMARY_COUNT || !isRecord(node)) return
    const line = componentSummary(node)
    if (line !== undefined) parts.push(clip(line))
    if (parts.length >= SUMMARY_COUNT || node.type !== 'stack' || !isArray(node.children)) return
    for (const child of node.children) visit(child)
  }
  visit(view)
  return parts.join('; ')
}
export function validateViewAnswer(view: unknown, action: unknown, values: unknown): ViewAnswerCheck {
  const nodes = interactiveNodes(view)
  if (typeof action !== 'string' || action === '')
    return { error: `action: expected an interactive component id; allowed: ${allowed(idsOf(nodes))}` }
  const node = nodes.find(item => item.id === action)
  if (node === undefined)
    return { error: `action: no interactive component with id ${quoted(action)}; allowed: ${allowed(idsOf(nodes))}` }
  if (!isRecord(values)) return { error: 'values: expected an object' }
  if (node.type === 'options') return validateOptions(node, values)
  if (node.type === 'confirm') return validateConfirm(values)
  return validateForm(node, values)
}

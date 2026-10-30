// View cards: the blueprint a Bot may show, and the answer a user may send back.
// Pure, so the host can validate a card before it is stored and the client renders the
// same blueprint. No component runs model-written code.
import type { ShownViewCheck, ViewAnswerCheck, ViewCheck, ViewComponentType, ViewTone } from '../views.ts'

const COMPONENTS: readonly ViewComponentType[] = ['stack', 'text', 'metric', 'table', 'options', 'confirm', 'form', 'progress']
const TONES: readonly ViewTone[] = ['good', 'warn', 'bad']
const INTERACTIVE = new Set<string>(['options', 'confirm', 'form'])
const PROPS: Readonly<Record<ViewComponentType, readonly string[]>> = {
  stack: ['children'],
  text: ['text'],
  metric: ['label', 'value', 'tone'],
  table: ['columns', 'rows'],
  options: ['id', 'options', 'multi'],
  confirm: ['id', 'confirmLabel', 'cancelLabel'],
  form: ['id', 'fields', 'submitLabel'],
  progress: ['label', 'percent'],
}
const MAX_DEPTH = 8
const MAX_NODES = 64
const MAX_CHILDREN = 16
const MAX_TEXT = 2000
const MAX_CELL = 200
const MAX_COLUMNS = 8
const MAX_ROWS = 50
const MAX_OPTIONS = 8
const MAX_FIELDS = 6
const SUMMARY_PART = 40
const SUMMARY_COUNT = 8
// UTF-8 bytes of the blueprint JSON plus the title. Not a wrapped document:
// the tool rejects a show_view whose viewBytes() is over this before it
// validates, so the number has to be the bytes the model actually sent.
export const VIEW_BYTE_LIMIT = 8192

type JsonObject = Record<string, unknown>

const isRecord = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)
const isComponent = (value: unknown): value is ViewComponentType =>
  typeof value === 'string' && (COMPONENTS as readonly string[]).includes(value)
const quoted = (value: unknown): string | undefined => JSON.stringify(value)
const allowed = (list: readonly string[]): string => list.join(', ')
// Optional property access as plain JS does it: any non-nullish value may carry it.
const prop = (value: unknown, key: string): unknown => {
  if (value === null || typeof value !== 'object') return undefined
  return (value as JsonObject)[key]
}

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
    if (typeof current === 'string' && current.trim() !== '' && !Number.isNaN(Number(current))) out[field] = Number(current)
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
  try { bytes = viewBytes(title, view) } catch { return { error: 'The view is not JSON data.' } }
  if (bytes > VIEW_BYTE_LIMIT) return { error: `The view is ${bytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` }
  const named = String(title ?? '').trim()
  if (named === '') return { error: 'Give the view a title.' }
  const checked = validateView(view)
  if (!checked.ok) return { error: checked.error }
  return { title: named, interactive: checked.interactive }
}

interface CheckContext {
  readonly ids: Set<string>
  nodes: number
  interactive: boolean
}

function checkNode(node: unknown, path: string, depth: number, ctx: CheckContext): string | undefined {
  if (!isRecord(node)) return `${path}: expected a component object`
  if (depth > MAX_DEPTH) return `${path}: ${depth} levels exceeds the limit of ${MAX_DEPTH}`
  ctx.nodes += 1
  if (ctx.nodes > MAX_NODES) return `${path}: ${ctx.nodes} components exceeds the limit of ${MAX_NODES}`
  const type = node.type
  if (!isComponent(type)) return `${path}.type: unknown component ${quoted(type)}; allowed: ${allowed(COMPONENTS)}`
  const props = PROPS[type]
  for (const key of Object.keys(node)) {
    if (key === 'type' || props.includes(key)) continue
    return `${path}.${key}: unknown property ${quoted(key)}; allowed: ${allowed(props)}`
  }
  if (INTERACTIVE.has(type)) ctx.interactive = true
  if (type === 'stack') return checkStack(node, path, depth, ctx)
  if (type === 'text') return checkText(node, path)
  if (type === 'metric') return checkMetric(node, path)
  if (type === 'table') return checkTable(node, path)
  if (type === 'options') return checkOptions(node, path, ctx)
  if (type === 'confirm') return checkConfirm(node, path, ctx)
  if (type === 'form') return checkForm(node, path, ctx)
  return checkProgress(node, path)
}

function checkStack(node: JsonObject, path: string, depth: number, ctx: CheckContext): string | undefined {
  const children = node.children
  if (!isArray(children)) return `${path}.children: expected an array of 1 to ${MAX_CHILDREN} components`
  if (children.length < 1 || children.length > MAX_CHILDREN) return `${path}.children: expected 1 to ${MAX_CHILDREN} children; got ${children.length}`
  for (let index = 0; index < children.length; index += 1) {
    const error = checkNode(children[index], `${path}.children[${index}]`, depth + 1, ctx)
    if (error !== undefined) return error
  }
  return undefined
}

function checkText(node: JsonObject, path: string): string | undefined {
  const text = node.text
  if (typeof text !== 'string') return `${path}.text: expected a string`
  if (text.length > MAX_TEXT) return `${path}.text: ${text.length} characters exceeds the limit of ${MAX_TEXT}`
  return undefined
}

function checkMetric(node: JsonObject, path: string): string | undefined {
  if (typeof node.label !== 'string') return `${path}.label: expected a string`
  const value = node.value
  if (typeof value !== 'string' && typeof value !== 'number') return `${path}.value: expected a string or a number`
  if (typeof value === 'number' && !Number.isFinite(value)) return `${path}.value: expected a finite number`
  if (node.tone !== undefined && !TONES.includes(node.tone as ViewTone)) return `${path}.tone: unknown tone ${quoted(node.tone)}; allowed: ${allowed(TONES)}`
  return undefined
}

function checkTable(node: JsonObject, path: string): string | undefined {
  const columns = node.columns
  if (!isArray(columns)) return `${path}.columns: expected an array of at most ${MAX_COLUMNS} columns`
  if (columns.length > MAX_COLUMNS) return `${path}.columns: ${columns.length} columns exceeds the limit of ${MAX_COLUMNS}`
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index]
    const at = `${path}.columns[${index}]`
    if (!isRecord(column)) return `${at}: expected a column object`
    for (const key of Object.keys(column)) {
      if (key !== 'key' && key !== 'label') return `${at}.${key}: unknown property ${quoted(key)}; allowed: key, label`
    }
    if (typeof column.key !== 'string' || column.key === '') return `${at}.key: expected a non-empty string`
    if (typeof column.label !== 'string') return `${at}.label: expected a string`
  }
  const rows = node.rows
  if (!isArray(rows)) return `${path}.rows: expected an array of at most ${MAX_ROWS} rows`
  if (rows.length > MAX_ROWS) return `${path}.rows: ${rows.length} rows exceeds the limit of ${MAX_ROWS}`
  for (let row = 0; row < rows.length; row += 1) {
    const cells = rows[row]
    if (!isArray(cells)) return `${path}.rows[${row}]: expected an array of cells`
    for (let column = 0; column < cells.length; column += 1) {
      const text = cellText(cells[column])
      if (text.length > MAX_CELL) return `${path}.rows[${row}][${column}]: ${text.length} characters exceeds the limit of ${MAX_CELL}`
    }
  }
  return undefined
}

function checkOptions(node: JsonObject, path: string, ctx: CheckContext): string | undefined {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.multi !== undefined && typeof node.multi !== 'boolean') return `${path}.multi: expected a boolean`
  const options = node.options
  if (!isArray(options)) return `${path}.options: expected an array of 1 to ${MAX_OPTIONS} options`
  if (options.length < 1 || options.length > MAX_OPTIONS) return `${path}.options: expected 1 to ${MAX_OPTIONS} options; got ${options.length}`
  const labels = new Set<string>()
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    const at = `${path}.options[${index}]`
    if (!isRecord(option)) return `${at}: expected an option object`
    for (const key of Object.keys(option)) {
      if (key !== 'label' && key !== 'description') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, description`
    }
    if (typeof option.label !== 'string' || option.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`
    labels.add(option.label)
    if (option.description !== undefined && typeof option.description !== 'string') return `${at}.description: expected a string`
  }
  return undefined
}

function checkConfirm(node: JsonObject, path: string, ctx: CheckContext): string | undefined {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.confirmLabel !== undefined && typeof node.confirmLabel !== 'string') return `${path}.confirmLabel: expected a string`
  if (node.cancelLabel !== undefined && typeof node.cancelLabel !== 'string') return `${path}.cancelLabel: expected a string`
  return undefined
}

function checkForm(node: JsonObject, path: string, ctx: CheckContext): string | undefined {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.submitLabel !== undefined && typeof node.submitLabel !== 'string') return `${path}.submitLabel: expected a string`
  const fields = node.fields
  if (!isArray(fields)) return `${path}.fields: expected an array of at most ${MAX_FIELDS} fields`
  if (fields.length > MAX_FIELDS) return `${path}.fields: ${fields.length} fields exceeds the limit of ${MAX_FIELDS}`
  const seen = new Set<string>()
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    const at = `${path}.fields[${index}]`
    if (!isRecord(field)) return `${at}: expected a field object`
    for (const key of Object.keys(field)) {
      if (key !== 'id' && key !== 'label' && key !== 'placeholder') return `${at}.${key}: unknown property ${quoted(key)}; allowed: id, label, placeholder`
    }
    if (typeof field.id !== 'string' || field.id === '') return `${at}.id: expected a non-empty string`
    if (field.id === '__proto__') return `${at}.id: "__proto__" cannot be an id`
    if (seen.has(field.id)) return `${at}.id: duplicate field id ${quoted(field.id)}`
    seen.add(field.id)
    if (typeof field.label !== 'string') return `${at}.label: expected a string`
    if (field.placeholder !== undefined && typeof field.placeholder !== 'string') return `${at}.placeholder: expected a string`
  }
  return undefined
}

function checkProgress(node: JsonObject, path: string): string | undefined {
  if (node.label !== undefined && typeof node.label !== 'string') return `${path}.label: expected a string`
  if (typeof node.percent !== 'number' || !Number.isFinite(node.percent) || node.percent < 0 || node.percent > 100) return `${path}.percent: expected a number from 0 to 100`
  return undefined
}

function checkId(node: JsonObject, path: string, ctx: CheckContext): string | undefined {
  if (typeof node.id !== 'string' || node.id === '') return `${path}.id: expected a non-empty string`
  // A `__proto__` id would write through to a plain object's prototype where the
  // answer is kept, losing it silently.
  if (node.id === '__proto__') return `${path}.id: "__proto__" cannot be an id`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  return undefined
}

function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return typeof text === 'string' ? text : ''
}

function clip(text: unknown): string {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length <= SUMMARY_PART ? flat : flat.slice(0, SUMMARY_PART)
}

function componentSummary(node: JsonObject): string | undefined {
  if (node.type === 'text') return `text: ${String(node.text ?? '')}`
  if (node.type === 'metric') return `metric: ${String(node.label)}=${String(node.value)}`
  if (node.type === 'table') return `table: ${(isArray(node.columns) ? node.columns : []).map(column => prop(column, 'label') ?? prop(column, 'key') ?? '').filter(Boolean).join('/')}`
  if (node.type === 'options') return `options: ${(isArray(node.options) ? node.options : []).map(option => prop(option, 'label')).filter(Boolean).join('/')}`
  if (node.type === 'confirm') return 'confirm'
  if (node.type === 'form') return `form: ${(isArray(node.fields) ? node.fields : []).map(field => prop(field, 'label') ?? prop(field, 'id')).filter(Boolean).join('/')}`
  if (node.type === 'progress') return `progress: ${node.label ? `${String(node.label)} ` : ''}${String(node.percent)}%`
  return undefined
}

// One line for a handoff or a checkpoint. Containers add nothing of their own;
// each component keeps one short phrase, and the line stops after a few.
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

function interactiveNodes(node: unknown, found: JsonObject[] = []): JsonObject[] {
  if (!isRecord(node)) return found
  if (typeof node.type === 'string' && INTERACTIVE.has(node.type)) found.push(node)
  if (node.type === 'stack' && isArray(node.children)) {
    for (const child of node.children) interactiveNodes(child, found)
  }
  return found
}

const idsOf = (nodes: readonly JsonObject[]): string[] => nodes.map(node => String(node.id ?? ''))

// `action` is the id of the component the user submitted. One submit settles
// the whole card, so only that component's values are kept.
export function validateViewAnswer(view: unknown, action: unknown, values: unknown): ViewAnswerCheck {
  const nodes = interactiveNodes(view)
  if (typeof action !== 'string' || action === '') return { error: `action: expected an interactive component id; allowed: ${allowed(idsOf(nodes))}` }
  const node = nodes.find(item => item.id === action)
  if (node === undefined) return { error: `action: no interactive component with id ${quoted(action)}; allowed: ${allowed(idsOf(nodes))}` }
  if (!isRecord(values)) return { error: 'values: expected an object' }
  if (node.type === 'options') return validateOptions(node, values)
  if (node.type === 'confirm') return validateConfirm(values)
  return validateForm(node, values)
}

function validateOptions(node: JsonObject, values: JsonObject): ViewAnswerCheck {
  const selected = values.selected
  if (!isArray(selected)) return { error: 'values.selected: expected an array of option labels' }
  const labels = new Set((isArray(node.options) ? node.options : []).map(option => prop(option, 'label')))
  const picked = selected.filter((label): label is string => typeof label === 'string' && labels.has(label))
  const kept = node.multi === true ? [...new Set(picked)] : picked.slice(0, 1)
  if (kept.length === 0) return { error: 'values.selected: select at least one option' }
  return { selected: kept }
}

function validateConfirm(values: JsonObject): ViewAnswerCheck {
  if (typeof values.confirmed !== 'boolean') return { error: 'values.confirmed: expected a boolean' }
  return { confirmed: values.confirmed }
}

function validateForm(node: JsonObject, values: JsonObject): ViewAnswerCheck {
  const given = values.fields
  if (!isRecord(given)) return { error: 'values.fields: expected an object of field ids to strings' }
  const declared = (isArray(node.fields) ? node.fields : [])
    .map(field => prop(field, 'id'))
    .filter((id): id is string => typeof id === 'string')
  const allowedIds = new Set(declared)
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(given)) {
    if (!allowedIds.has(key)) return { error: `values.fields.${key}: unknown field; allowed: ${allowed(declared)}` }
    if (typeof value !== 'string') return { error: `values.fields.${key}: expected a string` }
    if (value.length > MAX_TEXT) return { error: `values.fields.${key}: ${value.length} characters exceeds the limit of ${MAX_TEXT}` }
    fields[key] = value
  }
  return { fields }
}

// OpenUI-style specs mapped onto the view cards this product already renders
// (plan §阶段 6: "@openuidev 集成：与现有 8 种卡片 views 并存，异常输出安全降级").
//
// A model writes a generated interface as an element map — `{ root, elements: { id:
// { type, props, children } } }` — which this module lowers into the same whitelisted
// WidgetView tree every card uses. Two properties fall out of that: nothing generated
// reaches the DOM as markup or code, and an interaction is an ordinary options/confirm/
// form card whose answer travels the existing view-reply channel (the front end never
// approves anything on its own). A node the mapping does not know degrades to its own
// text, so a malformed spec still shows something and never throws.
import { normalizeView, type WidgetView } from './views.ts'

/** The spec a model may send: one root element id, elements by id. */
export interface OpenUiSpec {
  readonly root?: unknown
  readonly elements?: unknown
}

/** Whether a show_view blueprint is an OpenUI element map rather than one card. */
export const isOpenUiSpec = (value: unknown): value is OpenUiSpec =>
  isRecord(value) && isRecord((value as { readonly elements?: unknown }).elements)

/** What lowering answers: a card, or the reason there is none. */
export type OpenUiResult = { readonly view: WidgetView } | { readonly error: string }

const MAX_ELEMENTS = 64
const MAX_DEPTH = 8

interface Element {
  readonly type?: unknown
  readonly props?: unknown
  readonly children?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value))
const textProp = (props: Record<string, unknown>, ...keys: readonly string[]): string => {
  for (const key of keys) {
    const value = props[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (typeof value === 'number') return String(value)
  }
  return ''
}
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/**
 * A show_view blueprint, resolved: an OpenUI element map lowers onto the cards, any
 * other blueprint normalizes as it always did, and a spec that cannot lower answers
 * the reason.
 */
export function resolveViewBlueprint(raw: unknown): { readonly view: unknown } | { readonly error: string } {
  if (!isOpenUiSpec(raw)) return { view: normalizeView(raw) }
  const lowered = lowerOpenUi(raw)
  return 'error' in lowered ? { error: lowered.error } : { view: lowered.view }
}

/**
 * Lowers an OpenUI spec into a view card. Known types map onto the product's own
 * components; anything else becomes a text line naming what it was — a visible,
 * harmless degradation rather than an error the model has to retry.
 */
export function lowerOpenUi(spec: OpenUiSpec): OpenUiResult {
  if (!isRecord(spec.elements)) return { error: 'An OpenUI spec needs an `elements` map.' }
  const elements = spec.elements
  const ids = Object.keys(elements)
  if (ids.length === 0) return { error: 'An OpenUI spec needs at least one element.' }
  if (ids.length > MAX_ELEMENTS)
    return { error: `An OpenUI spec holds ${String(ids.length)} elements; the limit is ${MAX_ELEMENTS}.` }
  const root = typeof spec.root === 'string' && spec.root !== '' ? spec.root : (ids[0] as string)
  const seen = new Set<string>()
  const lowered = lower(root, elements, 1, seen)
  if ('error' in lowered) return lowered
  return { view: lowered.view }
}

function lower(
  id: string,
  elements: Record<string, unknown>,
  depth: number,
  seen: Set<string>,
): { view: WidgetView } | { error: string } {
  if (depth > MAX_DEPTH) return { error: `The spec nests deeper than ${MAX_DEPTH} levels.` }
  if (seen.has(id)) return { error: `The element "${id}" refers to itself.` }
  const element = elements[id]
  if (!isRecord(element)) return { error: `No element "${id}" in the spec.` }
  seen.add(id)
  const node = element as Element
  const type = textProp((node.props as Record<string, unknown>) ?? {}, 'type') || text(node.type)
  const props = isRecord(node.props) ? node.props : {}
  const children = listOf(node.children).flatMap(child => {
    const childId =
      typeof child === 'string' ? child : isRecord(child) && typeof child.id === 'string' ? child.id : undefined
    if (childId === undefined) return []
    const lowered = lower(childId, elements, depth + 1, seen)
    return 'view' in lowered ? [lowered.view] : []
  })
  const asText = (): WidgetView => ({
    type: 'text',
    text: textProp(props, 'text', 'label', 'title', 'value') || `${type || 'element'} ${id}`,
  })
  switch (type) {
    case 'Stack':
    case 'Card':
    case 'Row':
    case 'Column':
    case 'Grid': {
      if (children.length === 0) return { view: asText() }
      return { view: { type: 'stack', children: children.slice(0, 16) } }
    }
    case 'Text':
    case 'Title':
    case 'Label':
    case 'Markdown':
      return { view: { type: 'text', text: textProp(props, 'text', 'value', 'content') || asTextText(type, id) } }
    case 'Metric':
    case 'Badge':
    case 'Stat':
      return {
        view: {
          type: 'metric',
          label: textProp(props, 'label', 'title') || type,
          value: typeof props.value === 'number' ? props.value : textProp(props, 'value'),
          ...(props.tone === 'good' || props.tone === 'warn' || props.tone === 'bad' ? { tone: props.tone } : {}),
        },
      }
    case 'Table':
    case 'DataTable': {
      const columns = listOf(props.columns).flatMap(column => {
        if (!isRecord(column)) return []
        const key = textProp(column, 'key', 'id', 'name')
        return key === '' ? [] : [{ key, label: textProp(column, 'label', 'title') || key }]
      })
      // The card's rows are positional cells, in the columns' order.
      const kept = columns.slice(0, 8)
      const rows = listOf(props.rows ?? props.data).flatMap(row => {
        if (!isRecord(row)) return []
        return [
          kept.map(column => {
            const cell = (row as Record<string, unknown>)[column.key]
            return typeof cell === 'number' ? cell : text(cell)
          }),
        ]
      })
      if (kept.length === 0 || rows.length === 0) return { view: asText() }
      return { view: { type: 'table', columns: kept, rows: rows.slice(0, 50) } }
    }
    case 'Progress':
    case 'ProgressBar': {
      const percent =
        typeof props.percent === 'number'
          ? props.percent
          : typeof props.value === 'number'
            ? props.value
            : Number(textProp(props, 'percent', 'value'))
      if (!Number.isFinite(percent)) return { view: asText() }
      return {
        view: {
          type: 'progress',
          percent,
          ...(textProp(props, 'label') !== '' ? { label: textProp(props, 'label') } : {}),
        },
      }
    }
    case 'Actions':
    case 'Buttons':
    case 'Picker': {
      // An interaction is an ordinary options card: its answer comes back through
      // view-reply like every other card's, and the front end cannot approve anything.
      const options = listOf(props.options ?? props.actions ?? props.items).flatMap(option => {
        if (!isRecord(option)) return []
        const label = textProp(option, 'label', 'title', 'text')
        return label === ''
          ? []
          : [
              {
                label,
                ...(textProp(option, 'description') !== '' ? { description: textProp(option, 'description') } : {}),
              },
            ]
      })
      if (options.length === 0) return { view: asText() }
      const id = textProp(props, 'id', 'name') || 'openui-actions'
      return {
        view: { type: 'options', id, options: options.slice(0, 8), ...(props.multi === true ? { multi: true } : {}) },
      }
    }
    case 'Form': {
      const fields = listOf(props.fields).flatMap(field => {
        if (!isRecord(field)) return []
        const fieldId = textProp(field, 'id', 'name')
        if (fieldId === '') return []
        return [
          {
            id: fieldId,
            label: textProp(field, 'label', 'title') || fieldId,
            ...(textProp(field, 'placeholder') !== '' ? { placeholder: textProp(field, 'placeholder') } : {}),
          },
        ]
      })
      if (fields.length === 0) return { view: asText() }
      return {
        view: {
          type: 'form',
          id: textProp(props, 'id', 'name') || 'openui-form',
          fields: fields.slice(0, 6),
          ...(textProp(props, 'submitLabel') !== '' ? { submitLabel: textProp(props, 'submitLabel') } : {}),
        },
      }
    }
    case 'Confirm': {
      return {
        view: {
          type: 'confirm',
          id: textProp(props, 'id', 'name') || 'openui-confirm',
          ...(!textProp(props, 'confirmLabel') ? {} : { confirmLabel: textProp(props, 'confirmLabel') }),
          ...(!textProp(props, 'cancelLabel') ? {} : { cancelLabel: textProp(props, 'cancelLabel') }),
        },
      }
    }
    default:
      // Unknown to the mapping: show what it was, then its children — visible and safe.
      if (children.length === 0) return { view: asText() }
      return { view: { type: 'stack', children: [asText(), ...children].slice(0, 16) } }
  }
}

const asTextText = (type: string, id: string): string => `${type || 'element'} ${id}`

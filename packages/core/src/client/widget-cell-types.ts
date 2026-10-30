import type { DockHoldActions } from './card-hold.ts'

export interface WidgetOption {
  label: string
  description?: string | undefined
}
export interface WidgetField {
  id: string
  label: string
  placeholder?: string | undefined
}
export interface WidgetColumn {
  key?: string | undefined
  label?: string | undefined
}
export interface WidgetNode {
  type?: string | undefined
  id: string
  children?: readonly WidgetNode[] | undefined
  options?: readonly (string | WidgetOption)[] | undefined
  fields?: readonly WidgetField[] | undefined
  columns?: readonly WidgetColumn[] | undefined
  rows?: readonly unknown[] | undefined
  label?: string | undefined
  value?: string | number | undefined
  text?: string | undefined
  tone?: string | undefined
  percent?: number | undefined
  multi?: boolean | undefined
  cancelLabel?: string | undefined
  confirmLabel?: string | undefined
  submitLabel?: string | undefined
  placeholder?: string | undefined
  description?: string | undefined
}
export interface AnswerValues {
  selected?: readonly string[] | undefined
  confirmed?: boolean | undefined
  fields?: Record<string, string> | undefined
}
export interface AnswerValue {
  action?: string | undefined
  id?: string | undefined
  values?: AnswerValues | undefined
}
export type SubmitHandler = (action: string | undefined, values: AnswerValues) => void
export interface WidgetContext {
  onSubmit?: SubmitHandler | undefined
  settled: boolean
  answer: AnswerValue | null
  keys: boolean
}
export interface ShownLike {
  id: string
  title?: string | undefined
  callId?: string | undefined
  view: WidgetNode
}
export type WidgetCallArgs = {
  text?: ((name: string) => string) | undefined
  value?: ((name: string) => unknown) | undefined
}
export type RosterHook = <T>(select: (value: { views?: Record<string, ShownLike | undefined> | undefined }) => T) => T
export type CardsHook = <T>(select: (value: Record<string, Record<string, number> | undefined>) => T) => T
export interface WidgetActions extends DockHoldActions {
  answerView: (sessionId: string, viewId: string, action: string | undefined, values: AnswerValues) => Promise<unknown>
  dismissView: (sessionId: string) => Promise<unknown>
}

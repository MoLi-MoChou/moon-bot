// Types and limits for the `read_browser` page reader.
export interface ReadLimits {
  chars: number
  nodes: number
  depth: number
  ms: number
  items: number
  tableRows: number
  tableCols: number
  frameDepth: number
}
export interface ReadItem {
  role: string
  name?: string | undefined
  href?: string | undefined
  value?: string | undefined
  checked?: boolean | undefined
  disabled?: boolean | undefined
}
export interface ReadPage {
  url: string
  title: string
  lang: string
  description: string
  selection: string
  format: string
  text: string
  items: ReadItem[]
  stats: { nodes: number; frames: number; ms: number }
  truncated?: string | undefined
}

export const READ_LIMITS: ReadLimits = {
  chars: 400_000,
  nodes: 150_000,
  depth: 400,
  ms: 1500,
  items: 3000,
  tableRows: 5000,
  tableCols: 30,
  frameDepth: 3,
}

export interface ReadContext {
  depth: number
  frames: number
  shown: boolean
  pre: boolean
}
export interface PageElement extends Element {
  href?: string | undefined
  src?: string | undefined
  value?: string | undefined
  type?: string | undefined
  checked?: boolean | undefined
  disabled?: boolean | undefined
  title?: string | undefined
  innerText?: string | undefined
  isContentEditable?: boolean | undefined
  open?: boolean | undefined
  contentDocument?: Document | null
  assignedNodes?: (() => Node[]) | undefined
  labels?: ArrayLike<{ textContent: string | null }> | undefined
  selectedOptions?: (Iterable<{ label: string; text: string }> & { length: number }) | undefined
  rows?: Iterable<PageRow> | undefined
  caption?: PageRow | null
}
export interface PageRow extends PageElement {
  cells?: ArrayLike<PageCell> | undefined
}
export interface PageCell extends PageElement {
  colSpan?: number | undefined
  rowSpan?: number | undefined
}

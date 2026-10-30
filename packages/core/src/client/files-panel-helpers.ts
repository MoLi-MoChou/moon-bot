// Moon Bot: Download in the host's workspace file panel, and a card for what it cannot
// preview. the host's panel previews images, PDF, Word/PowerPoint, Excel/CSV, Markdown and
// code/text, but cannot save a file, and shows a bare "Preview is not available" for
// everything else. This adds, without patching the host (only its stable data-* hooks):
// - a Download button on every row of the tree (a folder downloads as a .zip);
// - a Download button in every preview's toolbar;
// - in place of the bare notice, a card with the file's icon, name, size and type and
//   a Download button; audio and video play right in it.
// Bytes come over the api/bot channel, so it works in the web build behind its password.

/** What the host answers for a file the panel downloads. */
export interface DownloadFile {
  readonly name: string
  readonly mime: string
  readonly data: string
}

/** What the host knows about a file the panel cannot preview. */
export interface FileInfo {
  readonly name?: string | undefined
  readonly mime?: string | undefined
  readonly size?: number | undefined
  readonly downloadable?: boolean | undefined
  readonly error?: string | undefined
}

/** The channel call the panel makes; the endpoint decides the answer it gets. */
export interface FilesPanelCall {
  <T>(endpoint: string, args: { readonly path: string }): Promise<T>
}

export interface FilesPanelOptions {
  readonly call: FilesPanelCall
  readonly notify?: ((message: string) => void) | undefined
  readonly onPickFolder?: (() => void) | undefined
}

export interface EmptyStateAction {
  readonly label: string
  onClick(): void
}

export interface EmptyStateOptions {
  readonly icon?: Node | string | undefined
  readonly title?: string | undefined
  readonly hint?: string | undefined
  readonly action?: EmptyStateAction | undefined
  readonly compact?: boolean | undefined
}

export const messageOf = (error: unknown): string =>
  (error as { readonly message?: string } | undefined)?.message ?? String(error)

// The shared empty-state DOM (.bt-es), built without React so this file stays importable
// in Node tests that check its pure helpers.
export function emptyStateNode({
  icon: glyph,
  title,
  hint,
  action,
  compact = false,
}: EmptyStateOptions): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'bt-es'
  root.setAttribute('role', 'status')
  if (compact) root.dataset.compact = ''
  const part = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    child?: Node | string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    node.className = className
    if (typeof child === 'string') node.textContent = child
    else if (child) node.append(child)
    root.append(node)
    return node
  }
  if (glyph) part('span', 'bt-es-mark', glyph).setAttribute('aria-hidden', 'true')
  if (title) part('span', 'bt-es-title', title)
  if (hint) part('span', 'bt-es-hint', hint)
  if (action) {
    const button = part('button', 'bt-es-action', action.label)
    button.type = 'button'
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      action.onClick()
    })
  }
  return root
}
export const AUDIO = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/i
export const VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i

export const SVG = 'http://www.w3.org/2000/svg'
export function icon(paths: readonly string[], size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
export const DOWNLOAD = ['M10 3.5v9', 'M6.5 9.5L10 13l3.5-3.5', 'M4 16h12']
export const FOLDER = [
  'M3 6a1.5 1.5 0 0 1 1.5-1.5h3.6l1.7 1.8h5.7A1.5 1.5 0 0 1 17 7.8v6.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z',
]
export const FILE = ['M5.5 2.5h6l4 4v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z', 'M11.5 2.5v4h4']
export const ARCHIVE = [...FILE, 'M9 5.5h1M9 8h1M9 10.5h1', 'M8.5 12.5h2v2h-2z']

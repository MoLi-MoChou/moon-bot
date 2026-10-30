// Icons, width helpers, and chat-room spring chrome for the Bot browser panel.
import { createElement as h, useState } from 'react'
import { t } from './i18n.ts'
import type { FaviconProps, PanelPage, PanelView } from './browser-pane-types.ts'
import { DETAILS_MAX, DETAILS_WIDTH, MIN_CHAT, MIN_WIDTH, WIDTH_KEY } from './browser-pane-const.ts'
import { installStyles } from './design/index.ts'

export const icon = (paths: readonly string[]) =>
  function BrowserIcon() {
    return (
      <svg
        width={16}
        height={16}
        viewBox='0 0 20 20'
        fill='none'
        stroke='currentColor'
        strokeWidth={1.5}
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden>
        {paths.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </svg>
    )
  }
export const GlobeIcon = icon([
  'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  'M3 10h14',
  'M10 3c2 2.2 2.9 4.5 2.9 7S12 14.8 10 17c-2-2.2-2.9-4.5-2.9-7S8 5.2 10 3z',
])
export const BackIcon = icon(['M12.5 4.5L7 10l5.5 5.5'])
export const ForwardIcon = icon(['M7.5 4.5L13 10l-5.5 5.5'])
export const ReloadIcon = icon(['M15.5 10a5.5 5.5 0 1 1-1.6-3.9', 'M15.5 3.5v3.5H12'])
export const StopIcon = icon(['M5.5 5.5l9 9M14.5 5.5l-9 9'])
export const CloseIcon = icon(['M5.5 5.5l9 9M14.5 5.5l-9 9'])
export const PlusTabIcon = icon(['M10 5v10M5 10h10'])
export const LockIcon = icon(['M6.5 9V7a3.5 3.5 0 0 1 7 0v2', 'M5.5 9h9v7h-9z'])
/** A page's favicon, or the globe while there is none or it fails to load. */
export function Favicon({ src, className }: FaviconProps) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src)
    return (
      <span className={`${className} bt-ptab-globe`}>
        <GlobeIcon />
      </span>
    )
  return <img className={className} src={src} alt='' aria-hidden onError={() => setFailed(src)} />
}
// An animation from the strip's own keyframes. Plain Animation has no animationName.
export const isCssAnimation = (animation: Animation): animation is CSSAnimation => 'animationName' in animation
// null until the user sets a width: the Bot page then opens at DETAILS_WIDTH and the
// browser at DEFAULT_WIDTH.
export const savedWidth = (): number | null => {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value >= DETAILS_WIDTH ? value : null
  } catch {
    return null
  }
}
export const widthRange = (view: PanelView, viewport: number): [number, number] =>
  view === 'browser' ? [MIN_WIDTH, viewport - MIN_CHAT] : [DETAILS_WIDTH, Math.min(DETAILS_MAX, viewport - MIN_CHAT)]
export const fitWidth = (width: number, [low, high]: readonly [number, number]): number =>
  Math.round(Math.max(low, Math.min(width, high)))
// The conversation column's right margin lives in one rule of our own, matched on the
// column's exact class. A custom property on <body> would restyle the whole page, tens
// of milliseconds a write. A changed rule still restyles the column's subtree, so a drag
// writes the column's own inline style each frame and the rule once, on release.
export const room: {
  rule: CSSStyleRule | null
  selector: string
} = { rule: null, selector: '' }
export const roomRule = (): CSSStyleRule => {
  if (room.rule !== null && room.rule.parentStyleSheet?.ownerNode?.isConnected === true && room.selector !== '')
    return room.rule
  const column = document.querySelector('[class*="_centerCol"]')
  const selector = column
    ? [...column.classList]
        .filter(name => name.includes('_centerCol'))
        .map(name => `.${CSS.escape(name)}`)
        .join(',')
    : ''
  if (room.rule !== null && room.rule.parentStyleSheet?.ownerNode?.isConnected === true && selector === '')
    return room.rule
  const declarations = room.rule?.style.cssText ?? ''
  room.rule?.parentStyleSheet?.ownerNode?.remove()
  const style = installStyles(`${selector || '[class*="_centerCol"]'}{${declarations}}`, 'chat-room')
  const rule = style.sheet?.cssRules[0]
  if (!(rule instanceof CSSStyleRule)) throw new Error('the chat-room rule did not install')
  room.rule = rule
  room.selector = selector
  return rule
}
export let roomHold = 0
export const chatRoom = {
  /** The column's right margin in px, or null for the shell's own. */
  set(width: number | null): void {
    const { style } = roomRule()
    if (width === null) style.removeProperty('margin-right')
    else style.setProperty('margin-right', `${width}px`, 'important')
  },
  /** While on, a margin change lands at once instead of gliding. */
  hold(on: boolean): void {
    cancelAnimationFrame(roomHold)
    if (on) {
      roomRule().style.setProperty('transition', 'none', 'important')
      return
    }
    // Two frames, so the last held write is on screen before the glide comes back.
    roomHold = requestAnimationFrame(() => {
      roomHold = requestAnimationFrame(() => roomRule().style.removeProperty('transition'))
    })
  },
  /** The columns themselves, for a drag's per-frame writes. */
  columns(): HTMLElement[] {
    roomRule()
    return room.selector ? [...document.querySelectorAll<HTMLElement>(room.selector)] : []
  },
}
// The address as the bar shows it while not editing: no scheme, no trailing slash.
export const shortAddress = (url: string | null | undefined): string =>
  String(url ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
export const tabLabel = (page: PanelPage): string => page.title || shortAddress(page.url) || t('New tab')
// The strip across the panel's top: the Bot's own tab first (the details view,

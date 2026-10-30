import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject, RefObject } from 'react'

// -------------------------------------------------------------------------
// Overlays: new chat, bot exchange, details drawer, context menu

// Escape closes only the newest open layer, so a dialog over the details pane does
// not take the pane down with it.
const escapeLayers: MutableRefObject<() => void>[] = []
const onEscapeKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
  const top = escapeLayers.at(-1)
  if (top === undefined) return
  event.preventDefault()
  event.stopPropagation()
  top.current()
}
export function useEscape(onClose: () => void, enabled = true): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!enabled) return undefined
    if (escapeLayers.length === 0) window.addEventListener('keydown', onEscapeKey)
    escapeLayers.push(ref)
    return () => {
      const index = escapeLayers.indexOf(ref)
      if (index !== -1) escapeLayers.splice(index, 1)
      if (escapeLayers.length === 0) window.removeEventListener('keydown', onEscapeKey)
    }
  }, [enabled])
}

// Moves focus across enabled menu items inside a role="menu" surface on ArrowUp/Down/Home/End.
export function stepMenuFocus(menu: Element | null, key: string): boolean {
  if (menu === null) return false
  const items = [...menu.querySelectorAll<HTMLElement>('button[role^="menuitem"]:not(:disabled)')]
  if (items.length === 0) return false
  const current = items.indexOf(document.activeElement as HTMLElement)
  let next = -1
  if (key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else if (key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
  else if (key === 'Home') next = 0
  else if (key === 'End') next = items.length - 1
  else return false
  items[next]?.focus()
  return true
}

export function useMenuKeys(menuRef: RefObject<HTMLElement | null>, isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return undefined
    const raf = requestAnimationFrame(() => {
      const menu = menuRef.current
      if (menu === null || menu.contains(document.activeElement)) return
      const target = menu.querySelector<HTMLElement>('button[aria-checked="true"]:not(:disabled), button[role^="menuitem"]:not(:disabled)')
      target?.focus()
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      const menu = menuRef.current
      if (menu === null) return
      if (event.target instanceof HTMLElement && menu.contains(event.target) && event.target.matches('input,textarea,[contenteditable]')) return
      if (stepMenuFocus(menu, event.key)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [isOpen, menuRef])
}

// New chat and Bot exchanges show in place of the conversation, right of the sidebar.
export function usePaneLeft(): number {
  const [paneLeft, setPaneLeft] = useState(280)
  useLayoutEffect(() => {
    const column = document.querySelector<HTMLElement>('[class*="_footArea"]')?.parentElement
    if (column) setPaneLeft(Math.round(column.getBoundingClientRect().right))
  }, [])
  return paneLeft
}

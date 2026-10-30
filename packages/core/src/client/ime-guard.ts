// Moon Bot: Enter that ends a CJK input method's composition must not send. Browsers
// mark it with isComposing or keyCode 229; Safari/WebKit instead fire one plain Enter
// right after compositionend. A capture-phase listener ahead of the composer's own
// (Lexical) keydown swallows both (after open-claude-ui's ChatComposer, MIT).
//
// The post-compositionend stray window is WebKit-only: on Chromium/Firefox, committing
// with Space then pressing Enter to send within a few dozen ms was wrongly swallowed
// (dogfood: first Enter dropped, text stayed in the composer).
const COMPOSER = '[data-composer-input],[contenteditable=true],textarea'
const WEBKIT_STRAY_MS = 500

interface ComposingEvent extends KeyboardEvent { keyCode: number }

const isAppleWebKit = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)
}

export function installImeGuard(
  root: Document | HTMLElement = document,
  { webkit = isAppleWebKit() }: { webkit?: boolean } = {},
): () => void {
  let endedAt = -Infinity
  const ended = (): void => { endedAt = performance.now() }
  const keydown = (event: Event): void => {
    const key = event as ComposingEvent
    if (key.key !== 'Enter' && key.keyCode !== 229) return
    if (!(key.target instanceof Element) || key.target.closest(COMPOSER) === null) return
    const composing = key.isComposing || key.keyCode === 229
    const stray = webkit
      && key.key === 'Enter'
      && endedAt !== -Infinity
      && performance.now() - endedAt < WEBKIT_STRAY_MS
    if (!composing && !stray) return
    key.stopImmediatePropagation()
    if (stray) {
      // Only the first fake Enter after compositionend; a deliberate second Enter sends.
      endedAt = -Infinity
      key.preventDefault()
    }
  }
  root.addEventListener('compositionend', ended, true)
  root.addEventListener('keydown', keydown, true)
  return () => {
    root.removeEventListener('compositionend', ended, true)
    root.removeEventListener('keydown', keydown, true)
  }
}

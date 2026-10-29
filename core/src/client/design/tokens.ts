// The design system's base sheet: the --bt-* theme variables every other sheet reads,
// and the installers that put a sheet into the page.
import { INKS } from '../inks.ts'

// Light and dark token defaults, then the per-ink overrides.
export const BASE_TOKENS_CSS = `
body{--bt-ink:#141414;--bt-danger:#e02135;--bt-warn:#d4a72c;--bt-ink-2:rgba(20,20,20,.72);--bt-ink-3:rgba(20,20,20,.62);--bt-bubble:#eeeeee;--bt-sidebar:#f7f7f7;--bt-main:#fcfcfc;--bt-line:rgba(20,20,20,.08);--bt-line-2:rgba(20,20,20,.15);--bt-line-weak:rgba(20,20,20,.1);--bt-hover:rgba(119,119,119,.09);--bt-active:rgba(119,119,119,.17);--bt-card:#ffffff;--bt-accent:#3d5af1;--bt-green:#00c972;--bt-star:#ff9800;--bt-user:#070707;--bt-user-ink:#fcfcfc;--bt-tag-bg:rgba(20,20,20,.06);--bt-tag-ink:rgba(20,20,20,.68)}
body[data-bt-dark]{--bt-ink:#f2f2f2;--bt-ink-2:rgba(242,242,242,.74);--bt-ink-3:rgba(242,242,242,.62);--bt-bubble:#262626;--bt-sidebar:#1b1b1b;--bt-main:#141414;--bt-line:rgba(255,255,255,.08);--bt-line-2:rgba(255,255,255,.15);--bt-line-weak:rgba(255,255,255,.1);--bt-hover:rgba(160,160,160,.12);--bt-active:rgba(160,160,160,.2);--bt-card:#1f1f1f;--bt-user:#f2f2f2;--bt-user-ink:#141414;--bt-tag-bg:rgba(255,255,255,.09);--bt-tag-ink:rgba(242,242,242,.72)}
${Object.entries(INKS).map(([name, [light]]) => `body{--bt-ink-${name}:${light}}`).join('')}
${Object.entries(INKS).map(([name, [, dark]]) => `body[data-bt-dark]{--bt-ink-${name}:${dark}}`).join('')}`

// -------------------------------------------------------------------------

// The host's module system claims every <style> without a `data-plugin` for the module
// it is materializing and deletes a module's styles when it unloads. Ours carry our
// module id from the start, so another module's claim or teardown never takes them.
const PLUGIN_ID = 'moon-bot'

/** Append a style tag owned by this plugin and return it. */
export function installStyles(text: string, tag: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.dataset.moonBot = tag
  style.dataset.plugin = PLUGIN_ID
  style.textContent = text
  document.head.appendChild(style)
  return style
}

// Shell chrome only exposes hashed CSS-module classes (`hem6sG_footArea`,
// `_bubble_12mhf_1`), so the overrides above match on name fragments. Substring
// attribute selectors bypass the style engine's class index, and ~20 of them made
// every style recalc about ten times slower. Rewrite each one into the exact class
// names defined by the loaded stylesheets; keep the substring form when none match.
const FRAGMENT_SELECTOR = /\[class\*="(_[\w-]+)"\]/g
const CLASS_TOKEN = /\.((?:\\.|[\w-])+)/g

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return 'selectorText' in rule && typeof (rule as CSSStyleRule).selectorText === 'string'
}

function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule
}

function sheetClassNames(sheet: CSSStyleSheet): string[] {
  const names: string[] = []
  const visit = (rules: CSSRuleList): void => {
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index]
      if (!rule) continue
      if (isStyleRule(rule)) for (const match of rule.selectorText.matchAll(CLASS_TOKEN)) names.push(match[1] ?? '')
      if (isGroupingRule(rule)) visit(rule.cssRules)
    }
  }
  try { visit(sheet.cssRules) } catch { /* cross-origin sheet */ }
  return names
}

function compileFragmentSelectors(text: string, names: Iterable<string>): string {
  const compiled = new Map<string, string>()
  return text.replace(FRAGMENT_SELECTOR, (whole: string, fragment: string): string => {
    const done = compiled.get(fragment)
    if (done !== undefined) return done
    const exact: string[] = []
    for (const name of names) if (name.includes(fragment)) exact.push(`.${name}`)
    const replacement = exact.length > 0 ? `:is(${exact.join(',')})` : whole
    compiled.set(fragment, replacement)
    return replacement
  })
}

/**
 * Install a sheet whose class-fragment selectors are resolved against the loaded
 * stylesheets, and keep resolving them as the shell lazily appends sheets.
 * Returns the disposer that removes the tag and its listeners.
 */
export function installCompiledStyles(text: string, tag: string): () => void {
  const style = installStyles('', tag)
  let disposed = false
  const cache = new WeakMap<CSSStyleSheet, string[]>()
  const render = (): void => {
    if (disposed) return
    // A tag removed out from under us (not by the module system, which owns it) goes back.
    if (!style.isConnected) document.head.appendChild(style)
    const names = new Set<string>()
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode as (Node & { dataset?: DOMStringMap }) | null
      if (owner?.dataset?.moonBot !== undefined) continue
      let list = cache.get(sheet)
      if (!list) { list = sheetClassNames(sheet); cache.set(sheet, list) }
      for (const name of list) names.add(name)
    }
    const next = compileFragmentSelectors(text, names)
    if (style.textContent !== next) style.textContent = next
  }
  render()
  // Lazily loaded shell features append their own sheets later.
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => { clearTimeout(timer); timer = setTimeout(render, 120) }
  const onLoad = (event: Event): void => { if (event.target instanceof HTMLLinkElement) schedule() }
  // Our own sheets name no shell classes, so adding one (the panel's first open adds the
  // chat column's rule) recompiles nothing. Our own node coming out is a removal to undo,
  // which render sees without a recompile.
  const shell = (node: Node): boolean => (node as Partial<HTMLElement>).dataset?.moonBot === undefined
  const observer = new MutationObserver((records: MutationRecord[]): void => {
    if (records.some(record => [...record.removedNodes].includes(style))) render()
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(shell))) schedule()
  })
  observer.observe(document.head, { childList: true })
  document.addEventListener('load', onLoad, true)
  return (): void => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('load', onLoad, true)
    clearTimeout(timer)
    style.remove()
  }
}

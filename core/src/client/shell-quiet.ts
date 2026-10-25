import { productName } from './i18n.ts'
import { FAVICON } from './brand-art.ts'
// Moon Bot patch: one onboarding, not three. On a first start DSH opens its own "Get started"
// sign-in dialog and a preview notice on top of Chief's model choice; Chief already offers
// the same three ways in (account, API key, custom model). Both are closed once, as they
// open; a sign-in the user asks for through Chief's chips is left alone.
let userAsked = false
export const noteSignInAsked = (): void => { userAsked = true }

const isPreviewNotice = (dialog: Element): boolean => {
  const text = dialog.textContent ?? ''
  if (!/DeepSeek Harness/.test(text)) return false
  // Version text changes across DSH builds; the Continue CTA marks the preview splash.
  return Array.from(dialog.querySelectorAll('button')).some(node => /^(继续|Continue)$/u.test((node.textContent ?? '').trim()))
}
const signInRoot = (): Element | null => document.querySelector('[class*="_76YFJG_"]')

export interface QuietOnboardingOptions {
  readonly windowMs?: number
}

export function quietShellOnboarding({ windowMs = 20_000 }: QuietOnboardingOptions = {}): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const started = Date.now()
  const sweep = (): void => {
    for (const dialog of document.querySelectorAll('[role=dialog]')) {
      if (!isPreviewNotice(dialog)) continue
      const button = Array.from(dialog.querySelectorAll('button')).find(node => /^(继续|Continue)$/u.test((node.textContent ?? '').trim()))
      ;(button as HTMLElement | undefined)?.click()
    }
    const signIn = signInRoot()
    if (signIn && !userAsked && Date.now() - started < windowMs) {
      const box = signIn.closest('[role=dialog]') ?? signIn.parentElement
      const close = box?.querySelector('button[aria-label="关闭"], button[aria-label="Close"]')
      if (close) (close as HTMLElement).click()
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
  }
  const observer = new MutationObserver(sweep)
  observer.observe(document.body, { childList: true, subtree: true })
  sweep()
  const stop = setTimeout(() => observer.disconnect(), windowMs + 40_000)
  return () => { clearTimeout(stop); observer.disconnect() }
}

// Moon Bot patch: DSH's General settings name the DSH runtime ("当前版本：0.2.1-rc.2"); the
// person runs Moon Bot, so the line names the app's version and the runtime after it.
const VERSION_LINE = /^(当前版本：|Current version: )(\d[\w.-]*)$/u
export function relabelShellVersion(appVersion: string): () => void {
  if (typeof MutationObserver === 'undefined' || !appVersion) return () => {}
  const fix = (): void => {
    if (!document.querySelector('[role=dialog]')) return
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = VERSION_LINE.exec((node.nodeValue ?? '').trim())
      if (match) node.nodeValue = `${match[1] ?? ''}${productName()} ${appVersion}（DSH ${match[2] ?? ''}）`
    }
  }
  const observer = new MutationObserver(fix)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}

// The tab shows the Moon Bot tile, and the page title says the app's name where DSH puts its own ("Chief — DeepSeek Harness").
export function relabelTitle(): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.head) return () => {}
  const fix = (): void => {
    const icon = document.head.querySelector('link[rel~="icon"]')
    if (icon?.getAttribute('href') !== FAVICON) {
      const link = (icon ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))) as HTMLLinkElement
      link.setAttribute('href', FAVICON)
      link.setAttribute('type', 'image/png')
    }
    const name = productName()
    const next = document.title.includes('DeepSeek Harness') ? document.title.replace('DeepSeek Harness', name) : document.title || name
    if (next !== document.title) document.title = next
  }
  fix()
  const observer = new MutationObserver(fix)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}

// Moon Bot patch: DSH General settings still offer "Upload Session Log to help improve
// DeepSeek". That is upstream telemetry branding, not Moon Bot — hide those CTAs.
const DEEPSEEK_CTA = /Session Log|帮助改进\s*DeepSeek|help improve DeepSeek|Improve DeepSeek/i
export function quietShellDeepSeekCtas(): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const hide = (): void => {
    for (const node of document.querySelectorAll('button, a, [role=button]')) {
      const label = `${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`
      if (!DEEPSEEK_CTA.test(label)) continue
      const row = node.closest('[class*="row"], [class*="Row"], li, section, div') ?? node
      if (row instanceof HTMLElement) row.style.display = 'none'
    }
  }
  const observer = new MutationObserver(hide)
  observer.observe(document.body, { childList: true, subtree: true })
  hide()
  return () => observer.disconnect()
}

// Moon Bot patch: DSH paints approval-rejection tool errors in English into the chat.
// Rewrite known refusal lines in place so chat matches the Chinese hostText map.
const REJECT_LINE = /^(?:Error:\s*)?the user rejected escalating this command to ([\w-]+)\.?$/i
const REJECT_PLAIN = /^(?:Error:\s*)?the user rejected(?: this (?:command|action|request))?\.?$/i
export function quietShellRejectionCopy(): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const fix = (): void => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const raw = (node.nodeValue ?? '').trim()
      if (!raw || raw.length > 200) continue
      let next: string | null = null
      const m = REJECT_LINE.exec(raw)
      if (m) {
        const preset = (m[1] ?? '').toLowerCase()
        next = preset === 'danger-full-access' ? '你拒绝了完全访问权限，命令没有执行'
          : preset === 'workspace-write' ? '你拒绝了工作区写入权限，命令没有执行'
            : `你拒绝了权限提升（${m[1] ?? ''}），命令没有执行`
      } else if (REJECT_PLAIN.test(raw)) next = '你拒绝了这次操作，命令没有执行'
      if (next && node.nodeValue !== next) node.nodeValue = next
    }
  }
  const observer = new MutationObserver(fix)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  fix()
  return () => observer.disconnect()
}

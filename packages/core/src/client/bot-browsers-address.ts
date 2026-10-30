// Address-bar parsing, blocked hosts, and the drawer preview script.
import { STORAGE } from './storage.ts'
import type { BrowserPage } from './bot-browsers-types.ts'

export const STORE_KEY = STORAGE.browsers
// Each live guest is a renderer process; past this many across every Bot and tab,
// the least recently shown one is released (its address and excerpt are kept and
// it reloads when it is shown again).
export const MAX_LIVE = 6
export const READ_TIMEOUT_MS = 10_000
export const PREVIEW_TIMEOUT_MS = 3000
export const RESIZE_LATER_MS = 200
export const SEARCH_URL = 'https://www.bing.com/search?q='
// The drawer cards preview a page by its own words: its description, else its first
// real paragraph. Webview capturePage() is not used: on Windows a failed capture
// (UnknownVizError) takes the whole app renderer down.
export const PREVIEW_SCRIPT = `(() => {
  const meta = key => document.querySelector('meta[name="' + key + '"],meta[property="' + key + '"]')?.content ?? ''
  const paragraph = [...document.querySelectorAll('main p, article p, p')].map(node => node.innerText ?? '').find(text => text.trim().length > 40) ?? ''
  const text = meta('description') || meta('og:description') || paragraph || document.body?.innerText || ''
  return text.replace(/\\s+/g, ' ').trim().slice(0, 200)
})()`

export const EMPTY: BrowserPage = { url: '', title: '', favicon: null, loading: false, canGoBack: false, canGoForward: false, error: null, live: false, excerpt: '' }
// Local and LAN pages open; cloud metadata services do not, since on a cloud machine they
// hand out account credentials. The Desktop shell already refuses its own host port.
export const METADATA_HOST = /^(169\.254\.\d+\.\d+|\[fd00:ec2::254\]|metadata\.google\.internal)$/i
export const BLOCKED = 'Cloud metadata addresses do not open here.'
export const blockedAddress = (url: string): boolean => URL.canParse(url) && METADATA_HOST.test(new URL(url).hostname)

/**
 * An address-bar entry as a URL: an explicit http(s) URL, a host (local and private
 * addresses over http), or else a web search.
 */
export function browserAddress(input: unknown): string | null {
  const text = String(input ?? '').trim()
  if (text === '') return null
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return /^https?:\/\//i.test(text) && URL.canParse(text) ? new URL(text).href : null
  if (/^(about|javascript|data|file|blob|chrome|devtools|view-source):/i.test(text)) return null
  const host = text.split(/[/?#]/)[0] ?? ''
  const local = /^(localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[[\da-f:]+\])(:\d+)?$/i.test(host)
  const looksLikeHost = !/\s/.test(text) && (local || /^[^\s.]+(\.[^\s.]+)+(:\d+)?$/.test(host))
  if (looksLikeHost && URL.canParse(`http://${text}`)) return new URL(`${local ? 'http' : 'https'}://${text}`).href
  return `${SEARCH_URL}${encodeURIComponent(text)}`
}

/**
 * @param options the Desktop bridge, the store factory the sources come from, and where
 * tabs are saved.
 */

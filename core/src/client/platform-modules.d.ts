// The Desktop bridge the window may carry; the Web build has no such member.
interface Window { dshDesktop?: DshDesktopBridge; dsBotApp?: DsBotAppBridge }
// The Web Speech API, which the composer's dictation uses. TypeScript's DOM lib does
// not declare it; only the members this client reads are named.
interface SpeechRecognitionAlternativeLike { readonly transcript: string }
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionResultsLike {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultsLike
}
interface SpeechRecognitionErrorLike { readonly error: string }
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
interface SpeechRecognitionCtor { new (): SpeechRecognitionLike }
interface Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

// The desktop app bridge: where its data lives, and the engine it downloads.
interface DsDataLocation {
  path: string
  fixed: boolean
}
interface DsBotAppBridge {
  dataLocation: () => Promise<DsDataLocation>
  moveData: (workspace?: string) => Promise<unknown>
  teamWorkspaceChanged: (path: string) => void
  engine?: unknown
  updates?: unknown
}

// One Bot's browser lease. `partition` keeps its cookies and logins apart from every
// other Bot; `onOpenRequested` answers a page that asks for a new window with the new
// tab's URL and returns the unsubscribe.
interface DshBrowserLease {
  lease: string
  partition: string
}
interface DshBrowserBridge {
  acquire(key: string): Promise<DshBrowserLease>
  release(lease: string): Promise<unknown>
  onOpenRequested(lease: string, listener: (url: string) => void): () => void
}
// What the Desktop app's own updater reports, beside the plugin's update check.
interface DshAppUpdate {
  phase?: string
  version?: string
  [key: string]: unknown
}
interface DshAppUpdatesBridge {
  status: () => Promise<DshAppUpdate | undefined>
  subscribe: (listener: (app: DshAppUpdate | undefined) => void) => (() => void) | undefined
  open: () => Promise<unknown>
}
interface DshDesktopBridge {
  protocolVersion?: number
  updates?: DshAppUpdatesBridge
  browser?: DshBrowserBridge
}

// Electron's guest callbacks carry more than a plain Event.
interface WebviewNavigationEvent extends Event {
  url: string
  isMainFrame: boolean
}
interface WebviewLoadFailEvent extends Event {
  errorCode: number
  errorDescription: string
  isMainFrame: boolean
}
interface WebviewFaviconEvent extends Event {
  favicons: readonly string[]
}
interface WebviewEventMap {
  'dom-ready': Event
  'did-navigate': Event
  'did-navigate-in-page': Event
  'did-start-loading': Event
  'did-stop-loading': Event
  'page-title-updated': Event
  'page-favicon-updated': WebviewFaviconEvent
  'did-start-navigation': WebviewNavigationEvent
  'did-fail-load': WebviewLoadFailEvent
  'render-process-gone': Event
}

// The Electron <webview> the Desktop shell provides. `executeJavaScript` returns whatever
// the page script evaluates to, so the caller names the result type.
interface WebviewElement extends HTMLElement {
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  clearHistory(): void
  loadURL(url: string): Promise<void>
  stop(): void
  reload(): void
  goBack(): void
  goForward(): void
  focus(): void
  executeJavaScript<T = unknown>(code: string): Promise<T>
  addEventListener<K extends keyof WebviewEventMap>(type: K, listener: (event: WebviewEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
}
interface HTMLElementTagNameMap { webview: WebviewElement }

// react-dom is a runtime dependency the shell supplies; only its types are missing here,
// so declare the one function the client calls. A portal is a React child either way.
declare module 'react-dom' {
  import type { ReactNode } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactNode
}

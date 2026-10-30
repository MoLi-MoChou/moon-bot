// The interface copy's key type: every key in the dictionary, and any host or webview
// string that is not one (those pass through unchanged).
export type I18nKey = keyof (typeof import('./zh.ts'))['ZH'] | (string & {})

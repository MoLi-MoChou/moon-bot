// The frameless Windows window: the system caption buttons overlay a band at the top of the
// page, as in DeepSeek Harness apps/desktop (windows-layout.ts and main.ts; see NOTICE).

/** Height of the caption band in device-independent pixels. */
export const CAPTION_HEIGHT = 40

/** Electron's Mica backdrop needs the system backdrop of Windows 11 22H2 (build 22621). */
export function micaAvailable(platform: string, release: string): boolean {
  return platform === 'win32' && Number(String(release).split('.')[2] ?? 0) >= 22621
}

const COLOR = /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu
/** Only plain CSS colors cross from the page to the caption buttons. */
export const cssColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value)

export type NativeThemeSource = 'light' | 'dark' | 'system'

/** The theme sources that the native theme accepts; a theme id has no native counterpart. */
export const nativeThemeSource = (value: unknown): NativeThemeSource | undefined =>
  value === 'light' || value === 'dark' || value === 'system' ? value : undefined

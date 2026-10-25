// The team's theme, painted the way the plugin host paints it (core/src/client/
// client-install.ts): the chosen theme's tokens on `html body`, the id on
// `body[data-bt-theme]` for the rules that switch on it, and Moon when nothing is chosen.
import { allThemes, resolveThemeId, themeCss, type ThemeDefinition } from '../../../core/src/client/themes.ts'

/** The theme a window with no saved choice paints. */
export const DEFAULT_THEME = 'moon'

export interface ThemePrefs {
  readonly theme?: unknown
  readonly accent?: unknown
  readonly motion?: unknown
}

/** The id to paint for a set of preferences: the saved one, or Moon. */
export function themeIdOf(prefs: ThemePrefs | undefined): string {
  const themes = allThemes()
  const saved = typeof prefs?.theme === 'string' ? prefs.theme : ''
  return resolveThemeId(themes, saved === '' ? DEFAULT_THEME : saved)
}

let painted: { style: HTMLStyleElement, id: string } | undefined

/** Paints the theme; calling it again with another id replaces the previous tokens. */
export function applyTheme(prefs: ThemePrefs | undefined): string {
  const themes: Record<string, ThemeDefinition> = allThemes()
  const id = themeIdOf(prefs)
  const theme: ThemeDefinition | undefined = themes[id] ?? themes[DEFAULT_THEME]
  const accent = typeof prefs?.accent === 'string' && prefs.accent !== '' ? prefs.accent : undefined
  if (theme !== undefined) {
    painted?.style.remove()
    const style = document.createElement('style')
    style.dataset.dshBot = 'theme'
    style.dataset.plugin = 'ds-bot'
    style.textContent = themeCss(theme, accent)
    document.head.append(style)
    painted = { style, id }
  }
  // The rules that follow a theme (bubbles, sidebar, composer) read this attribute.
  document.body.dataset.btTheme = id
  const motion = typeof prefs?.motion === 'string' && prefs.motion !== '' ? prefs.motion : undefined
  if (motion !== undefined) document.body.dataset.btMotion = motion
  else delete document.body.dataset.btMotion
  return id
}

/** The system's light or dark mode, which the Bot views read as a body attribute. */
export function followSystemAppearance(): () => void {
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const paint = (): void => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }
  paint()
  dark.addEventListener('change', paint)
  return () => { dark.removeEventListener('change', paint) }
}

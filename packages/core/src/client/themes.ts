import { ACCENT_INKS, INKS, isHex, luminance } from './inks.ts'
import { SHAPES as SHAPE_DEFS, markupCache, maskCache } from './characters.ts'

interface ShapeEntry {
  label?: string
  size?: number
  body?: (paint: string) => string
  eyes?: readonly unknown[]
  wrap?: string
}
const SHAPES = SHAPE_DEFS as unknown as Record<string, ShapeEntry>
import { createSource } from './sources.ts'

export interface ThemeMode {
  bg: string
  sidebar: string
  bubble: string
  card: string
  text: string
  user: string
  userText: string
  accent: string
}
export interface ThemeTokens {
  readonly [name: string]: { readonly light: string; readonly dark: string }
}
export interface ThemeDefinition {
  readonly label?: string
  readonly light: ThemeMode
  readonly dark: ThemeMode
  readonly tokens?: ThemeTokens
  readonly css?: string
}
export interface CustomShape {
  readonly label?: string
  readonly size?: number
  readonly body: (paint: string) => string
  readonly wrap?: string
  readonly eyes?: {
    readonly at: readonly (readonly [number, number])[]
    readonly w?: number
    readonly h?: number
    readonly tilt?: number
  }
}

// -------------------------------------------------------------------------
// Themes. A theme names eight colors per mode; every `--bt-*` variable and the shell
// tokens derive from them, so a registered theme recolors the whole team UI.

const THEME_KEYS = ['bg', 'sidebar', 'bubble', 'card', 'text', 'user', 'userText', 'accent'] as const
// Moon Bot: four themes, each light and dark (Moon is the default). Each also sets the DeepSeek Harness
// tokens (`tokens`, light/dark pairs) and extra CSS (`css`) for corner radii, type and
// borders, so the host's settings, OpenUI cards and dialogs follow the theme too.
const SERIF = 'ui-serif,Georgia,Cambria,"Times New Roman","Songti SC","Noto Serif CJK SC",serif'
const both = <T>(value: T): { light: T; dark: T } => ({ light: value, dark: value })
const SANS_GROK = '"Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
// Each theme differs at a glance, not only in its accent: surface ladder, how replies
// sit (glossy bubble, flat bubble, plain serif prose, plain text), the user's bubble,
// corner radii, type and the composer.
const THEMES: Record<string, ThemeDefinition> = {
  // Moon Bot's own theme, from the Main Bot's lilac moon sprite: a luminous lilac wash,
  // a clearly lilac sidebar, white glossy reply bubbles, a lilac-gradient user bubble
  // with white text, round corners and a soft glow. Deep violet night by dark. The default.
  moon: {
    label: 'Moon',
    light: { bg: '#f8f5ff', sidebar: '#efe7ff', bubble: '#ffffff', card: '#ffffff', text: '#2b2140', user: '#744be4', userText: '#ffffff', accent: '#744be4' },
    dark: { bg: '#130f1f', sidebar: '#1b1530', bubble: '#251d3d', card: '#211a36', text: '#f3eeff', user: '#7a56e6', userText: '#ffffff', accent: '#b69dff' },
    tokens: {
      '--dsw-radius-sm': both('10px'),
      '--dsw-radius-md': both('14px'),
      '--dsw-radius-lg': both('18px'),
      '--dsw-radius-xl': both('24px'),
    },
    css: `
html body[data-bt-theme=moon]{--bt-line:rgba(110,70,200,.10);--bt-line-2:rgba(110,70,200,.18);--bt-hover:rgba(138,99,238,.09);--bt-active:rgba(138,99,238,.17);--bt-tag-bg:rgba(138,99,238,.13);--bt-tag-ink:#5b38c4;--bt-ink-2:rgba(43,33,64,.74);--bt-ink-3:rgba(43,33,64,.66)}
html body[data-bt-theme=moon][data-bt-dark]{--bt-line:rgba(190,160,255,.12);--bt-line-2:rgba(190,160,255,.2);--bt-hover:rgba(182,157,255,.1);--bt-active:rgba(182,157,255,.2);--bt-tag-bg:rgba(182,157,255,.16);--bt-tag-ink:#cdbbff;--bt-ink-2:rgba(243,238,255,.74);--bt-ink-3:rgba(243,238,255,.6)}
body[data-bt-theme=moon] [data-conversation-scroll]{background:radial-gradient(1200px 500px at 70% -10%,rgba(160,120,255,.16),transparent 60%),radial-gradient(900px 420px at 0% 110%,rgba(255,170,220,.10),transparent 60%)}
body[data-bt-theme=moon][data-bt-dark] [data-conversation-scroll]{background:radial-gradient(1100px 520px at 70% -10%,rgba(140,95,255,.20),transparent 60%),radial-gradient(900px 420px at 0% 110%,rgba(220,120,255,.08),transparent 60%)}
body[data-bt-theme=moon] .bt-bubble{border-radius:20px;box-shadow:0 1px 2px rgba(80,50,150,.06),0 6px 18px -10px rgba(110,70,200,.28),inset 0 0 0 1px var(--bt-line)}
body[data-bt-theme=moon][data-bt-dark] .bt-bubble{box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 0 0 1px var(--bt-line)}
body[data-bt-theme=moon] .bt-ububble{border-radius:20px;background:linear-gradient(160deg,#8862f0 0%,#744be4 55%,#633ad4 100%);box-shadow:0 8px 20px -10px rgba(122,79,224,.65),inset 0 1px 0 rgba(255,255,255,.35)}
body[data-bt-theme=moon][data-bt-dark] .bt-ububble{background:linear-gradient(160deg,#9575ff 0%,#7a56e6 60%,#6640d0 100%);box-shadow:0 8px 22px -10px rgba(120,80,240,.7),inset 0 1px 0 rgba(255,255,255,.22)}
body[data-bt-theme=moon] [class*="_card"]:has([data-composer-input]){border-radius:22px;background:var(--bt-card);box-shadow:0 10px 30px -12px rgba(110,70,200,.35),inset 0 0 0 1px var(--bt-line-2)}
body[data-bt-theme=moon] [class*="_card"]:has([data-composer-input]):focus-within{box-shadow:0 12px 34px -12px rgba(110,70,200,.45),inset 0 0 0 1.5px color-mix(in srgb,var(--bt-accent) 60%,transparent)}
body[data-bt-theme=moon] :is(.bt-process,.bt-menu,.bt-update-pop,.bt-q){border-radius:18px;box-shadow:0 0 0 .5px var(--bt-line-2),0 16px 40px -14px rgba(90,50,170,.38)}
body[data-bt-theme=moon] :is(.bt-work-all,.bt-retry){border-radius:999px;border-color:color-mix(in srgb,var(--bt-accent) 35%,var(--bt-line-2))}
body[data-bt-theme=moon] .bt-pill{box-shadow:0 4px 14px -6px rgba(110,70,200,.35),inset 0 0 0 1px var(--bt-line-2)}
body[data-bt-theme=moon] .bt-tile[aria-current=page]{background:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,.35));box-shadow:0 6px 18px -10px rgba(110,70,200,.45),inset 0 0 0 1px var(--bt-line-2)}
body[data-bt-theme=moon][data-bt-dark] .bt-tile[aria-current=page]{background:rgba(182,157,255,.14)}
body[data-bt-theme=moon] [data-composer-input]{caret-color:var(--bt-accent)}
`,
  },
  // DeepSeek: crisp white and cool grey, DeepSeek blue for the accent and the user's
  // bubble tint, flat grey reply bubbles, medium radii.
  deepseek: {
    label: 'DeepSeek',
    light: { bg: '#ffffff', sidebar: '#f9fbff', bubble: '#f3f4f6', card: '#ffffff', text: '#1a1d24', user: '#e3ebff', userText: '#1b2f7a', accent: '#3d5af1' },
    dark: { bg: '#1b1c20', sidebar: '#212327', bubble: '#2a2c31', card: '#24262b', text: '#eef0f4', user: '#2b3a6b', userText: '#e6ecff', accent: '#6b84ff' },
    tokens: {
      '--dsw-radius-sm': both('6px'),
      '--dsw-radius-md': both('10px'),
      '--dsw-radius-lg': both('14px'),
      '--dsw-radius-xl': both('18px'),
    },
    css: `
html body[data-bt-theme=deepseek]{--bt-hover:rgba(77,107,254,.06);--bt-active:rgba(77,107,254,.11);--bt-tag-bg:rgba(77,107,254,.09);--bt-tag-ink:#3550d8}
html body[data-bt-theme=deepseek][data-bt-dark]{--bt-hover:rgba(107,132,255,.09);--bt-active:rgba(107,132,255,.16);--bt-tag-bg:rgba(107,132,255,.15);--bt-tag-ink:#aebcff}
body[data-bt-theme=deepseek] :is(.bt-bubble,.bt-ububble){border-radius:12px}
body[data-bt-theme=deepseek] [class*="_card"]:has([data-composer-input]){border-radius:18px;box-shadow:0 0 0 1px rgba(77,107,254,.18),0 4px 14px -6px rgba(30,50,140,.12)}
body[data-bt-theme=deepseek] [class*="_card"]:has([data-composer-input]):focus-within{box-shadow:0 0 0 1.5px var(--bt-accent),0 6px 18px -6px rgba(30,50,140,.18)}
body[data-bt-theme=deepseek] .bt-tile[aria-current=page]{background:var(--bt-active)}
body[data-bt-theme=deepseek] [data-composer-input]{caret-color:var(--bt-accent)}
`,
  },
  // Claude: warm cream paper, replies as plain serif prose with no bubble, a sand user
  // bubble, clay accent, serif headings (after open-claude-ui's cds-theme.css, MIT).
  // Colors and feel only.
  claude: {
    label: 'Claude',
    light: { bg: '#faf9f5', sidebar: '#f0ede3', bubble: '#f0eee6', card: '#ffffff', text: '#1f1e1b', user: '#e9e4d6', userText: '#1f1e1b', accent: '#b55232' },
    dark: { bg: '#262624', sidebar: '#1d1c1a', bubble: '#30302e', card: '#2f2e2b', text: '#f3f0e8', user: '#3b3a35', userText: '#f3f0e8', accent: '#d97757' },
    tokens: {
      '--dsw-radius-sm': both('6px'),
      '--dsw-radius-md': both('9px'),
      '--dsw-radius-lg': both('12px'),
      '--dsw-radius-xl': both('18px'),
    },
    css: `
html body[data-bt-theme=claude]{--bt-hover:rgba(120,90,50,.07);--bt-active:rgba(120,90,50,.13);--bt-tag-bg:rgba(201,100,66,.1);--bt-tag-ink:#964425}
html body[data-bt-theme=claude][data-bt-dark]{--bt-hover:rgba(240,220,190,.07);--bt-active:rgba(240,220,190,.13);--bt-tag-bg:rgba(217,119,87,.16);--bt-tag-ink:#eba48a}
body[data-bt-theme=claude] .bt-bubble{background:transparent!important;padding-inline:2px;font-family:${SERIF};font-size:calc(var(--bt-content-font-size,14px) + 1.5px);line-height:1.7;max-width:min(92%,680px)}
body[data-bt-theme=claude] .bt-ububble{border-radius:12px;padding-inline:14px}
body[data-bt-theme=claude] [class*="_card"]:has([data-composer-input]){border-radius:18px;box-shadow:0 2px 10px rgba(60,40,20,.06),inset 0 0 0 1px var(--bt-line-2)}
body[data-bt-theme=claude] [class*="_card"]:has([data-composer-input]):focus-within{box-shadow:0 4px 18px rgba(60,40,20,.1),inset 0 0 0 1px color-mix(in srgb,var(--bt-accent) 45%,var(--bt-line-2))}
body[data-bt-theme=claude] :is(.bt-set-section h3,.bt-drawer-name,.bt-process header strong,.bt-section-title,.bt-brand-name,.bt-tile-name,.bt-pill-name,[role=dialog] h2){font-family:${SERIF};font-weight:500;letter-spacing:-.01em}
body[data-bt-theme=claude] :is(.bt-set-section h3,.bt-section-title){font-size:15px}
body[data-bt-theme=claude] .bt-process,body[data-bt-theme=claude] .bt-menu{border-radius:12px}
body[data-bt-theme=claude] :is(.bt-work-all,.bt-retry){border-color:color-mix(in srgb,var(--bt-accent) 28%,var(--bt-line-2))}
body[data-bt-theme=claude] .bt-tile[aria-current=page]{background:var(--bt-active)}
body[data-bt-theme=claude] [data-composer-input]{caret-color:var(--bt-accent)}
`,
  },
  // Grok Bot: monochrome, pure white / true black. Replies are plain text with no
  // bubble, the user's message a soft grey pill, the foreground is the accent, hairline
  // borders, big round composer, tight geometric type (after grok.com's web UI).
  grok: {
    label: 'Grok Bot',
    light: { bg: '#ffffff', sidebar: '#ffffff', bubble: '#f4f4f4', card: '#ffffff', text: '#0d0d0d', user: '#f1f1f1', userText: '#0d0d0d', accent: '#0d0d0d' },
    dark: { bg: '#000000', sidebar: '#0a0a0a', bubble: '#161616', card: '#141414', text: '#f5f5f2', user: '#1f1f1f', userText: '#f5f5f2', accent: '#f5f5f2' },
    tokens: {
      '--dsw-radius-sm': both('10px'),
      '--dsw-radius-md': both('16px'),
      '--dsw-radius-lg': both('22px'),
      '--dsw-radius-xl': both('28px'),
      '--dsw-shadow-lv3': both('none'),
    },
    css: `
html body[data-bt-theme=grok]{--bt-line:rgba(13,13,13,.07);--bt-line-2:rgba(13,13,13,.12);--bt-hover:rgba(0,0,0,.045);--bt-active:rgba(0,0,0,.08);--bt-tag-bg:rgba(0,0,0,.06);--bt-tag-ink:#3a3a3a}
html body[data-bt-theme=grok][data-bt-dark]{--bt-line:#222;--bt-line-2:#2c2c2c;--bt-hover:#1a1a1a;--bt-active:#262626;--bt-ink-2:#b5b5b0;--bt-ink-3:#8c8c86;--bt-tag-bg:#1e1e1e;--bt-tag-ink:#bdbdb8}
body[data-bt-theme=grok]{font-family:${SANS_GROK}}
body[data-bt-theme=grok] .bt-bubble{background:transparent!important;padding-inline:2px;max-width:min(92%,700px);font-size:calc(var(--bt-content-font-size,14px) + 1px);line-height:1.65}
body[data-bt-theme=grok] .bt-ububble{border-radius:22px;padding-inline:16px}
body[data-bt-theme=grok] [class*="_card"]:has([data-composer-input]){border-radius:22px;box-shadow:inset 0 0 0 1px var(--bt-line-2);background:var(--bt-card)}
body[data-bt-theme=grok][data-bt-dark] [class*="_card"]:has([data-composer-input]){background:#141414}
body[data-bt-theme=grok] :is(.bt-set-section h3,.bt-drawer-name,.bt-process header strong,.bt-tile-name,.bt-pill-name,.bt-brand-name){font-weight:600;letter-spacing:-.015em}
body[data-bt-theme=grok] :is(.bt-process,.bt-menu,.bt-update-pop){box-shadow:0 0 0 .5px var(--bt-line-2),0 12px 32px -12px rgba(0,0,0,.25)}
body[data-bt-theme=grok] :is(.bt-work-all,.bt-retry,.bt-pill,.bt-tile-role){border-radius:999px}
body[data-bt-theme=grok] .bt-tile[aria-current=page]{background:var(--bt-active)}
body[data-bt-theme=grok] :is(.bt-sidebar,[class*="_sidebar"]){box-shadow:inset -1px 0 0 var(--bt-line)}
`,
  },
}
// Ids earlier versions saved, and what they became.
export const THEME_ALIASES: Record<string, string> = { mono: 'grok', paper: 'claude', moonlight: 'deepseek' }
export const resolveThemeId = (themes: Record<string, ThemeDefinition>, id: string): string => {
  const alias = THEME_ALIASES[id]
  return themes[id] !== undefined ? id : alias !== undefined && themes[alias] !== undefined ? alias : 'moon'
}
// Text on the accent: near-black or white, whichever has the higher WCAG contrast.
// (L + .05)² > 1.05 × (L(#141414) + .05) is "dark ink reads better".
const DARK_INK = '#141414'
const accentInk = (accent: string): string => ((luminance(accent) + 0.05) ** 2 > 1.05 * (luminance(DARK_INK) + 0.05) ? DARK_INK : '#ffffff')
const rgba = (hex: string, alpha: number): string => `rgba(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')},${alpha})`
function themeVars(mode: ThemeMode, dark: boolean, accent: string = mode.accent): Record<string, string> {
  return {
    '--bt-ink': mode.text,
    '--bt-ink-2': rgba(mode.text, dark ? 0.74 : 0.72),
    '--bt-ink-3': rgba(mode.text, dark ? 0.64 : 0.64),
    '--bt-bubble': mode.bubble,
    '--bt-sidebar': mode.sidebar,
    '--bt-main': mode.bg,
    '--bt-card': mode.card,
    '--bt-line': rgba(mode.text, 0.08),
    '--bt-line-2': rgba(mode.text, 0.15),
    '--bt-hover': dark ? 'rgba(160,160,160,.12)' : 'rgba(119,119,119,.09)',
    '--bt-active': dark ? 'rgba(160,160,160,.2)' : 'rgba(119,119,119,.17)',
    '--bt-accent': accent,
    '--bt-accent-ink': accentInk(accent),
    '--bt-user': mode.user,
    '--bt-user-ink': mode.userText,
    '--bt-tag-bg': rgba(mode.text, dark ? 0.09 : 0.06),
    '--bt-tag-ink': rgba(mode.text, dark ? 0.72 : 0.68),
  }
}
const declarations = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
// A preset accent is saved as its light value; in dark mode it takes the preset's dark
// value, as Bot names do, so Charcoal does not vanish on a dark background. A custom
// accent is the same in both modes. A preset is matched the way Settings marks it.
const darkAccent = (accent: string | undefined): string | undefined => {
  if (accent === undefined) return undefined
  const ink = ACCENT_INKS.find(id => INKS[id]?.[0] === accent)
  return ink === undefined ? accent : (INKS[ink]?.[1] ?? accent)
}
// `html body` outranks the base sheet's `body` rules without !important.
export const themeCss = (
  theme: ThemeDefinition,
  accent?: string,
): string => `html body{${declarations(themeVars(theme.light, false, accent ?? theme.light.accent))}}
html body[data-bt-dark]{${declarations(themeVars(theme.dark, true, darkAccent(accent) ?? theme.dark.accent))}}
${theme.css ?? ''}`
export const shellTokens = ({
  light,
  dark,
  tokens,
}: {
  light: ThemeMode
  dark: ThemeMode
  tokens?: ThemeTokens
}): Record<string, { light: string; dark: string }> => ({
  '--dsw-alias-bg-base': { light: light.bg, dark: dark.bg },
  '--dsw-alias-bg-layer-1': { light: light.card, dark: dark.card },
  '--dsw-alias-bg-layer-2': { light: light.bubble, dark: dark.bubble },
  '--dsw-alias-bg-layer-3': { light: light.sidebar, dark: dark.sidebar },
  '--dsw-alias-border-l2': { light: rgba(light.text, 0.06), dark: rgba(dark.text, 0.08) },
  '--dsw-alias-border-l3': { light: rgba(light.text, 0.1), dark: rgba(dark.text, 0.12) },
  '--dsw-alias-border-l4': { light: rgba(light.text, 0.16), dark: rgba(dark.text, 0.18) },
  '--dsw-alias-interactive-bg-hover': { light: rgba(light.text, 0.05), dark: rgba(dark.text, 0.08) },
  '--dsw-alias-brand-primary': { light: light.accent, dark: dark.accent },
  '--dsw-alias-state-business-primary': { light: light.accent, dark: dark.accent },
  '--dsw-alias-button-primary-fill': { light: light.accent, dark: dark.accent },
  '--dsw-alias-label-primary-foreground': { light: accentInk(light.accent), dark: accentInk(dark.accent) },
  '--dsw-focus-ring-color': { light: rgba(light.accent, 0.45), dark: rgba(dark.accent, 0.45) },
  '--dsw-alias-link': { light: light.accent, dark: dark.accent },
  ...tokens,
  '--dsw-specific-sidebar-fill': { light: light.sidebar, dark: dark.sidebar },
  '--dsw-specific-input-major': { light: light.bg, dark: dark.sidebar },
  '--dsw-alias-label-primary': { light: light.text, dark: dark.text },
  '--dsw-alias-label-secondary': { light: rgba(light.text, 0.78), dark: rgba(dark.text, 0.78) },
  '--dsw-alias-label-tertiary': { light: rgba(light.text, 0.66), dark: rgba(dark.text, 0.66) },
})

// Other modules add character shapes and themes through `window.moonBot`, or queue
// calls on `window.moonBotQueue` before this plugin loads. A shape draws only its
// body; the eyes are cut out where `eyes.at` says, so it gets every state motion free.
const customThemes: Record<string, ThemeDefinition> = {}
export const registry = createSource(0)
const isPoint = (point: unknown): point is readonly [number, number] => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
export function registerShape(id: string, shape: CustomShape): () => void {
  if (typeof id !== 'string' || !/^[a-z][\w-]{0,31}$/.test(id)) throw new Error('Shape ids are lowercase words')
  if (typeof shape?.body !== 'function' || typeof shape.body('#000') !== 'string') throw new Error('A shape needs body(paint) returning SVG markup')
  const at = shape.eyes?.at
  if (!Array.isArray(at) || at.length !== 2 || !at.every(isPoint)) throw new Error('A shape needs eyes.at: two [x, y] points')
  const size = shape.size !== undefined && Number.isFinite(shape.size) && shape.size > 0 ? shape.size : 100
  const eyeNumbers = shape.eyes
  const pick = (key: 'w' | 'h' | 'tilt', fallback: number): number => {
    const value = eyeNumbers?.[key]
    return value !== undefined && Number.isFinite(value) ? value : fallback
  }
  const eyes = at.map(([x, y]) => [x, y, pick('w', size * 0.1), pick('h', size * 0.23), pick('tilt', -27)])
  const previous = SHAPES[id]
  SHAPES[id] = {
    label: String(shape.label ?? id),
    size,
    body: shape.body,
    eyes,
    ...(typeof shape.wrap === 'string' ? { wrap: shape.wrap } : {}),
  }
  const refresh = (): void => {
    markupCache.clear()
    maskCache.delete(id)
    registry.set((value: number) => value + 1)
  }
  refresh()
  return () => {
    if (previous) SHAPES[id] = previous
    else delete SHAPES[id]
    refresh()
  }
}
export function registerTheme(id: string, theme: ThemeDefinition): () => void {
  if (typeof id !== 'string' || !/^[a-z][\w-]{0,31}$/.test(id)) throw new Error('Theme ids are lowercase words')
  for (const mode of ['light', 'dark'] as const) {
    for (const key of THEME_KEYS) if (!isHex(theme[mode][key])) throw new Error(`Theme ${mode}.${key} must be a #rrggbb color`)
  }
  const previous = customThemes[id]
  customThemes[id] = { label: String(theme.label ?? id), light: theme.light, dark: theme.dark, css: typeof theme.css === 'string' ? theme.css : '' }
  registry.set((value: number) => value + 1)
  return () => {
    if (previous) customThemes[id] = previous
    else delete customThemes[id]
    registry.set((value: number) => value + 1)
  }
}
export const allThemes = (): Record<string, ThemeDefinition> => ({ ...THEMES, ...customThemes })

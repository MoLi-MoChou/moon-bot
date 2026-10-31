// How much the surface behind a floating layer shows through. It is a property of this
// device — a phone and a desktop want different amounts — so it stays in browser storage
// and never travels in the team's preferences. The value only sets `body[data-bt-glass]`;
// every rule that blurs reads the `--bt-glass-*` tokens, so a browser without
// `backdrop-filter` gets the opaque tint instead of a see-through layer it cannot blur.
import { STORAGE } from './storage.ts'

export const GLASS_LEVELS = ['off', 'light', 'standard', 'strong'] as const
export type GlassLevel = (typeof GLASS_LEVELS)[number]

/** What a device that never chose sees: the value the design shipped with. */
export const GLASS_DEFAULT: GlassLevel = 'standard'

/** The label a settings row shows for a level. */
export const GLASS_LABELS: Record<GlassLevel, string> = {
  off: 'Off',
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
}

/** The event a settings row fires so the shell repaints at once. */
export const GLASS_EVENT = 'moon-bot:glass'

const isLevel = (value: unknown): value is GlassLevel =>
  typeof value === 'string' && (GLASS_LEVELS as readonly string[]).includes(value)

/** The saved level, or the shipped default when nothing usable is stored. */
export function readGlass(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): GlassLevel {
  try {
    const saved = storage?.getItem(STORAGE.glass)
    return isLevel(saved) ? saved : GLASS_DEFAULT
  } catch {
    return GLASS_DEFAULT
  }
}

/** Paints the level on the document; the CSS tokens do the rest. */
export function applyGlass(
  level: GlassLevel,
  body: { dataset: Record<string, string | undefined> } | undefined = globalThis.document?.body,
): void {
  if (body === undefined) return
  // `standard` is the token default, so it removes the attribute instead of naming it.
  if (level === GLASS_DEFAULT) delete body.dataset.btGlass
  else body.dataset.btGlass = level
}

/** Saves the level and paints it, telling the shell to repaint. */
export function setGlass(
  level: GlassLevel,
  {
    storage = globalThis.localStorage,
    dispatch = (): void => {},
  }: { storage?: Pick<Storage, 'setItem'> | undefined; dispatch?: (() => void) | undefined } = {},
): GlassLevel {
  try {
    storage?.setItem(STORAGE.glass, level)
  } catch {
    /* storage unavailable: the level still applies for this session */
  }
  applyGlass(level)
  dispatch()
  return level
}

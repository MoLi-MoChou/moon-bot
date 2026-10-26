// The painters of the Bot surface: the character marks behind "@" mentions, the shared
// theme and its DSH tokens, and the hub other plugins register shapes and themes through.

import { DEFAULT_MASK, SHAPES, lookOf, maskOf } from './characters.ts'
import type { ClientContext, Disposer, DshBotHub, DshBotTask } from './client-ctx.js'
import type { ClientState } from './client-types.ts'
import { installStyles } from './ui/design/index.ts'
import { noteClientError } from './diagnostics.ts'
import { isHex, inkText, paintCss } from './inks.ts'
import { STORAGE } from './storage.ts'
import { MENTION_ORIGIN } from './text.ts'
import { allThemes, registry, registerShape, registerTheme, resolveThemeId, shellTokens, themeCss } from './themes.ts'

const PREFS_KEY = STORAGE.prefs

// Mentions wear each Bot's color and character silhouette (or its photo). A message
// DSH still draws itself, while it waits to be sent or to join a running turn, shows
// "@Name" as a file reference; one whose label is a whole Bot name wears the Bot's
// mark there too (a name with a space is cut by DSH, so it stays as DSH draws it).
export function installMentions(client: ClientState): Disposer {
  const style = installStyles('', 'mentions')
  let last = ''
  const render = (): void => {
    const next = client.roster.getSnapshot().bots.map((bot) => {
      const anchor = `.bt-bubble a[href="${MENTION_ORIGIN}${bot.id}"]`
      const chip = /\s/.test(bot.name) ? '' : `[class*="_userRow"] [data-ref-chip="file"][title="@${bot.name.replace(/["\\]/g, '\\$&')}" i]`
      const look = lookOf(bot)
      const marks = chip ? `${anchor}::before,${chip}::before` : `${anchor}::before`
      const mark = look.image
        ? `${marks}{background:center/cover url("${look.image}");-webkit-mask:none;mask:none;border-radius:50%}`
        : `${marks}{background:${paintCss(look.color)};-webkit-mask-image:${maskOf(look.shape)};mask-image:${maskOf(look.shape)}}`
      const chipBase = chip ? `${chip}{color:inherit;font-weight:600}${chip}>svg{display:none}${chip}::before{content:"";display:inline-block;flex:none;width:16px;height:16px;margin-right:3px;vertical-align:-3px;-webkit-mask:${DEFAULT_MASK} center/contain no-repeat;mask:${DEFAULT_MASK} center/contain no-repeat}` : ''
      return `${anchor}{color:${inkText(look.color)}}${chipBase}${mark}`
    }).join('\n')
    if (next !== last) style.textContent = last = next
  }
  render()
  const offRoster = client.roster.subscribe(render)
  const offRegistry = registry.subscribe(render)
  return () => { offRoster(); offRegistry(); style.remove() }
}

// The chosen theme lives in the team state so every device shares it; the local
// copy only avoids a flash of the default theme before the first state pull.
export function installTheme({ ctx, client }: { ctx: ClientContext; client: ClientState }): Disposer {
  const style = installStyles('', 'theme')
  let key = ''
  let releaseTokens: Disposer | null = null
  const render = (): void => {
    const snapshot = client.roster.getSnapshot()
    const prefs = snapshot.ready ? snapshot.prefs : client.savedPrefs
    const themes = allThemes()
    const id = resolveThemeId(themes, String(prefs.theme ?? ''))
    const accent = isHex(prefs.accent) ? prefs.accent : undefined
    document.body.dataset.btTheme = id
    const motion = prefs.motion === 'quiet' || prefs.motion === 'lively' ? prefs.motion : 'normal'
    document.body.dataset.btMotion = motion
    const next = `${id}|${accent ?? ''}|${motion}|${registry.getSnapshot()}`
    if (next === key) return
    key = next
    const theme = themes[id]
    if (theme === undefined) return
    style.textContent = themeCss(theme, accent)
    const release = releaseTokens
    releaseTokens = ctx.theme.overrideTokens('ds-bot', shellTokens(accent ? { ...theme, light: { ...theme.light, accent }, dark: { ...theme.dark, accent } } : theme))
    if (typeof release === 'function') release()
    if (snapshot.ready) {
      try { localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: prefs.theme, accent: prefs.accent, motion: prefs.motion })) } catch { /* storage unavailable */ }
    }
  }
  render()
  const offRoster = client.roster.subscribe(render)
  const offRegistry = registry.subscribe(render)
  return () => {
    offRoster()
    offRegistry()
    try {
      if (typeof releaseTokens === 'function') releaseTokens()
    } finally {
      delete document.body.dataset.btMotion
      style.remove()
    }
  }
}

// Other plugins add character shapes and themes through `window.dshBot`, or queue
// calls on `window.dshBotQueue` before this plugin loads.
export function installRegistry(ctx: ClientContext): Disposer {
  return ctx.effect(() => {
    const hub: DshBotHub = { registerShape, registerTheme, themes: () => Object.keys(allThemes()), shapes: () => Object.keys(SHAPES) }
    const queue = window.dshBotQueue
    const queued: readonly DshBotTask[] = Array.isArray(queue) ? queue : []
    window.dshBot = hub
    window.dshBotQueue = { push: (task: DshBotTask) => { try { task(hub) } catch (error) { console.warn('[ds-bot] registration', error); noteClientError('registration', error) } } }
    for (const task of queued) window.dshBotQueue.push(task)
    return () => {
      if (window.dshBot === hub) delete window.dshBot
      delete window.dshBotQueue
    }
  }, 'ds-bot: registry')
}

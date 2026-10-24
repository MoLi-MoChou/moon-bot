import assert from 'node:assert/strict'
import { test } from 'node:test'
import { luminance } from '../src/client/inks.ts'
import { allThemes, shellTokens, themeCss } from '../src/client/themes.ts'

const parse = (color) => {
  const c = color.trim()
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return { hex: `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase(), alpha: 1 }
  }
  if (/^#[0-9a-f]{6}$/i.test(c)) return { hex: c.toLowerCase(), alpha: 1 }
  const match = c.match(/^rgba?\(([^)]+)\)$/i)
  if (!match) throw new Error(`Cannot parse color: ${color}`)
  const parts = match[1].split(',').map(Number)
  return {
    hex: `#${parts.slice(0, 3).map(part => Math.round(part).toString(16).padStart(2, '0')).join('')}`,
    alpha: parts[3] ?? 1,
  }
}

const over = (top, under) => {
  const { hex, alpha } = parse(top)
  if (alpha === 1) return hex
  const base = parse(under).hex
  const ch = (color, index) => parseInt(color.slice(index, index + 2), 16)
  return `#${[1, 3, 5].map(index => Math.round(ch(hex, index) * alpha + ch(base, index) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

const contrast = (ink, paper) => {
  const [a, b] = [luminance(ink), luminance(paper)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

function effectiveVars(id, theme, dark) {
  const css = themeCss(theme)
  const baseSelector = dark ? 'html body[data-ds-dark-theme]{' : 'html body{'
  const themeSelector = dark
    ? `html body[data-bt-theme=${id}][data-ds-dark-theme]{`
    : `html body[data-bt-theme=${id}]{`
  const vars = {}
  for (const line of css.split(/\r?\n/)) {
    if (line.startsWith(baseSelector) || line.startsWith(themeSelector)) {
      const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))
      for (const decl of body.split(';')) {
        const at = decl.indexOf(':')
        if (at > 0) vars[decl.slice(0, at).trim()] = decl.slice(at + 1).trim()
      }
    }
  }
  return vars
}

test('all four built-in themes (moon, deepseek, claude, grok) in light and dark meet >= 4.5:1 contrast for body text, secondary text, muted/icon tokens, tags, user bubbles, and accents', () => {
  const themes = allThemes()
  for (const id of ['moon', 'deepseek', 'claude', 'grok']) {
    const theme = themes[id]
    assert.ok(theme, `missing theme ${id}`)
    const tokens = shellTokens(theme)
    for (const dark of [false, true]) {
      const mode = dark ? 'dark' : 'light'
      const vars = effectiveVars(id, theme, dark)
      const main = vars['--bt-main']
      const sidebar = over(vars['--bt-sidebar'], main)
      const card = over(vars['--bt-card'], main)
      const bubble = (id === 'claude' || id === 'grok') ? main : over(vars['--bt-bubble'], main)
      const activeSidebar = over(vars['--bt-active'], sidebar)
      const tagBgMain = over(vars['--bt-tag-bg'], main)
      const tagBgSidebar = over(vars['--bt-tag-bg'], sidebar)
      const userBg = over(vars['--bt-user'], main)

      const pairs = [
        ['--bt-ink on --bt-main', over(vars['--bt-ink'], main), main, 4.5],
        ['--bt-ink on --bt-sidebar', over(vars['--bt-ink'], sidebar), sidebar, 4.5],
        ['--bt-ink on --bt-card', over(vars['--bt-ink'], card), card, 4.5],
        ['--bt-ink on --bt-bubble', over(vars['--bt-ink'], bubble), bubble, 4.5],
        ['--bt-ink-2 on --bt-main', over(vars['--bt-ink-2'], main), main, 4.5],
        ['--bt-ink-2 on --bt-sidebar', over(vars['--bt-ink-2'], sidebar), sidebar, 4.5],
        ['--bt-ink-2 on active sidebar row', over(vars['--bt-ink-2'], activeSidebar), activeSidebar, 4.5],
        ['--bt-ink-2 on --bt-card', over(vars['--bt-ink-2'], card), card, 4.5],
        ['--bt-ink-2 on --bt-bubble', over(vars['--bt-ink-2'], bubble), bubble, 4.5],
        ['--bt-ink-3 on --bt-main', over(vars['--bt-ink-3'], main), main, 4.5],
        ['--bt-ink-3 on --bt-sidebar', over(vars['--bt-ink-3'], sidebar), sidebar, 4.5],
        ['--bt-ink-3 on --bt-card', over(vars['--bt-ink-3'], card), card, 4.5],
        ['--bt-user-ink on --bt-user', over(vars['--bt-user-ink'], userBg), userBg, 4.5],
        ['--bt-tag-ink on --bt-tag-bg (main)', over(vars['--bt-tag-ink'], tagBgMain), tagBgMain, 4.5],
        ['--bt-tag-ink on --bt-tag-bg (sidebar)', over(vars['--bt-tag-ink'], tagBgSidebar), tagBgSidebar, 4.5],
        ['--bt-accent-ink on --bt-accent', over(vars['--bt-accent-ink'], vars['--bt-accent']), vars['--bt-accent'], 4.5],
        ['--bt-accent on --bt-main', over(vars['--bt-accent'], main), main, 4.5],
        ['--dsw-alias-label-secondary on --bt-main', over(tokens['--dsw-alias-label-secondary'][mode], main), main, 4.5],
        ['--dsw-alias-label-tertiary on --bt-main', over(tokens['--dsw-alias-label-tertiary'][mode], main), main, 4.5],
      ]

      for (const [label, fg, bg, min] of pairs) {
        const ratio = contrast(fg, bg)
        assert.ok(ratio >= min, `${id} (${mode}) ${label}: ${ratio.toFixed(2)}:1 < ${min}:1 (${fg} on ${bg})`)
      }
    }
  }
})

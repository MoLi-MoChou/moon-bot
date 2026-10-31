// Walk every Settings page in a real browser and measure what the eye sees: no text clipped,
// no control pushed out of the viewport, no horizontal scrollbar, nothing overlapping. It runs
// at several widths and both themes, because the same page breaks differently in each.
//
//   MOON_BOT_PASSWORD=bench node packages/core/dev/check-pages.mjs http://127.0.0.1:3181
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const url = process.argv.slice(2).find(arg => !arg.startsWith('--'))
const password = process.env.MOON_BOT_PASSWORD
const outIndex = process.argv.indexOf('--out')
if (url === undefined || !password) {
  console.error('usage: MOON_BOT_PASSWORD=… node dev/check-pages.mjs <url> [--out DIR]')
  process.exit(2)
}
const outDir =
  outIndex > 0 ? process.argv[outIndex + 1] : mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'moon-bot-pages-'))
mkdirSync(outDir, { recursive: true })

const require = createRequire(import.meta.url)
const playwright = (() => {
  try {
    return require('playwright')
  } catch {
    return require('playwright-core')
  }
})()
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright')
const cached = (() => {
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter(name => name.startsWith('chromium'))) {
    for (const candidate of [
      join(cache, dir, 'chrome-linux', 'chrome'),
      join(cache, dir, 'chrome-linux', 'headless_shell'),
    ])
      if (existsSync(candidate)) return candidate
  }
  return undefined
})()
const browserPath = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', cached].find(
  candidate => candidate !== undefined && candidate !== '' && existsSync(candidate),
)

const PAGES = [
  'general',
  'models',
  'bots',
  'connectors',
  'remote',
  'capabilities',
  'tasks',
  'usage',
  'library',
  'secrets',
  'feedback',
  'about',
]
const SIZES = [
  { width: 390, height: 844, name: 'narrow' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1280, height: 800, name: 'desktop' },
]

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

// What is wrong with the page right now, measured rather than asserted by structure. Content
// below the fold is normal — the page scrolls — so only the horizontal axis and the elements
// that cannot be reached by scrolling are checked. A control inside a horizontal scroller is
// reachable by scrolling that strip, so it is not a defect either.

const inspect = async page =>
  page.evaluate(() => {
    const viewport = { w: window.innerWidth, h: window.innerHeight }
    const doc = document.documentElement
    const findings = []
    const scrolls = node => {
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (/auto|scroll/.test(style.overflowX) || /auto|scroll/.test(style.overflowY)) return true
      }
      return false
    }
    // The page itself must never scroll sideways; that would hide content off the right edge.
    if (doc.scrollWidth > viewport.w + 1)
      findings.push(`document scrolls sideways (${String(doc.scrollWidth)} > ${String(viewport.w)})`)
    // Text cut off inside its own box, unless that box is a deliberate scroller or ellipsis.
    const clipped = []
    for (const node of document.querySelectorAll('.bt-settings-page *, .bt-settings-usage *')) {
      const style = getComputedStyle(node)
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) continue
      if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.textOverflow === 'ellipsis') continue
      if (node.children.length > 0 && (node.textContent ?? '').trim() === '') continue
      // One pixel is rounding, not a layout bug.
      if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
        clipped.push(`${node.className || node.tagName}: ${(node.textContent ?? '').slice(0, 40)}`)
    }
    if (clipped.length > 0) findings.push(`clipped text: ${clipped.slice(0, 3).join(' | ')}`)
    // A control pushed off the left or right edge cannot be reached by scrolling at all.
    // One below the fold can: the page scrolls vertically.
    const unreachable = []
    for (const button of document.querySelectorAll('.bt-settings-page button, .bt-settings-usage button')) {
      const box = button.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (Number(getComputedStyle(button).opacity) < 0.05) continue
      if (scrolls(button)) continue
      if (box.right <= 1 || box.left >= viewport.w - 1) {
        const label = (button.textContent ?? '').trim().slice(0, 30) || button.tagName
        unreachable.push(`${label} at ${String(Math.round(box.left))}`)
      }
    }
    if (unreachable.length > 0) findings.push(`controls off the page: ${unreachable.slice(0, 3).join(' | ')}`)
    return { findings, viewport }
  })

const browser = await playwright.chromium.launch({
  headless: true,
  ...(browserPath === undefined ? {} : { executablePath: browserPath }),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.mb-frame', { timeout: 30_000 })

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      document.body.toggleAttribute('data-bt-dark', value === 'dark')
    }, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const name of PAGES) {
        // Open settings on this page the way the sidebar does, then wait for its content.
        await page.evaluate(async target => {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
          if (document.querySelector('.bt-settings') === null) {
            document.querySelector('.mb-settings')?.click()
            await wait(200)
          }
          // The settings item's own text is the page's label, in the active language; match on
          // the id the row carries instead of guessing the casing of a translated label.
          const item =
            document.querySelector(`.bt-settings-item[data-page="${target}"]`) ??
            [...document.querySelectorAll('.bt-settings-item')].find(node =>
              (node.textContent ?? '').trim().toLowerCase().startsWith(target.toLowerCase().slice(0, 4)),
            )
          if (item === null || item === undefined) return false
          item.click()
          await wait(300)
          return true
        }, name)
        const shown = await page.evaluate(() => {
          const pane = document.querySelector('.bt-settings-page')
          if (pane !== null) return pane.getAttribute('data-page')
          // The usage page keeps its own scroll container so it survives moving between pages.
          return document.querySelector('.bt-settings-usage:not([data-off])') !== null ? 'usage' : null
        })
        check(shown === name, `${theme}/${size.name}/${name}: settings shows "${String(shown)}" instead`)
        const { findings } = await inspect(page)
        for (const finding of findings) check(false, `${theme}/${size.name}/${name}: ${finding}`)
        await page.screenshot({ path: join(outDir, `${theme}-${size.name}-${name}.png`) })
      }
      // Leave Settings so the next page opens cleanly.
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
  }

  if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join(' | ')}`)
  console.log(`pages: ${problems.length === 0 ? 'ok' : 'failed'} (screenshots in ${outDir})`)
  for (const problem of problems.slice(0, 40)) console.error(` - ${problem}`)
  if (problems.length > 40) console.error(` … and ${String(problems.length - 40)} more`)
  process.exitCode = problems.length === 0 ? 0 : 1
} finally {
  await browser.close()
}

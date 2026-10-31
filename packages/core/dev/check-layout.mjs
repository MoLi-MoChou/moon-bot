// Layout check for the transparency levels and error placements: measure real boxes in a
// headless browser instead of asserting that a node exists. Exits non-zero when a control
// is clipped, overlapped, or leaves the viewport.
//
//   MOON_BOT_PASSWORD=bench node packages/core/dev/check-layout.mjs http://127.0.0.1:3181
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const url = process.argv.slice(2).find(arg => !arg.startsWith('--'))
const password = process.env.MOON_BOT_PASSWORD
if (url === undefined || !password) {
  console.error('usage: MOON_BOT_PASSWORD=… node dev/check-layout.mjs <url> [--out DIR]')
  process.exit(2)
}
const outDir = (() => {
  const index = process.argv.indexOf('--out')
  return index > 0 ? process.argv[index + 1] : mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'moon-bot-layout-'))
})()
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

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

// Every element that carries text the user must read: it may wrap, but it may not be
// clipped by its own box or pushed outside the viewport.
const measure = async page =>
  page.evaluate(() => {
    const viewport = { w: window.innerWidth, h: window.innerHeight }
    const rows = []
    const nodes = document.querySelectorAll(
      '.bt-toast, .bt-reconnect, .bt-panel-error, .bt-error, .mb-composer-error, .bt-turn-error, .bt-connector-error',
    )
    for (const node of nodes) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      const style = getComputedStyle(node)
      rows.push({
        className: node.className,
        text: (node.textContent ?? '').slice(0, 80),
        box: { x: box.x, y: box.y, w: box.width, h: box.height },
        clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
        overflowX: style.overflowX,
        visible: style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05,
        viewport,
      })
    }
    // Buttons inside an error block must stay hit-testable, not covered by the text.
    const buttons = [...document.querySelectorAll('.bt-reconnect-retry, .bt-toast button')].map(button => {
      const box = button.getBoundingClientRect()
      const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        label: (button.textContent ?? '').trim(),
        box: { x: box.x, y: box.y, w: box.width, h: box.height },
        onTop: at === button || button.contains(at),
      }
    })
    return { rows, buttons, viewport }
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
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))

  // The login gate, so a real page paints with its stylesheets installed.
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.bt-row, .mb-frame', { timeout: 30_000 })

  for (const level of ['off', 'light', 'standard', 'strong']) {
    // Drive the stored preference the same way the settings row does, then reload.
    await page.evaluate(value => {
      if (value === 'standard') localStorage.removeItem('moon-bot:glass')
      else localStorage.setItem('moon-bot:glass', value)
    }, level)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(400)

    for (const size of [
      { width: 390, height: 844, name: 'narrow' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 1280, height: 800, name: 'desktop' },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(outDir, `glass-${level}-${size.name}.png`) })
      const { viewport } = await measure(page)
      check(
        viewport.w === size.width,
        `${level}/${size.name}: viewport is ${String(viewport.w)} not ${String(size.width)}`,
      )
    }
  }

  // The error surfaces only appear when something fails. Render one at a time, so a fixed
  // toast and a fixed status strip never measure each other, and give each the longest text
  // the interface can show.
  const LONG =
    'mcp__notion__search_pages: 连接失败，无法访问 https://api.example.internal/mcp/v1 —— 上游返回 502，请检查地址与凭据后再试'
  const PROBES = {
    notice: `<div class="bt-reconnect" role="status">正在重连… 对话都还在，连上后这个窗口会自动跟上。 <button type="button" class="bt-reconnect-retry">重试</button></div>`,
    panel: `<div class="bt-panel-error" role="alert">${LONG}</div>`,
    toast: `<div class="bt-toast" role="alert"><span class="bt-toast-text">${LONG}</span><button type="button" class="bt-toast-link">详情</button></div>`,
    composer: `<p class="mb-composer-error" role="alert">${LONG}</p>`,
    turn: `<div class="bt-turn-error" role="alert"><span class="bt-turn-error-title">模型调用失败</span><span class="bt-turn-error-why">${LONG}</span></div>`,
  }
  const paint = async (name, html) => {
    await page.evaluate(
      ([key, markup]) => {
        document.getElementById('layout-probe')?.remove()
        const host = document.createElement('div')
        host.id = 'layout-probe'
        host.dataset.probe = key
        host.innerHTML = markup
        // Inline surfaces get the width their real container gives them; fixed ones place
        // themselves and only need to be in the document.
        if (key === 'panel' || key === 'composer' || key === 'turn') {
          // Sit above the shell so the screenshot shows it, at the width its real container
          // gives it (the right-hand panel is 380px on a wide window).
          host.style.cssText =
            'position:fixed;top:72px;left:50%;translate:-50% 0;z-index:9999;width:min(380px,calc(100vw - 16px))'
        }
        document.body.append(host)
        // Probe buttons must stay hit-testable: that is exactly what the overlap check reads.
        for (const button of host.querySelectorAll('button')) button.style.pointerEvents = 'auto'
      },
      [name, html],
    )
    await page.waitForTimeout(120)
  }

  for (const level of ['off', 'standard', 'strong']) {
    for (const size of [
      { width: 390, height: 844, name: 'narrow' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 1280, height: 800, name: 'desktop' },
    ]) {
      await page.evaluate(value => {
        if (value === 'standard') localStorage.removeItem('moon-bot:glass')
        else localStorage.setItem('moon-bot:glass', value)
      }, level)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.waitForTimeout(250)
      for (const [name, html] of Object.entries(PROBES)) {
        await paint(name, html)
        const { rows, buttons } = await measure(page)
        for (const row of rows) {
          if (!row.visible) continue
          check(
            row.box.x >= -1 && row.box.y >= -1 && row.box.x + row.box.w <= row.viewport.w + 1,
            `${level}/${size.name}/${name}: ${row.className} leaves the viewport (${JSON.stringify(row.box)})`,
          )
          check(
            !row.clipped || row.overflowX === 'auto',
            `${level}/${size.name}/${name}: ${row.className} clips its text`,
          )
        }
        for (const button of buttons) {
          check(button.onTop, `${level}/${size.name}/${name}: button "${button.label}" is covered`)
        }
        // On a phone the status strip and the toast must clear the header pill and composer.
        if (size.name === 'narrow' && (name === 'notice' || name === 'toast')) {
          const overlaps = await page.evaluate(() => {
            const box = selector => {
              const node = document.querySelector(selector)
              return node === null ? null : node.getBoundingClientRect()
            }
            const hit = (a, b) =>
              a !== null && b !== null && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
            return {
              pill: hit(box('#layout-probe .bt-reconnect'), box('.mb-head .bt-pill')),
              composer: hit(box('#layout-probe .bt-toast'), box('[data-composer-input], .mb-composer')),
            }
          })
          check(!overlaps.pill, `${level}/narrow: the connection notice covers the header pill`)
          check(!overlaps.composer, `${level}/narrow: the error toast covers the composer`)
        }
        // The real accessibility question is contrast against what the eye sees: the surface
        // tint blended over the page behind it. WCAG AA wants 4.5:1 for body-size text.
        const contrast = await page.evaluate(() => {
          const node = document.querySelector('#layout-probe > *')
          if (node === null) return null
          const parse = value => {
            const parts = /rgba?\(([^)]+)\)/u.exec(value)
            if (parts === null) return null
            const [r, g, b, a] = parts[1].split(',').map(Number)
            return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a === undefined ? 1 : a }
          }
          const over = (top, bottom) => ({
            r: top.r * top.a + bottom.r * (1 - top.a),
            g: top.g * top.a + bottom.g * (1 - top.a),
            b: top.b * top.a + bottom.b * (1 - top.a),
            a: 1,
          })
          const luminance = color => {
            const channel = value => {
              const scaled = value / 255
              return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
            }
            return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
          }
          const pageBase = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
          const surface = parse(getComputedStyle(node).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 }
          const background = over(surface, pageBase)
          const text = parse(getComputedStyle(node).color) ?? { r: 0, g: 0, b: 0, a: 1 }
          const inked = text.a < 1 ? over(text, background) : text
          const light = Math.max(luminance(inked), luminance(background))
          const dark = Math.min(luminance(inked), luminance(background))
          return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
        })
        check(
          contrast === null || contrast >= 4.5,
          `${level}/${size.name}/${name}: text contrast is ${String(contrast)}:1, below 4.5:1`,
        )
        await page.screenshot({ path: join(outDir, `${level}-${size.name}-${name}.png`) })
      }
    }
  }
  await page.evaluate(() => document.getElementById('layout-probe')?.remove())

  if (errors.length > 0) problems.push(`page errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: join(outDir, 'final.png') })
  console.log(`layout: ${problems.length === 0 ? 'ok' : 'failed'} (screenshots in ${outDir})`)
  for (const problem of problems) console.error(` - ${problem}`)
  process.exitCode = problems.length === 0 ? 0 : 1
} finally {
  await browser.close()
}

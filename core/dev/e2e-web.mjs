// Browser end-to-end check of the standalone web build (plan 阶段 A): the password page
// refuses a wrong password, the right one opens the team, and a Bot answers a message —
// the mock model makes the answer deterministic ("好了。"). Run it against a bench:
//
//   dev/bench.sh e2e 3100 8790 reset
//   MOON_BOT_PASSWORD=bench node dev/e2e-web.mjs http://127.0.0.1:3100
//
// Against a real deployment, pass --read-only: it logs in and looks around, and never
// writes to that team.
//
// A browser comes from CHROME_BIN, else the usual Chrome/Chromium paths, else the one
// `npx playwright install chromium` put in the Playwright cache. playwright is a dev
// dependency for this check only. Exit 0 on success, 1 on a failed assertion, 2 on usage
// or browser trouble. Screenshots go to --out (a temp folder by default), also on failure.
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const url = args.find(arg => !arg.startsWith('--'))
const option = name => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const readOnly = args.includes('--read-only')
if (url === undefined) {
  console.error('usage: node dev/e2e-web.mjs <url> [--password-env NAME] [--out DIR] [--timeout MS] [--read-only]')
  process.exit(2)
}
const passwordEnv = option('password-env') ?? 'MOON_BOT_PASSWORD'
const password = process.env[passwordEnv]
if (password === undefined || password === '') {
  console.error(`e2e-web: set ${passwordEnv} to the web password`)
  process.exit(2)
}
const outDir = option('out') ?? mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'moon-bot-e2e-'))
mkdirSync(outDir, { recursive: true })
const timeout = Number(option('timeout') ?? 30_000)
// A mock bench has no provider yet: name the mock endpoint and the check sets one up.
const mockUrl = option('mock-url')

const require = createRequire(import.meta.url)
let playwright
try {
  playwright = require('playwright')
} catch {
  try {
    playwright = require('playwright-core')
  } catch {
    console.error('e2e-web: playwright is not installed (npm ci at the repo root installs it)')
    process.exit(2)
  }
}

// The Playwright-managed Chromium lives under a per-user cache; the CI runner also has
// google-chrome preinstalled, and CHROME_BIN names another binary outright.
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright')
const cachedBrowser = (() => {
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter(name => name.startsWith('chromium'))) {
    for (const candidate of [join(cache, dir, 'chrome-linux', 'chrome'), join(cache, dir, 'chrome-linux', 'headless_shell')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
})()
const browserPath = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', cachedBrowser]
  .find(candidate => candidate !== undefined && candidate !== '' && existsSync(candidate))

const problems = []
const shot = name => join(outDir, name)
let page
let browser
try {
  browser = await playwright.chromium.launch({
    headless: true,
    ...(browserPath === undefined ? {} : { executablePath: browserPath }),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await context.newPage()
  page.setDefaultTimeout(timeout)
  // Resource loads fail on purpose here (the deliberate wrong password answers 401, and
  // a favicon may 404); a thrown script error is the thing worth failing on.
  page.on('console', message => {
    if (message.type() !== 'error' || /Failed to load resource/.test(message.text())) return
    problems.push(message.text())
  })
  page.on('pageerror', error => problems.push(String(error)))

  // 1. The password page asks, and a wrong password is refused with a note.
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name=password]')
  await page.fill('input[name=password]', 'definitely-not-it')
  await page.click('button[type=submit]')
  await page.waitForLoadState('domcontentloaded')
  if (await page.locator('input[name=password]').count() === 0) throw new Error('a wrong password was let through to the app')
  await page.screenshot({ path: shot('01-wrong-password.png') })

  // 2. The right password opens the team: the sidebar shows up.
  await page.fill('input[name=password]', password)
  await page.click('button[type=submit]')
  await page.waitForSelector('.bt-side', { timeout })
  await page.screenshot({ path: shot('02-signed-in.png') })

  if (readOnly) {
    console.log(`e2e-web: ok (read-only) — the login gate and the team shell (screenshots in ${outDir})`)
  } else {
    // 3. One Bot, made through the same channel the UI uses, then a message it answers.
    const created = await page.evaluate(async () => {
      const response = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'create-bot', payload: { name: 'E2E Bot', role: 'Tester' } }),
      })
      return await response.json()
    })
    if (created?.ok !== true) throw new Error(`create-bot failed: ${JSON.stringify(created)}`)
    const ready = await page.evaluate(async input => {
      const post = async (endpoint, payload) => {
        const response = await fetch('/api/bot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint, payload }),
        })
        return await response.json()
      }
      if (input.mockUrl !== null) {
        const added = await post('provider-add', { custom: true, provider: 'mock-anthropic', api: 'anthropic-messages', baseURL: input.mockUrl, key: 'sk-mock', models: ['claude-3-5-sonnet'] })
        // A rerun on a bench whose provider already exists is fine.
        if (added?.ok !== true && !/already set up/.test(added?.error?.message ?? '')) return { ok: false, why: 'provider-add: ' + JSON.stringify(added) }
      }
      const state = await post('state', {})
      const ref = state?.value?.models?.[0]?.ref
      if (typeof ref !== 'string') return { ok: false, why: 'no model in the catalog' }
      const updated = await post('update-bot', { id: input.botId, model: ref })
      return { ok: updated?.ok === true, ref }
    }, { botId: created.value.id, mockUrl: mockUrl ?? null })
    if (ready?.ok !== true) throw new Error(`could not give the E2E Bot a model: ${JSON.stringify(ready)}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bt-row', { timeout })
    await page.locator('.bt-row').first().click()
    await page.waitForSelector('[data-composer-input]')
    await page.fill('[data-composer-input]', '你好')
    await page.click('.dsb-send')
    await page.waitForSelector('text=收到：', { timeout: Math.max(timeout, 60_000) })
    await page.screenshot({ path: shot('03-replied.png') })
    console.log(`e2e-web: ok — the login gate, the team, and a mock-model reply (screenshots in ${outDir})`)
  }

  if (problems.length > 0) throw new Error(`the page logged errors:\n${problems.join('\n')}`)
  await browser.close()
  process.exit(0)
} catch (error) {
  if (page !== undefined) await page.screenshot({ path: shot('99-failure.png') }).catch(() => undefined)
  if (browser !== undefined) await browser.close().catch(() => undefined)
  console.error(`e2e-web: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`e2e-web: screenshots in ${outDir}`)
  process.exit(1)
}

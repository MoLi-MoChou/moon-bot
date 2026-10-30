// A real-rendering smoke test for the client: the plugin is mounted, the theme is one of
// the four Moon Bot themes (moon unless told otherwise), and the page logs no error. Run
// it against a live DSH web with the plugin linked; unit tests cannot see a white page.
//
//   node dev/ui-smoke.mjs <url> [--out <dir>] [--wait <ms>] [--theme <id>] [--min-bt <n>]
//                              [--allow <regex>]... [--password-env <NAME>] [--timeout <ms>]
//
// <url> is a running web UI, with its token when that build needs one. When the login page
// asks for a password instead, name the environment variable that holds it with
// --password-env; the value is never printed. Chromium comes from .tools (the extracted
// build this bench uses): set MOON_BOT_TOOLS for its folder, CHROME_BIN for another binary,
// or PLAYWRIGHT_CORE for another playwright-core. The screenshot goes to --out (a temp
// folder under .tools by default) as evidence, also when an assertion fails. Exit 1 on a
// failed assertion, 2 on usage or browser trouble.
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const THEMES = ['moon', 'deepseek', 'claude', 'grok']

const args = process.argv.slice(2)
const url = args.find(arg => !arg.startsWith('--'))
const option = name => {
  const inline = args.find(arg => arg.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}
const allows = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index].startsWith('--allow=')) allows.push(new RegExp(args[index].slice('--allow='.length)))
  else if (args[index] === '--allow' && args[index + 1] !== undefined) allows.push(new RegExp(args[index + 1]))
}
const waitMs = Number(option('wait') ?? 1200)
const timeoutMs = Number(option('timeout') ?? 20_000)
const minBt = Number(option('min-bt') ?? 1)
const wantedTheme = option('theme')
const passwordEnv = option('password-env')

if (!url) {
  console.error('usage: node dev/ui-smoke.mjs <url> [--out <dir>] [--wait <ms>] [--theme <id>] [--allow <regex>] [--password-env <NAME>] [--timeout <ms>]')
  process.exit(2)
}

// .tools sits beside the checkout, not at a fixed depth: worktrees are nested deeper.
const findTools = () => {
  if (process.env.MOON_BOT_TOOLS) return resolve(process.env.MOON_BOT_TOOLS)
  for (let dir = PLUGIN; ; dir = dirname(dir)) {
    const candidate = join(dir, '.tools')
    if (existsSync(join(candidate, 'pw', 'node_modules', 'playwright-core'))) return candidate
    if (dirname(dir) === dir) return undefined
  }
}
const tools = findTools()
if (tools === undefined) {
  console.error('no .tools folder beside the checkout; set MOON_BOT_TOOLS to the bench tools folder')
  process.exit(2)
}
const playwrightPath = process.env.PLAYWRIGHT_CORE ?? (tools === undefined ? '' : join(tools, 'pw', 'node_modules', 'playwright-core'))
const chrome = process.env.CHROME_BIN ?? (tools === undefined ? '' : join(tools, 'ms-playwright', 'chromium-1148', 'chrome-linux', 'chrome'))
if (!existsSync(playwrightPath)) {
  console.error(`no playwright-core at ${playwrightPath}; set PLAYWRIGHT_CORE or MOON_BOT_TOOLS`)
  process.exit(2)
}
if (!existsSync(chrome)) {
  console.error(`no Chromium at ${chrome}; set CHROME_BIN`)
  process.exit(2)
}

const outDir = resolve(option('out') ?? join(tools, 'tmp'))
mkdirSync(outDir, { recursive: true })

const { chromium } = createRequire(import.meta.url)(playwrightPath)
const env = { ...process.env, TMPDIR: join(tools, 'tmp'), XDG_CACHE_HOME: join(tools, 'cache') }
const fonts = join(tools, 'sysroot', 'fonts.conf')
const sysroot = join(tools, 'sysroot', 'root', 'usr', 'lib', 'x86_64-linux-gnu')
const sysrootLib = join(tools, 'sysroot', 'root', 'lib', 'x86_64-linux-gnu')
if (existsSync(fonts)) env.FONTCONFIG_FILE = fonts
if (existsSync(sysroot)) env.LD_LIBRARY_PATH = [sysroot, sysrootLib, env.LD_LIBRARY_PATH].filter(Boolean).join(':')

const errors = []
const fails = []
const ok = (condition, message) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`)
  if (!condition) fails.push(message)
}
const sleep = ms => new Promise(done => setTimeout(done, ms))

let browser
let shot
try {
  browser = await chromium.launch({ executablePath: chrome, env, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error)))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

  // A password build asks on its own page. The value stays in the environment.
  if (await page.locator('input[type=password]').count() > 0) {
    if (passwordEnv === undefined || !process.env[passwordEnv]) {
      throw Object.assign(new Error('the login page asks for a password; pass --password-env <NAME>'), { usage: true })
    }
    await page.locator('input[type=password]').first().fill(process.env[passwordEnv])
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
  }

  // DSH shows a first-run preview notice; clear it when it appears, before any read.
  const notice = page.getByRole('dialog').getByRole('button', { name: /Continue|继续/ })
  try { await page.addLocatorHandler(notice, () => notice.click()) } catch {}

  // The plugin registers its client after the shell boots: wait for any bt- class rather
  // than a fixed sleep, so a white page is reported by its symptom (0 elements).
  const deadline = Date.now() + timeoutMs
  let classes = 0
  while (Date.now() < deadline) {
    classes = await page.evaluate(() => document.querySelectorAll('[class*="bt-"]').length)
    if (classes > 0) break
    await sleep(200)
  }
  if (waitMs > 0) await sleep(waitMs)
  // Count once more after the settle time: the client keeps adding its parts as it draws,
  // so the first non-zero count says only that it started, not how much is there.
  classes = await page.evaluate(() => document.querySelectorAll('[class*="bt-"]').length)

  const theme = await page.evaluate(() => document.body.dataset.btTheme ?? '')
  shot = join(outDir, `ui-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
  await page.screenshot({ path: shot })

  ok(classes >= minBt, `the plugin client is mounted (${classes} bt- elements, need ${minBt})`)
  ok(THEMES.includes(theme), `body theme is one of ${THEMES.join(', ')} (got ${JSON.stringify(theme)})`)
  if (wantedTheme !== undefined) ok(theme === wantedTheme, `body theme is ${wantedTheme} (got ${JSON.stringify(theme)})`)
  const unexpected = errors.filter(text => !allows.some(allow => allow.test(text)))
  ok(unexpected.length === 0, `console has no unexpected error (${unexpected.length})`)
  for (const text of unexpected.slice(0, 8)) console.log(`     · ${text.slice(0, 300)}`)

  console.log(`screenshot: ${shot}`)
  if (fails.length > 0) {
    console.log(`ui-smoke: ${fails.length} failure(s)`)
    process.exitCode = 1
  } else {
    console.log(`ui-smoke: ok (bt=${classes}, theme=${theme}, errors=0)`)
  }
} catch (error) {
  console.error(`ui-smoke: ${error.message}`)
  if (error.usage) console.error('usage: node dev/ui-smoke.mjs <url> [--out <dir>] [--wait <ms>] [--theme <id>] [--allow <regex>] [--password-env <NAME>] [--timeout <ms>]')
  process.exitCode = error.usage ? 2 : 1
  if (shot === undefined) console.error('no screenshot: the page did not load')
} finally {
  await browser?.close().catch(() => {})
}

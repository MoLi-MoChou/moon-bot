// First-screen check: how long until the chat's composer takes input, and what the page
// had to fetch for it. Drives the locally extracted Chromium over CDP (no Playwright, no
// root); every file it writes stays under the tools folder.
//
//   node dev/perf-first-screen.mjs <url> [--runs=3] [--target=3000] [--json]
//
// <url> is a running web UI, with its token when that build needs one. Each run uses a
// fresh browser context, so nothing is served from the previous run's cache. Exit 1 when
// the median misses --target, so a slow first screen fails a check instead of a hand look.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOLS = process.env.MOON_BOT_TOOLS ?? '/data/dsh/bot/workspace/.tools'
const CHROME = process.env.CHROME_BIN ?? join(TOOLS, 'ms-playwright/chromium-1148/chrome-linux/chrome')
const WRAPPER = join(TOOLS, 'run-chrome.sh')
const COMPOSER = '[class*="_centerCol"] [role=textbox][contenteditable=true]'

const args = process.argv.slice(2)
const url = args.find(arg => !arg.startsWith('--'))
const option = (name, fallback) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback)
const runs = Math.max(1, option('runs', 3))
const target = option('target', 3000)
const asJson = args.includes('--json')
const sleep = ms => new Promise(done => setTimeout(done, ms))

if (!url) {
  console.error('usage: node dev/perf-first-screen.mjs <url> [--runs=3] [--target=3000] [--json]')
  process.exit(2)
}
if (!existsSync(CHROME) && process.env.CHROME_BIN === undefined) {
  console.error(`no Chromium at ${CHROME}; set CHROME_BIN`)
  process.exit(2)
}

const port = 9400 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(TOOLS, 'tmp/perf-chrome-'))
const chrome = spawn(existsSync(WRAPPER) ? 'sh' : CHROME,
  [...(existsSync(WRAPPER) ? [WRAPPER] : []), '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'],
  { stdio: 'ignore' })

const stop = () => {
  try { chrome.kill('SIGKILL') } catch {}
  rmSync(profile, { recursive: true, force: true })
}
process.on('exit', stop)

const getJson = async (path) => {
  for (let tries = 0; tries < 300; tries += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(100)
  }
  throw new Error(`Chromium did not answer on port ${port}`)
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.waiting = new Map()
    this.next = 0
    socket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      const pending = message.id === undefined ? undefined : this.waiting.get(message.id)
      if (pending === undefined) return
      this.waiting.delete(message.id)
      if (message.error !== undefined) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }
  send(method, params = {}) {
    const id = (this.next += 1)
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }))
  }
}

const attach = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  return new Cdp(socket)
}

// One cold load in its own browser context.
async function run(browser, number) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await getJson('/json/list')).find(entry => entry.id === targetId)
  const page = await attach(target)
  await page.send('Page.enable')
  await page.send('Runtime.enable')

  const started = Date.now()
  await page.send('Page.navigate', { url })
  let ready
  for (let tries = 0; tries < 600; tries += 1) {
    const probe = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(COMPOSER)})
        if (!el) return { found: false }
        const disabled = el.getAttribute('aria-disabled') === 'true' || el.getAttribute('contenteditable') !== 'true'
        if (disabled) return { found: true, disabled: true }
        el.focus()
        return { found: true, disabled: false, focused: document.activeElement === el }
      })()`,
      returnByValue: true,
    }).then(result => result.result?.value).catch(() => undefined)
    if (probe?.found === true && probe.disabled === false && probe.focused === true) {
      ready = Date.now() - started
      break
    }
    await sleep(50)
  }
  if (ready === undefined) throw new Error(`run ${number}: the composer did not take input within 30 s`)

  const marks = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const paint = performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint')
      const script = performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'script')
      return {
        fcp: paint?.startTime,
        domContentLoaded: nav?.domContentLoadedEventEnd,
        load: nav?.loadEventEnd,
        scripts: script.length,
        scriptBytes: script.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
      }
    })()`,
    returnByValue: true,
  }).then(result => result.result?.value)

  await browser.send('Target.closeTarget', { targetId })
  await browser.send('Target.disposeBrowserContext', { browserContextId })
  return { run: number, ready, ...marks }
}

const version = await getJson('/json/version')
const browser = await attach(version)
const results = []
for (let number = 1; number <= runs; number += 1) results.push(await run(browser, number))

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const ready = median(results.map(result => result.ready))
const bundlePath = join(PLUGIN, 'client.js')
const bundle = readFileSync(bundlePath)
const summary = {
  url: url.replace(/token=[^&]*/, 'token=***'),
  runs: results,
  medianReadyMs: ready,
  targetMs: target,
  clientJs: { bytes: bundle.length, gzipBytes: gzipSync(bundle).length },
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  for (const result of results) {
    console.log(`run ${result.run}: input ready ${result.ready} ms · FCP ${Math.round(result.fcp ?? 0)} ms · DCL ${Math.round(result.domContentLoaded ?? 0)} ms · load ${Math.round(result.load ?? 0)} ms · ${result.scripts} scripts, ${Math.round(result.scriptBytes / 1024)} KB`)
  }
  console.log(`median input ready: ${ready} ms (target ${target} ms) · client.js ${Math.round(bundle.length / 1024)} KB, ${Math.round(gzipSync(bundle).length / 1024)} KB gzip`)
}
process.exit(ready <= target ? 0 : 1)

// Check a packaged app: start it on throwaway folders with Moon Bot's mock model, choose a model,
// send a message, wait for the reply, then close the window the way a user does and wait until
// the app has exited. Fails on a page error or a non-zero exit.
// Usage: node scripts/check-packed.mjs [app executable] [screenshot.png]
// The executable defaults to the one that `pnpm run pack` or `pnpm run dist` writes into dist-pack/.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [given, shotFile] = process.argv.slice(2)
const executable = given || packedExecutable()

function packedExecutable() {
  const out = join(root, 'dist-pack')
  if (process.platform === 'win32') return join(out, 'win-unpacked', 'Moon Bot.exe')
  if (process.platform === 'linux') return join(out, 'linux-unpacked', 'moon-bot')
  const dir = ['mac-arm64', 'mac'].find(name => existsSync(join(out, name))) ?? 'mac'
  return join(out, dir, 'Moon Bot.app', 'Contents', 'MacOS', 'Moon Bot')
}

if (!existsSync(executable)) {
  console.error(`check-packed: no app at ${executable}. Run pnpm run pack first.`)
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'moon-bot-packed-'))
mkdirSync(join(work, 'home'))
const children = []

function stopChildren() {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    // On Windows a plain kill ends only the main process; /T takes the Host and Electron's helpers along.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill()
  }
}

// An app that hangs, for example behind its error box, must not hold up CI.
setTimeout(() => {
  console.error('check-packed: FAILED: gave up after 8 minutes')
  stopChildren()
  process.exit(1)
}, 8 * 60_000).unref()

// Run from inside this checkout, the app would find a module that the build left out in the
// checkout's own node_modules, so the check runs a copy of the app from the throwaway folder.
function outsideCheckout(file) {
  // A packaged app is already self-contained; copying its full Electron bundle on Windows
  // can overflow Node's recursive cpSync on deeply nested native dependencies.
  const packedRoot = resolve(root, 'dist-pack')
  const inPackage = relative(packedRoot, file)
  if (inPackage === '' || (!inPackage.startsWith('..') && !isAbsolute(inPackage))) return file
  const fromCheckout = relative(resolve(root, '..'), file)
  if (fromCheckout.startsWith('..') || isAbsolute(fromCheckout)) return file
  const appDir = process.platform === 'darwin' ? resolve(file, '..', '..', '..') : dirname(file)
  const copy = join(work, basename(appDir))
  cpSync(appDir, copy, { recursive: true, verbatimSymlinks: true })
  console.log(`check-packed: runs a copy of ${appDir} in ${work}`)
  return join(copy, relative(appDir, file))
}

function startMock() {
  const mock = spawn(process.execPath, [join(root, '..', '..', 'packages', 'core', 'dev', 'mock-llm.ts')], {
    env: { ...process.env, MOCK_PORT: '0', MOCK_LOG: join(work, 'mock.log') }, stdio: ['ignore', 'pipe', 'inherit'],
  })
  children.push(mock)
  return new Promise((done, reject) => {
    let text = ''
    mock.stdout.setEncoding('utf8')
    mock.stdout.on('data', (chunk) => {
      text += chunk
      const url = /http:\/\/127\.0\.0\.1:\d+\/v1/u.exec(text)?.[0]
      if (url) done(url)
    })
    mock.once('exit', (code) => { reject(new Error(`check-packed: the mock model stopped (exit ${String(code)})`)) })
  })
}

function configureMock(home, baseUrl) {
  writeFileSync(join(home, 'settings.json'), `${JSON.stringify({
    version: 1,
    revision: 1,
    sections: {
      'llm-pi-ai': {
        providers: {
          mock: {
            api: 'anthropic-messages',
            baseURL: baseUrl,
            apiKeyEnv: 'MOON_BOT_MOCK_API_KEY',
            models: [{ id: 'mock-1', name: 'Moon Bot mock' }],
          },
        },
      },
    },
  }, null, 2)}\n`)
  writeFileSync(join(home, 'credentials.json'), `${JSON.stringify({ MOON_BOT_MOCK_API_KEY: 'mock-key' })}\n`)
}

async function appPage(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      const page = targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//u.test(target.url))
      if (page) return page
    } catch {
      // The debugging port is not listening yet.
    }
    await sleep(500)
  }
  throw new Error('the app window did not appear')
}

function devtools(url, problems) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let next = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.exceptionThrown') problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(`console.error: ${message.params.args.map(arg => arg.value ?? arg.description).join(' ')}`)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const opened = new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = next++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`the window did not answer ${method}`))
    }, 30_000)
    const settle = action => (value) => { clearTimeout(timer); action(value) }
    pending.set(id, { resolve: settle(done), reject: settle(reject) })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { opened, call }
}

// mica.css styles Moon Bot's own frame; every rule must still
// find an element, so a frame change shows here and not as a broken window.
function micaRules() {
  const css = readFileSync(join(root, 'src', 'mica.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
  return [...css.matchAll(/([^{}]+)\{/gu)].map(([, selectors]) => selectors.split(',')
    .map(selector => selector.trim().replace(/::(?:before|after)$/u, ''))
    .filter(selector => selector !== '' && selector !== 'body'))
    .filter(rule => rule.length > 0)
}

async function chat(cdp) {
  const evaluate = async expression => (await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  const until = async (expression, label, ms = 120_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`)) return
      await sleep(250)
    }
    throw new Error(`timed out waiting for ${label}`)
  }
  // DSH shows a preview notice once per profile; it would keep the focus away from the composer.
  const dismissNotice = () => evaluate("[...document.querySelectorAll('[role=dialog] button')].find(node => /^(Continue|继续)$/u.test(node.textContent.trim()))?.click()")
  const text = needle => `document.body.innerText.includes(${JSON.stringify(needle)})`
  await cdp.call('Runtime.enable')
  await cdp.call('Log.enable')
  await until("document.querySelector('.bt-tile, .bt-row')", 'the team')
  const stale = await evaluate(`${JSON.stringify(micaRules())}.filter(rule => !rule.some(selector => document.querySelector(selector) !== null)).map(rule => rule.join(', '))`)
  if (stale.length > 0) throw new Error(`src/mica.css no longer matches Moon Bot's page: ${stale.join(' | ')}`)
  await dismissNotice()
  const main = await evaluate("fetch('api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'state', payload: {} }) }).then(r => r.json()).then(r => r.value.mainBotId)")
  await evaluate(`document.querySelector(${JSON.stringify(`[data-bot-id="${main}"]`)}).click()`)
  await until("document.querySelector('.bt-model-chip:not(.bt-model-chip-quiet)')", 'the model choice')
  await evaluate("document.querySelector('.bt-model-chip:not(.bt-model-chip-quiet)').click()")
  // Selecting a model closes the model-choice dock; the composer is the next usable surface.
  await until("document.querySelector('[role=textbox][contenteditable=true], textarea')", 'the composer')
  await dismissNotice()
  await evaluate("[...document.querySelectorAll('[role=textbox][contenteditable=true], textarea')].at(-1).focus()")
  // Fill the native textarea and click the current send control. This works for both the
  // contenteditable composer used by the plugin surface and Moon Bot's standalone textarea.
  await evaluate("(() => { const input = document.querySelector('[data-composer-input]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, 'packaged app check'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()")
  await until("document.querySelector('.mb-send:not(:disabled), button[type=submit]:not(:disabled)')", 'the send button', 10_000)
  await evaluate("document.querySelector('.mb-send:not(:disabled), button[type=submit]:not(:disabled)')?.click()")
  // The mock model starts its reply with 收到： and the message.
  await until(text('收到：packaged app check'), 'the reply').catch(async (error) => {
    // What the window showed, and what the mock model was asked, so a timeout says why.
    console.log(`check-packed: page at timeout ${JSON.stringify(await evaluate('document.body.innerText.slice(-600)').catch(() => '?'))}`)
    console.log(`check-packed: focus ${JSON.stringify(await evaluate('document.activeElement?.outerHTML.slice(0, 200)').catch(() => '?'))}`)
    try { console.log(`check-packed: mock log tail ${readFileSync(join(work, 'mock.log'), 'utf8').slice(-1500)}`) } catch {}
    throw error
  })
  await sleep(1000)
  console.log(`check-packed: chat ${JSON.stringify(await evaluate('document.body.innerText.slice(-200)'))}`)
}

let failed = false
const problems = []
try {
  const modelUrl = await startMock()
  configureMock(join(work, 'home'), modelUrl)
  const port = 9300 + Math.floor(Math.random() * 600)
  // A terminal inside an Electron-based editor may set ELECTRON_RUN_AS_NODE, which turns the app into plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
  Object.assign(env, {
    MOON_BOT_DATA: join(work, 'home'), MOON_BOT_SHELL_DATA: join(work, 'shell'),
    MOON_BOT_WORKSPACE: join(work, 'workspace'),
  })
  const app = spawn(outsideCheckout(resolve(executable)), [`--remote-debugging-port=${String(port)}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { stdio: 'inherit', env })
  children.push(app)
  const exited = new Promise((done) => { app.once('exit', (code, signal) => { done({ code, signal }) }) })
  const cdp = devtools((await appPage(port, Date.now() + 120_000)).webSocketDebuggerUrl, problems)
  await cdp.opened
  const chatError = await chat(cdp).then(() => undefined, error => error)
  if (shotFile) {
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(shotFile), Buffer.from(data, 'base64'))
    console.log(`check-packed: saved ${resolve(shotFile)}`)
  }
  // Closed like a user closes it, also after a failure, so that the app stops its Host. The page
  // goes away with the window, so this call gets no answer.
  void cdp.call('Runtime.evaluate', { expression: 'window.close()' }).catch(() => undefined)
  const outcome = await Promise.race([exited, sleep(40_000).then(() => undefined)])
  if (chatError) throw chatError
  if (outcome === undefined) throw new Error('the app did not exit after its window closed')
  console.log(`check-packed: app exited (code ${String(outcome.code)}, signal ${String(outcome.signal)})`)
  if (outcome.code !== 0) throw new Error(`the app exited with code ${String(outcome.code)}`)
  if (problems.length > 0) throw new Error(`page problems:\n  ${problems.join('\n  ')}`)
  console.log('check-packed: passed')
} catch (error) {
  failed = true
  console.error(`check-packed: FAILED: ${error instanceof Error ? error.message : String(error)}`)
}
stopChildren()
await sleep(500)
rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
process.exit(failed ? 1 : 0)

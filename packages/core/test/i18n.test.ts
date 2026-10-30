import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { DICTIONARY, errorCopy, hostText, installLocale, language, t } from '../src/client/i18n.ts'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

function fakeLocale(active) {
  const dicts = new Map()
  return {
    register: (ns, locale, dict) => {
      dicts.set(`${ns}:${locale}`, dict)
      return () => dicts.delete(`${ns}:${locale}`)
    },
    bind: ns => (key, params) => {
      const text = (active === 'zh' ? dicts.get(`${ns}:zh`)?.[key] : undefined) ?? key
      return params
        ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
        : text
    },
    getLocale: () => ({ active }),
  }
}

// The interface is built from two trees: core's shared client and the desktop window's own
// views. Both ask the same dictionary for a Chinese entry, so the check walks both —
// subdirectories included, which the top-level-only version missed.
const walkSources = (roots: readonly string[]): string[] => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) return /node_modules|dist|\.git/.test(full) ? [] : walk(full)
      return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
    })
  return roots.flatMap(walk)
}

// The dictionary and the translator define the keys rather than ask for them.
// Paths in a report read the same on every platform: Windows's backslashes would
// otherwise leak into the message a failing run prints.
const slashed = (path: string): string => path.replaceAll('\\', '/')
const skipSource = (file: string): boolean => /(^|\/)(i18n\.ts|i18n\/zh\.ts)$/.test(slashed(file))

const interfaceSources = (): { readonly name: string; readonly text: string }[] =>
  walkSources([join(PLUGIN, 'src'), join(PLUGIN, '..', '..', 'apps', 'desktop', 'ui', 'src')])
    .filter(file => !skipSource(file))
    .map(file => ({ name: slashed(relative(PLUGIN, file)), text: readFileSync(file, 'utf8') }))

/** Every literal passed to `t()` in one source text, unescaped. */
const literalsOf = (text: string): string[] =>
  [...text.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => (match[2] as string).replace(/\\'/g, "'"))

const missingLiterals = (
  sources: readonly { readonly name: string; readonly text: string }[],
  dictionary: object,
): string[] => {
  const missing: string[] = []
  for (const { name, text } of sources)
    for (const key of literalsOf(text)) if (!Object.hasOwn(dictionary, key)) missing.push(`${name}: ${key}`)
  return missing
}

test('every literal the client translates has a Chinese entry', () => {
  assert.deepEqual(missingLiterals(interfaceSources(), DICTIONARY.zh), [])
})

test('the scan is recursive, and the fixture tree proves it', () => {
  // A nested file with a key the fixture dictionary lacks must be reported: a top-level-only
  // scan cannot see it, which is how 16 window strings shipped untranslated.
  const root = join(PLUGIN, 'test', 'fixtures', 'i18n', 'tree')
  const sources = walkSources([root])
    .filter(file => !skipSource(file))
    .map(file => ({ name: slashed(relative(root, file)), text: readFileSync(file, 'utf8') }))
  assert.deepEqual(missingLiterals(sources, { Known: '已知' }), ['nested/inner.tsx: Missing from a nested file'])
})

test('copy follows the interface language and stays English without a locale service', () => {
  assert.equal(t('Message {name}', { name: 'Chief' }), 'Message Chief')
  assert.equal(language(), 'en')
  const off = installLocale(fakeLocale('zh'))
  try {
    assert.equal(language(), 'zh')
    assert.equal(t('Message {name}', { name: 'Chief' }), '给 Chief 发消息')
    assert.equal(t('Model'), '模型')
    assert.equal(hostText('A Bot named Writer already exists'), '已经有叫 Writer 的 Bot 了')
    assert.equal(hostText('The team needs at least one Main Bot'), '团队至少要有一个主 Bot')
    assert.equal(hostText('Something new'), 'Something new')
    assert.equal(
      hostText('Error: the user rejected escalating this command to danger-full-access'),
      '你拒绝了完全访问权限，命令没有执行',
    )
    assert.equal(
      hostText('the user rejected escalating this command to workspace-write'),
      '你拒绝了工作区写入权限，命令没有执行',
    )
    // Whole memory messages, not only their first words, become Chinese.
    assert.equal(
      hostText(
        'An entry holds at most 300 characters; this one has 301. Keep one fact per entry, or save the details as several entries in a topic.',
      ),
      '一条记忆最多 300 个字符，这条有 301 个',
    )
    assert.equal(
      hostText(
        "Writer's memory's MEMORY.md would have 4100 of its 4000 characters. Make room first: move details into a topic.",
      ),
      '主记忆会超过 4000 个字符的上限，请先删掉一些',
    )
    assert.equal(hostText('There is no entry 9.'), '没有第 9 条')
    assert.equal(hostText('This file no longer exists'), '这个文件已经不在原来的位置了')
    // The error codes the API throws say what happened, what the host said, and what to do.
    assert.equal(errorCopy('NETWORK'), '连不上 Moon Bot：网络断了，或者服务在重启。 检查一下网络，过几秒再试。')
    assert.equal(
      errorCopy('bot/read-only'),
      '这个窗口现在只能看，不能改。 关掉另一个打开同一团队的 Moon Bot 窗口，然后刷新。',
    )
    assert.equal(errorCopy('HTTP_500'), '服务端出错了。 稍后再试；一直这样的话，到「设置 → 反馈」把诊断发给开发者。')
    assert.equal(errorCopy(undefined), '出了点问题，请再试一次。')
    assert.equal(errorCopy('some/code', 'This file no longer exists'), '这个文件已经不在原来的位置了')
    // The three codes the review named: the generic copy, the host's reason in Chinese,
    // and no English sentence left on the page.
    const named = [
      ['bot/refused', 'This file is not one this conversation produced', '这个文件不是这段对话产出的，不能从这里下载'],
      ['bot/invalid', 'Nothing to send', '没有要发送的内容'],
      ['bot/not-found', 'Unknown Bot', '找不到这个 Bot'],
    ]
    for (const [code, message, reason] of named) {
      const shown = errorCopy(code, message)
      assert.match(shown, new RegExp(reason))
      assert.match(shown, /[一-鿿]/)
      assert.doesNotMatch(shown, /[A-Za-z]{4,}/)
    }
    assert.equal(
      errorCopy('bot/refused', 'This file is not one this conversation produced'),
      '这个操作被拒绝了。 这个文件不是这段对话产出的，不能从这里下载 按提示换个做法；还不行就到「设置 → 反馈」发诊断。',
    )
    assert.equal(errorCopy('bot/invalid', 'Nothing to send'), '请求里有不能接受的内容。 没有要发送的内容 改一下再试。')
    // A reason that cannot be translated is left out, never shown in English.
    assert.equal(
      errorCopy('bot/refused', 'Something server-side broke'),
      '这个操作被拒绝了。 按提示换个做法；还不行就到「设置 → 反馈」发诊断。',
    )
    // A reason equal to the generic copy is not repeated.
    assert.equal(errorCopy('bot/invalid', '请求里有不能接受的内容。'), '请求里有不能接受的内容。 改一下再试。')
    assert.equal(
      errorCopy('bot/refused', ' 这个操作被拒绝了。 '),
      '这个操作被拒绝了。 按提示换个做法；还不行就到「设置 → 反馈」发诊断。',
    )
    assert.equal(
      errorCopy('bot/refused', ' THIS WAS REFUSED. '),
      '这个操作被拒绝了。 按提示换个做法；还不行就到「设置 → 反馈」发诊断。',
    )
  } finally {
    off()
  }
  assert.equal(t('Model'), 'Model')
  assert.equal(hostText('A Bot named Writer already exists'), 'A Bot named Writer already exists')
  assert.equal(
    errorCopy('NETWORK'),
    'Could not reach Moon Bot: the network dropped or the service restarted. Check the network and try again in a moment.',
  )
  assert.equal(errorCopy('bot/refused'), 'That was refused. Follow the hint and try another way.')
  // English keeps the host's reason as it came.
  assert.equal(
    errorCopy('bot/refused', 'This file no longer exists'),
    'That was refused. This file no longer exists Follow the hint and try another way.',
  )
})

test('every Chinese entry still has a literal the interface shows', () => {
  // A rename can leave a dictionary entry behind: the key no longer matches anything the
  // client passes to t() or hostText(), so the entry is dead weight and hides the fact that
  // the new literal has no Chinese. This walks the sources the interface is built from.
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) return /node_modules|dist|\.git/.test(full) ? [] : walk(full)
      return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
    })
  const sources = [...walk(join(PLUGIN, 'src')), ...walk(join(PLUGIN, '..', '..', 'apps', 'desktop', 'ui', 'src'))]
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
  // The dictionary's own values are not evidence: only the code that asks for a key is.
  const dictionary = readFileSync(join(PLUGIN, 'src/client/i18n/zh.ts'), 'utf8')
  // A key is quoted when it contains spaces or punctuation and bare when it is one word;
  // the bare form was invisible to this check, so a rename could leave either kind behind.
  const keys = [...dictionary.matchAll(/^ {2}(?:'((?:[^'\\]|\\.)*)'|"([^"]*)"|([A-Za-z_$][\w$]*)):/gm)]
    .map(match => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1'))
    .filter(key => key !== '')
  // A literal written with an escaped apostrophe counts as the same key.
  const live = (key: string): boolean => sources.includes(key) || sources.includes(key.replace(/'/g, "\\'"))
  assert.deepEqual(
    keys.filter(key => !live(key)),
    [],
    'these Chinese entries no longer match any literal',
  )
})

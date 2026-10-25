// Interface copy follows the DSH language. Keys are the English text; `zh` maps them.
// Copy is looked up at render time and every slot outlet re-renders on a language
// switch, so nothing caches a translated string.

export const NAMESPACE = 'ds-bot'

import { ZH } from './i18n/zh.ts'
import type { I18nKey } from './i18n/keys.ts'

// Callers take the key type from here, beside t().
export type { I18nKey } from './i18n/keys.ts'

// The DSH locale service, as far as this client uses it.
interface LocaleService {
  register: (namespace: string, language: string, table: Record<string, string>) => unknown
  bind: (namespace: string) => (key: string, params?: Record<string, unknown>) => string
  getLocale?: () => { active?: string }
}

const HOST_ERRORS: readonly (readonly [RegExp, string])[] = [
  // Approval refusal from DSH (shows in chat + sidebar preview when the user rejects).
  [/^Error:\s*the user rejected escalating this command to danger-full-access\.?$/i, '你拒绝了完全访问权限，命令没有执行'],
  [/^the user rejected escalating this command to danger-full-access\.?$/i, '你拒绝了完全访问权限，命令没有执行'],
  [/^Error:\s*the user rejected escalating this command to workspace-write\.?$/i, '你拒绝了工作区写入权限，命令没有执行'],
  [/^the user rejected escalating this command to workspace-write\.?$/i, '你拒绝了工作区写入权限，命令没有执行'],
  [/^Error:\s*the user rejected escalating this command to ([\w-]+)\.?$/i, '你拒绝了权限提升（$1），命令没有执行'],
  [/^the user rejected escalating this command to ([\w-]+)\.?$/i, '你拒绝了权限提升（$1），命令没有执行'],
  [/^Error:\s*the user rejected(?: this (?:command|action|request))?\.?$/i, '你拒绝了这次操作，命令没有执行'],
  [/^the user rejected(?: this (?:command|action|request))?\.?$/i, '你拒绝了这次操作，命令没有执行'],
  [/^Model (.+) is not available\. Available: (.*)$/, '模型 $1 不可用。可用的：$2'],
  [/^The API key for (.+) is set outside Moon Bot and cannot be changed here$/, '$1 的 API key 是在 Moon Bot 之外设置的，这里改不了'],
  [/^(.+) takes no API key here$/, '$1 不能在这里填 API key'],
  [/^(.+) is already set up$/, '$1 已经设置过了'],
  [/^Moon Bot offers no provider (.+)$/, 'Moon Bot 没有服务商 $1'],
  [/^Moon Bot already offers (.+); add it from its list$/, 'Moon Bot 已经提供 $1，请在常用服务商里添加'],
  [/^The protocol must be one of (.+)$/, '协议只能是 $1'],
  [/^(.+) is not set up$/, '$1 还没有设置'],
  [/^(.+) comes with this setup and cannot be removed$/, '$1 是这个配置自带的，不能删除'],
  [/^A Bot named (.+) already exists$/, '已经有叫 $1 的 Bot 了'],
  [/^Name (.*) is not available$/, '名字 $1 不可用'],
  [/^"(.+)" calls everyone in a group, so it cannot be a Bot name$/, '「$1」在群里表示所有人，不能用作 Bot 名字'],
  [/^"(.+)" stands for the user in a chat, so it cannot be a Bot name$/, '「$1」在对话里表示用户本人，不能用作 Bot 名字'],
  [/^Another group chat is already called "(.+)"$/, '已经有叫「$1」的群聊了'],
  [/^A group chat holds at most (\d+) Bots$/, '一个群聊最多 $1 个 Bot'],
  [/^Reply mode must be one of (.+)$/, '回复模式只能是 $1'],
  [/^Only the user, a Main Bot, or the admin of "(.+)" can change it$/, '只有你、主 Bot 或「$1」的管理员可以修改'],
  [/^A key must have at least (\d+) characters$/, '密钥至少 $1 个字符'],
  [/^A key can have at most (\d+) characters$/, '密钥最多 $1 个字符'],
  [/^(.+) is not saved yet$/, '$1 还没有保存'],
  [/^The Bot team in (.+) is open in another Moon Bot \((.+)\)\. This window shows the team but cannot change it; close the other one and reload\.$/, '$1 里的 Bot 团队已在另一个 dsh 中打开（$2）。这个窗口只能查看，不能修改；关掉另一个后刷新。'],
  [/^HTTP (\d+)$/, '请求失败（HTTP $1）'],
  [/^GitHub answered (\d+)$/, 'GitHub 返回了 $1'],
  [/^Keep the name under (\d+) characters$/, '名字不能超过 $1 个字'],
  [/^Give the full path of the folder, not (.+)$/, '请填写文件夹的完整路径，而不是 $1'],
  [/^There is no folder at (.+)$/, '找不到文件夹 $1'],
  [/^(.+) is a file, not a folder$/, '$1 是文件，不是文件夹'],
  [/^(.+) holds another runtime\'s data, so Bots cannot work there$/, '$1 里有其他运行时的数据，Bot 不能在这里工作'],
  // Memory changes the memory panel asked for; the whole message is matched.
  [/^This looks like a key, token, or password[\s\S]*$/, '看起来像密钥、令牌或密码，记忆不会保存这类内容'],
  [/^An entry holds at most (\d+) characters; this one has (\d+)\.[\s\S]*$/, '一条记忆最多 $1 个字符，这条有 $2 个'],
  [/^[\s\S]*'s MEMORY\.md would have (\d+) of its (\d+) characters\.[\s\S]*$/, '主记忆会超过 $2 个字符的上限，请先删掉一些'],
  [/^The topic \[\[(.+?)\]\] in [\s\S]* would have (\d+) of its (\d+) characters\.[\s\S]*$/, '主题 $1 会超过 $3 个字符的上限'],
  [/^[\s\S]* already has (\d+) topics, the most it holds\.[\s\S]*$/, '主题已经有 $1 个，不能再加新主题'],
  [/^There is no entry (.+)\.$/, '没有第 $1 条'],
  [/^No entry in [\s\S]* matches "([\s\S]*)"\.[\s\S]*$/, '找不到「$1」这条记忆'],
  [/^"([\s\S]*)" matches (\d+) entries in [\s\S]*$/, '「$1」对应了 $2 条记忆，请说得更具体'],
  [/^Memory cannot change now: [\s\S]*$/, '现在不能修改记忆：另一个窗口正在使用这个 Bot 团队'],
  [/^This file no longer exists$/, '这个文件已经不在原来的位置了'],
  [/^Only files in this conversation's folder can be downloaded$/, '只能下载这段对话自己文件夹里的文件'],
  [/^This file is not one this conversation produced$/, '这个文件不是这段对话产出的，不能从这里下载'],
  [/^This conversation is no longer here$/, '这段对话已经不在了，刷新页面看看'],
  [/^This conversation has no folder$/, '这段对话没有可用的文件夹'],
  [/^Only files in the team's folders can be downloaded$/, '只能下载团队文件夹里的文件'],
  [/^This file cannot be read here$/, '这里读不了这个文件'],
  [/^Too large to download here \(over (\d+) MB\)$/, '文件太大，这里下载不了（超过 $1 MB）'],
  [/^No file named$/, '没有指定文件'],
  [/^This message is no longer kept$/, '这条消息已经不再保留了'],
  [/^Unknown Bot$/, '找不到这个 Bot'],
  [/^Nothing to send$/, '没有要发送的内容'],
  [/^This question is no longer open$/, '这个问题已经关掉了'],
  [/^This view is no longer open$/, '这个视图已经关掉了'],
  [/^Bot browsers are off on this host$/, '这台机器上 Bot 的浏览器是关着的'],
  [/^A browser poll needs a clientId$/, '浏览器轮询缺少 clientId'],
  [/^Unknown endpoint (.+)$/, '未知的接口 $1'],
]


const fill = (text: string, params?: Record<string, unknown>): string => (params
  ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  : text)

let service: LocaleService | null = null
let bound: ((key: string, params?: Record<string, unknown>) => string) | null = null

// `locale` is the DSH locale service; without one, copy stays English.
export function installLocale(locale: LocaleService | null | undefined): () => void {
  if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return () => {}
  service = locale
  bound = locale.bind(NAMESPACE)
  const off = locale.register(NAMESPACE, 'zh', ZH)
  return () => {
    if (service === locale) { service = null; bound = null }
    if (typeof off === 'function') off()
  }
}

// Moon Bot: the product is named Moon Bot (in Chinese too) wherever the copy names it. The
// upstream strings say DS Bot; the attribution lines keep the upstream name.
const KEEP_NAME = new Set<string>(['Based on DS Bot'])
export const productName = (): string => 'Moon Bot'
export const brand = (text: string): string => text.replace(/\b(?:DS Bot|DeepSeek Bot)\b/g, productName())

// The English interface copy is the key table; text from the host or a webview that is
// not a key comes back unchanged.
export function t(key: I18nKey, params?: Record<string, unknown>): string {
  const text = bound ? bound(key, params) : fill(key, params)
  return KEEP_NAME.has(key) ? text : brand(text)
}

// A message from the host, in the interface language.
export function hostText(message: string): string {
  if (!language().startsWith('zh')) return brand(message)
  if (Object.hasOwn(ZH, message)) return t(message)
  for (const [pattern, template] of HOST_ERRORS) {
    if (pattern.test(message)) return brand(message.replace(pattern, template))
  }
  return brand(message)
}

// What an error code means in the user's words, and what to do about it. The host's own
// text is used only for a code this table does not know, and is translated where it can be.
const ERROR_COPY: Record<string, { en: string; zh: string; hint: string; hintZh: string }> = {
  NETWORK: {
    en: 'Could not reach Moon Bot: the network dropped or the service restarted.',
    zh: '连不上 Moon Bot：网络断了，或者服务在重启。',
    hint: 'Check the network and try again in a moment.',
    hintZh: '检查一下网络，过几秒再试。',
  },
  HTTP_401: { en: 'The sign-in has expired.', zh: '登录状态过期了。', hint: 'Reload the page and sign in again.', hintZh: '刷新页面重新登录。' },
  HTTP_403: { en: 'This action is not allowed for this window.', zh: '这个窗口没有做这个操作的权限。', hint: 'Reload, or let the Main Bot do it.', hintZh: '刷新页面，或者让主 Bot 来做。' },
  HTTP_404: { en: 'What it asked for is gone.', zh: '要找的内容不在了。', hint: 'Reload the page and try again.', hintZh: '刷新页面再试一次。' },
  HTTP_429: { en: 'Too many requests just now.', zh: '刚才的请求太多了。', hint: 'Wait a few seconds and try again.', hintZh: '等几秒再试。' },
  HTTP_500: { en: 'The server failed.', zh: '服务端出错了。', hint: 'Try again later; if it keeps happening, send the diagnostics from Settings → Feedback.', hintZh: '稍后再试；一直这样的话，到「设置 → 反馈」把诊断发给开发者。' },
  'bot/invalid': { en: 'The request holds something it cannot accept.', zh: '请求里有不能接受的内容。', hint: 'Change it and try again.', hintZh: '改一下再试。' },
  'bot/refused': { en: 'That was refused.', zh: '这个操作被拒绝了。', hint: 'Follow the hint and try another way.', hintZh: '按提示换个做法；还不行就到「设置 → 反馈」发诊断。' },
  'bot/not-found': { en: 'What it asked for is not there any more.', zh: '找不到要操作的对象了。', hint: 'Reload the page and check it is still there.', hintZh: '刷新页面，确认它还在。' },
  'bot/stale': { en: 'That is no longer open.', zh: '这个已经关掉了。', hint: 'Reload the page and open it again.', hintZh: '刷新页面重新打开一次。' },
  'bot/read-only': { en: 'This window can only look, not change.', zh: '这个窗口现在只能看，不能改。', hint: 'Close the other Moon Bot window that has this team open, then reload.', hintZh: '关掉另一个打开同一团队的 Moon Bot 窗口，然后刷新。' },
  'bot/unavailable': { en: 'That is not available here.', zh: '这项内容现在拿不到。', hint: 'Try again in a moment.', hintZh: '稍后再试。' },
  'bot/browser-off': { en: 'The Bot\'s browser is off.', zh: 'Bot 的浏览器没有打开。', hint: 'Turn it on in the settings, or let the Bot do it another way.', hintZh: '在设置里打开浏览器，或者让 Bot 换一种方式做。' },
  'bot/internal': { en: 'Moon Bot itself failed.', zh: 'Moon Bot 内部出错了。', hint: 'Restart Moon Bot; if it keeps happening, send the diagnostics from Settings → Feedback.', hintZh: '重启 Moon Bot；一直这样的话，到「设置 → 反馈」发诊断。' },
  'bot/error': { en: 'Something went wrong.', zh: '出了点问题。', hint: 'Try again; send the diagnostics if it keeps happening.', hintZh: '再试一次；一直这样就发诊断。' },
}

// The host's own reason, in the user's language. A message that cannot be translated is
// left out rather than shown in English: the generic copy already says what happened.
const detailOf = (message: string | null | undefined): string => {
  if (typeof message !== 'string' || message.trim() === '') return ''
  const text = message.trim()
  if (!language().startsWith('zh')) return text
  const translated = hostText(text)
  if (translated !== text) return translated
  return /[一-鿿]/.test(text) ? text : ''
}

// What happened and what to do, plus the host's own reason when it can be said in the
// user's language: the generic copy alone would throw away what the server already knows.
// A reason equal to the copy, ignoring surrounding space and case, is not repeated.
const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export function errorCopy(code: string | null | undefined, message?: string): string {
  const copy = typeof code === 'string' && Object.hasOwn(ERROR_COPY, code) ? ERROR_COPY[code] : undefined
  const zh = language().startsWith('zh')
  const generic = zh ? copy?.zh : copy?.en
  const detail = detailOf(message)
  const reason = generic !== undefined && sameText(detail, generic) ? '' : detail
  if (copy === undefined) {
    if (reason !== '') return reason
    return zh ? '出了点问题，请再试一次。' : 'Something went wrong. Try again.'
  }
  return [generic, reason, brand(zh ? copy.hintZh : copy.hint)].filter(Boolean).join(' ')
}

// The active DSH language tag, for dates and times.
export function language(): string {
  const active = service?.getLocale?.().active
  return typeof active === 'string' ? active : 'en'
}

export const dateLocale = (): string => (language().startsWith('zh') ? 'zh-CN' : 'en-US')

// Translations for the tests: the Chinese dictionary itself.
export const DICTIONARY: { zh: typeof ZH } = { zh: ZH }


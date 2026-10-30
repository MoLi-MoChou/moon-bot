import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installLocale } from '../src/client/i18n.ts'
import { RETRY_AFTER, retryNotice, showReconnectNotice } from '../src/client/reconnect.ts'

// The locale service the shell provides, with Chinese copy for the plugin's namespace.
function fakeLocale(active) {
  const dicts = new Map()
  return {
    register: (ns, locale, dict) => { dicts.set(`${ns}:${locale}`, dict); return () => dicts.delete(`${ns}:${locale}`) },
    bind: ns => (key, params) => {
      const text = (active === 'zh' ? dicts.get(`${ns}:zh`)?.[key] : undefined) ?? key
      return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text
    },
    getLocale: () => ({ active }),
  }
}

test('one missed poll stays quiet; two in a row say the window is reconnecting', () => {
  assert.equal(retryNotice(0), null)
  assert.equal(retryNotice(RETRY_AFTER - 1), null)
  assert.equal(retryNotice(RETRY_AFTER), 'Reconnecting… Chats stay saved; this window catches up when the connection is back.')
  // It keeps saying so while the connection stays down.
  assert.match(retryNotice(RETRY_AFTER + 5), /^Reconnecting…/)
})

test('the notice speaks the interface language, and writes no DOM outside a browser', () => {
  const off = installLocale(fakeLocale('zh'))
  try {
    assert.equal(retryNotice(RETRY_AFTER), '正在重连… 对话都还在，连上后这个窗口会自动跟上。')
  } finally {
    off()
  }
  // Node has no document: showing and clearing must be harmless there.
  assert.doesNotThrow(() => showReconnectNotice('Reconnecting…'))
  assert.doesNotThrow(() => showReconnectNotice(null))
})

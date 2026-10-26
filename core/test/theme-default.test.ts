import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveThemeId } from '../src/client/themes.ts'

test('Moon is the default theme; a saved or legacy theme still wins', () => {
  const themes = { moon: {}, deepseek: {}, claude: {}, grok: {} }
  assert.equal(resolveThemeId(themes, undefined), 'moon')
  assert.equal(resolveThemeId(themes, 'gone'), 'moon')
  assert.equal(resolveThemeId(themes, 'claude'), 'claude')
  assert.equal(resolveThemeId(themes, 'mono'), 'grok')
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CHECK = fileURLToPath(new URL('../../../scripts/check-docs.mjs', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/docs', import.meta.url))

test('a missing file and a missing heading name the file and the target', () => {
  const result = spawnSync(process.execPath, [CHECK, '--root', FIXTURE], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  const text = `${result.stdout}${result.stderr}`
  assert.match(text, /bad\.md: missing\.md does not exist/)
  assert.match(text, /bad\.md: other\.md#no-such has no heading "no-such"/)
  assert.ok(!text.includes('ok.md'), text)
})

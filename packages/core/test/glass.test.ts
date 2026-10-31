import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GLASS_DEFAULT, GLASS_LEVELS, applyGlass, readGlass, setGlass, type GlassLevel } from '../src/client/glass.ts'
import { STORAGE } from '../src/client/storage.ts'

const storage = (initial?: string) => {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    saved: () => value,
  }
}

test('a device with no saved level paints the shipped default', () => {
  assert.equal(readGlass(storage()), GLASS_DEFAULT)
  assert.equal(GLASS_DEFAULT, 'standard')
})

test('an unknown or broken stored value falls back instead of breaking the frame', () => {
  assert.equal(readGlass(storage('neon')), GLASS_DEFAULT)
  assert.equal(readGlass(storage('')), GLASS_DEFAULT)
  assert.equal(
    readGlass({
      getItem: () => {
        throw new Error('storage denied')
      },
    }),
    GLASS_DEFAULT,
  )
})

test('every level round-trips through storage', () => {
  for (const level of GLASS_LEVELS) {
    const store = storage()
    setGlass(level, { storage: store })
    assert.equal(store.saved(), level)
    assert.equal(readGlass(store), level)
    assert.equal(store.saved(), level)
    assert.equal(level, readGlass(store))
  }
})

test('the default removes the attribute so the token default applies', () => {
  const body: { dataset: Record<string, string | undefined> } = { dataset: {} }
  applyGlass('strong', body)
  assert.equal(body.dataset.btGlass, 'strong')
  applyGlass(GLASS_DEFAULT, body)
  assert.equal('btGlass' in body.dataset, false)
})

test('applying outside a browser is harmless, and storage failing still paints', () => {
  assert.doesNotThrow(() => applyGlass('light', undefined))
  const body: { dataset: Record<string, string | undefined> } = { dataset: {} }
  const level: GlassLevel = setGlass('light', {
    storage: {
      setItem: () => {
        throw new Error('quota')
      },
    },
  })
  assert.equal(level, 'light')
  // The session still paints even when the value cannot be saved.
  applyGlass(level, body)
  assert.equal(body.dataset.btGlass, 'light')
})

test('the key is a Moon Bot key', () => {
  assert.equal(STORAGE.glass, 'moon-bot:glass')
})

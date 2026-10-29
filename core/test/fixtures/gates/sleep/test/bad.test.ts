import { test } from 'node:test'

test('sleeps twice', async () => {
  await new Promise(resolve => setTimeout(resolve, 20))
  await new Promise(resolve => setTimeout(resolve, 5))
})

test('a loop still sleeps', async () => {
  while (false) await new Promise(resolve => setTimeout(resolve, 10))
})

import { test } from 'node:test'

const waitFor = async (ready: () => boolean): Promise<void> => {
  if (!ready()) await new Promise(resolve => setImmediate(resolve))
}

test('waits on a barrier, an event and a fake clock', async () => {
  await waitFor(() => true)
  await new Promise(resolve => setImmediate(resolve))
  const clock = { tick(_ms: number) {} }
  clock.tick(1000)
  const ms = 10
  await new Promise(resolve => setTimeout(resolve, ms))
  await Promise.race([new Promise(resolve => setTimeout(resolve, 10)), Promise.resolve()])
})

// The suite's own environment, loaded before any test: one temp home per run, so a test
// reading or writing "the data folder" never touches a real install, and no test sees the
// home of whoever runs it. The folder goes when the run ends.
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testHome = join(tmpdir(), `moon-bot-test-home-${process.pid}`)
process.env.DSH_HOME = testHome
process.env.MOON_BOT_DATA = testHome
process.on('exit', () => {
  try {
    rmSync(testHome, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

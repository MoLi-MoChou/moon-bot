// One command: executable, version, handshake, one session. No prompt and no
// credentials. From core/: node dev/engine-doctor.ts [engine-id]
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acpDoctorProbe } from '../src/engine/acp/doctor.ts'
import { discoverLocalAgents } from '../src/engine/acp/discovery.ts'
import { examine, formatDoctor } from '../src/engine/doctor.ts'

const id = process.argv[2]
const agents = discoverLocalAgents()
if (id === undefined || id === '') {
  for (const agent of agents) {
    const where = agent.path ?? (agent.onDemand === true ? 'on-demand' : '')
    process.stdout.write(`${agent.id}\t${agent.kind}\t${where}\n`)
  }
} else {
  const agent = agents.find(entry => entry.id === id)
  if (agent === undefined) {
    process.stderr.write(`unknown engine ${id}\n`)
    process.exit(2)
  }
  const cwd = mkdtempSync(join(tmpdir(), 'moon-bot-doctor-'))
  let code = 1
  try {
    const result = await examine(agent, acpDoctorProbe, { cwd })
    process.stdout.write(`${formatDoctor(result)}\n`)
    code = result.ok ? 0 : 1
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  process.exit(code)
}

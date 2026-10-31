// One command: executable, version, handshake, one session. No prompt and no
// credentials. From core/: node dev/engine-doctor.ts [engine-id] [--json]
//
// With no id it lists the engines it found. With an id it walks the checks and prints the
// capability report — what the engine can actually do here, and where to go instead when it
// cannot. `--json` prints the same report as one object, for a script or a UI.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acpDoctorProbe } from '../src/engine/acp/doctor.ts'
import { discoverLocalAgents } from '../src/engine/acp/discovery.ts'
import { capabilityReportOf, capabilitySummary, reportJson } from '../src/engine/capability-report.ts'
import { examine, formatDoctor } from '../src/engine/doctor.ts'

const args = process.argv.slice(2)
const json = args.includes('--json')
const id = args.find(arg => !arg.startsWith('--'))
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
    const capability = capabilityReportOf(result, { methods: result.methods ?? [] }, result.kind ?? agent.kind)
    if (json) {
      process.stdout.write(`${reportJson(capability)}\n`)
    } else {
      process.stdout.write(`${formatDoctor(result)}\n`)
      process.stdout.write(`\n${capabilitySummary(capability)}\n`)
      if (!capability.usable && capability.recommendedFallback !== undefined)
        process.stdout.write(`Next: ${capability.recommendedFallback}\n`)
    }
    code = capability.usable ? 0 : 1
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  process.exit(code)
}

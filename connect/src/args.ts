// CLI arguments (plan §接入 CLI): everything before "--" belongs to the connector,
// everything after it is the agent command, passed through untouched.

export type ArgsOutcome =
  | { readonly ok: false, readonly error: string }
  | { readonly ok: true, readonly help: true }
  | { readonly ok: true, readonly help: false, readonly url: string, readonly token: string, readonly command: readonly string[] }

export const USAGE = `moon-bot-connect: attach a local ACP agent to a Moon Bot relay.

Usage:
  moon-bot-connect --url <relay-url> --token <invite-token> [-- <command> [args...]]

Options:
  --url <url>      Relay endpoint, for example wss://host:8290/api/bot/relay
  --token <token>  Invite token issued by a Main Bot (shown once when created)
  -h, --help       Show this help

Without a command after "--" the CLI probes for exactly one local agent
(claude, gemini, opencode) and refuses to guess when none or several are
installed — name the one to use after "--" then.

The agent speaks JSON-RPC on stdio: each of its output lines becomes one
WebSocket text frame, and each frame from the relay is written back as one
line. When either end goes down the CLI exits non-zero, so a supervisor or
a person can restart it. Logs go to stderr; stdout stays clean.
`

export function parseArgs(argv: readonly string[]): ArgsOutcome {
  let url: string | undefined
  let token: string | undefined
  let index = 0
  for (; index < argv.length; index++) {
    const arg = argv[index] as string
    if (arg === '--') {
      index += 1
      break
    }
    if (arg === '-h' || arg === '--help') return { ok: true, help: true }
    if (!arg.startsWith('--')) return { ok: false, error: `unexpected argument "${arg}" — the agent command goes after "--"` }
    const equals = arg.indexOf('=')
    const name = equals === -1 ? arg : arg.slice(0, equals)
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    const value = (): string | undefined => {
      if (inline !== undefined) return inline
      const next = argv[index + 1]
      if (next === undefined) return undefined
      index += 1
      return next
    }
    if (name === '--url') {
      const next = value()
      if (next === undefined) return { ok: false, error: '--url requires a value' }
      url = next
    } else if (name === '--token') {
      const next = value()
      if (next === undefined) return { ok: false, error: '--token requires a value' }
      token = next
    } else return { ok: false, error: `unknown option "${name}"` }
  }
  const command = argv.slice(index)
  if (url === undefined || url === '') return { ok: false, error: 'missing --url <relay-url>' }
  if (token === undefined || token === '') return { ok: false, error: 'missing --token <invite-token>' }
  return { ok: true, help: false, url, token, command }
}

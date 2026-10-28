# moon-bot-connect

Attach a local ACP agent — Claude, Gemini, OpenCode — to a Moon Bot team with one command.

On the Moon Bot side a Main Bot issues an invite (Settings → Remote agents); the invite shows
the exact command to run here:

```sh
npx moon-bot-connect --url wss://your-server:8290/api/bot/relay --token <invite>
```

Without a command after `--` the CLI probes for exactly one installed agent and refuses to
guess between several — name the one to use explicitly:

```sh
npx moon-bot-connect --url wss://host/api/bot/relay --token <invite> -- claude
```

The agent speaks JSON-RPC on stdio; each of its output lines becomes one WebSocket frame and
each frame is written back as one line. When either end goes down the CLI exits non-zero, so a
supervisor (systemd, launchd, docker `--restart`) can bring it back. It needs no open port on
this machine: the connection is outbound, and revoking the invite on the Moon Bot side cuts it.

## When it does not work

```sh
npx moon-bot-connect doctor --url wss://host/api/bot/relay --token <invite>
```

The doctor checks Node (22.18+ runs the TypeScript sources, though the published package
ships plain JavaScript), the local agents it can find, and the invite — printing one line per
check with the fix:

```
ok   node: v24.1.0
ok   agent: Claude at /usr/local/bin/claude
FAIL relay: the relay rejected this invite (unknown or revoked); ask a Main Bot for a new one
```

Exit code is 0 when every check passes and 1 otherwise.

## Requirements

- Node 22.18 or newer (the published bundle targets node22).
- One supported agent CLI on `PATH`, or a command named after `--`.

## License

Apache-2.0. Part of [Moon Bot](https://github.com/MoLi-MoChou/moon-bot).

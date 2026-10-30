# moon-bot-contracts

Shared Moon Bot contracts: RPC types, zod schemas, views / OpenUI, mentions, lean tool sets, and model / connector catalogs.

Pure TypeScript + `zod` only. No React, Fastify, SQLite, or Electron.

Import the named public barrel:

```ts
import { LEAN, validateView, type RpcEndpoint } from 'moon-bot-contracts'
```

Build emits `dist/` for Node installs under `node_modules` (type stripping does not run there).

# moon-bot-ui

Shared Moon Bot UI kit: `EmptyState`, `Field` / `Select`, and settings chrome (`Row`, `Card`, `Switch`, `SwitchRow`, `InlineText`) plus their CSS string exports.

Pure React primitives. No host / store / service / engine, and no `api` / actions / sources.

Styling uses existing `--bt-*` CSS variables (installed by the host). Kit CSS that needs spring timing uses a small local `spring.ts` (copied helpers only — does not pull in `client/motion.tsx`).

Import the named public barrel:

```ts
import { EmptyState, Field, Card, SETTINGS_CHROME_CSS } from 'moon-bot-ui'
```

Build emits `dist/` for Node installs under `node_modules` (JSX is transformed with `h` / `Fragment`, matching core).

# Format (Biome)

Moon Bot uses **Biome for format only**. Architecture lint stays **oxlint + `check-gates`** (including the ≤350 line gate). Do not turn on Biome lint rules for layer or size policy.

## Dense files and splits

Some client/host modules used compact one-line JSX so they stayed ≤350 lines. Biome expands nested JSX and pushes those files over the gate.

**This stack:**

1. Formats the rest of the repo with Biome (`lineWidth` 120, single quotes, `semicolons: asNeeded`).
2. Splits gate-sensitive modules by responsibility so each file stays ≤350 **after** format, then drops their `biome.json` ignores.

### Cleared in the dense-split PR (batch 1)

Client modules split and formatted (ignores removed):

- `settings.tsx` → `settings-chrome`, `settings-general`, `settings-bots-page`, `settings-groups-page`
- `connector-custom.tsx` → `connector-custom-form`, `connector-custom-list`, `connector-custom-actions`
- `mark.tsx` → `mark-bot`, `mark-room` (barrel)
- `sidebar.tsx` → `sidebar-update`, `sidebar-extras`
- `feedback.tsx` → `feedback-toast`, `feedback-css`
- `about.tsx` → `about-updates`, `about-css`
- `engine-menu.tsx` → `engine-menu-choice`, `engine-menu-css`

### Cleared in batch 2 (stacked on batch 1)

Client modules split and formatted (ignores removed):

- `bot-settings.tsx` → `bot-settings-avatar`, `bot-settings-engine`, `bot-settings-css`
- `schedules.tsx` → `schedules-types`, `schedules-timing`, `schedules-form`, `schedules-row`, `schedules-css`
- `details-drawer.tsx` → `details-drawer-browser`, `details-drawer-overview`
- `group-settings.tsx` → `group-settings-types`, `group-settings-forms`, `group-settings-new`, `group-settings-css`
- `providers-page.tsx` → `providers-types`, `providers-row`, `providers-add`, `providers-css`
- `secret-card.tsx` → `secret-card-types`, `secret-card-input`, `secret-card-form`, `secret-card-dock`
- `cells-tool.tsx` → `cells-tool-types`, `cells-tool-phrases`, `cells-tool-group`, `cells-tool-call`
- `cells-rows.tsx` → `cells-rows-memory`
- `cells-chat.tsx` → `cells-chat-types`, `cells-chat-events`
- `cells-turns.tsx` → `cells-turns-types`, `cells-turns-cells`, `cells-turns-tree`
- `cells-bubbles.tsx` → `cells-bubbles-types`, `cells-bubbles-ui`, `cells-bubbles-group`

### Cleared in batch 3 (stacked on batch 2)

Files that stay ≤350 after Biome format with a per-file `lineWidth` override (still formatted, ignore removed):

- contracts: `rpc.ts` (w200)
- client: `browser-pane.tsx`, `client-actions.ts`, `connector-market.tsx`, `deliver-cards.tsx`, `themes.ts`, `usage-page.tsx`, `work-process.tsx`
- host: `browser.ts`, `capabilities.ts`, `channel/ops-team.ts`, `diagnostics.ts`, `groups/rounds.ts`, `memory/prompt.ts`, `providers.ts`, `roster-rooms.ts`, `secrets/install.ts`, `store.ts`, `tools/chat-tools.ts`, `tools/shared.ts`, `turns/route.ts`
- service: `llm.ts`

### Cleared in batch 4 (stacked on batch 3)

Types / responsibility splits (ignores removed):

- client: `text.ts` → `text-types`, `text-mentions` (reexports `text-time`)
- host: `turns/delivery.ts` → `delivery-types`; `tasks-panel.ts` → `tasks-panel-types`
- engine: `acp/runtime.ts` → `runtime-types`

### Cleared in batch 5 (stacked on batch 4)

Responsibility / helpers splits (ignores removed):

- contracts: `views/validate.ts` → `validate-check`
- client: `files-panel.ts` → `files-panel-helpers`; `voice.tsx` → `voice-helpers`
- host: `usage/view.ts` → `view-helpers`
- web-search: `provider.ts` → `provider-helpers`

### Cleared in batch 6 (stacked on batch 5)

Helpers / types splits (+ `lineWidth` 320 overrides where needed):

- client: `member-status.tsx` → `member-status-helpers`; `characters.ts` → `characters-types` (w320); `new-chat.tsx` → `new-chat-types` (w320)
- store: `proactive.ts` → `proactive-rules`
- host: `groups.ts` → `groups-types` (w320); `roster.ts` → `roster-types` (w320); `memory/recall.ts` → `recall-types` (w320); `capabilities-mount.ts` → `capabilities-mount-types` (w320)

### Cleared in batch 7 (stacked on batch 6)

Types + `lineWidth` 320 overrides:

- client: `questions.tsx` → `questions-types`
- host: `groups/log.ts` → `log-types`; `parts-switch-move.ts` → types; `parts-switch.ts` → types

### Cleared in batch 8 (stacked on batch 7)

Helpers (+ `lineWidth` 320 for `memory.ts`):

- client: `memory-panel.tsx` → `memory-panel-helpers`
- host: `memory.ts` → `memory-helpers` (w320)

### Cleared in batch 9 (stacked on batch 8)

Types + `lineWidth` 320:

- host: `chat-index.ts` → `chat-index-types`; `memory/storage.ts` → `storage-types`

### Follow-up (still ignored until split)

Remaining `packages/**/src` ignores (~13): denser modules — `widget-cell`, `usage-charts`, `sidebar-rows`, `model-menu`, `read-page`, `tasks-page`, `browser-pane-chrome`, host `parts`/`news`, `client-boot`/`index`/`bot-browsers`, `service/engine`, etc. Split by responsibility, remove each ignore, keep ≤350 after format.

## Scripts

- `pnpm run format` — write
- `pnpm run format:check` — CI / `check:static`
- `pnpm run check:static` — typecheck + lint + format:check

Tool choice: **Biome** (openbot-aligned formatter tooling). oxlint/`check-gates` stay the architecture lint.

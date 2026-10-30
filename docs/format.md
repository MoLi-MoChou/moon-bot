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

### Follow-up (still ignored until split)

Remaining `packages/**/src` paths listed as `!…` in `biome.json` (host memory/parts/groups/roster, usage-*, browser-pane*, tasks-page, memory-panel, widget-cell, connector-market, sidebar-rows, themes/text/characters, client-boot/actions, index, service/engine/llm, store/proactive, web-search, acp/runtime, etc.). Split by responsibility the same way, remove each ignore, run `pnpm run format` on the new files, keep ≤350.

## Scripts

- `pnpm run format` — write
- `pnpm run format:check` — CI / `check:static`
- `pnpm run check:static` — typecheck + lint + format:check

Tool choice: **Biome** (openbot-aligned formatter tooling). Prettier was tried; it expands dense JSX the same way, so it does not avoid the ignores. oxlint/`check-gates` stay the architecture lint.

## Windows / line endings

Biome uses `lineEnding: lf`. The repo `.gitattributes` sets `* text=auto eol=lf` so Windows checkouts (including `windows-latest` CI) keep LF and `pnpm run format:check` matches Linux.

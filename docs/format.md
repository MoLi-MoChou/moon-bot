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

### Follow-up (still ignored until split)

Remaining `packages/**/src` paths listed as `!…` in `biome.json` (host memory/parts/groups, cells-*, bot-settings, schedules, details-drawer, usage-*, etc.). Split by responsibility the same way, remove each ignore, run `pnpm run format` on the new files, keep ≤350.

## Scripts

- `pnpm run format` — write
- `pnpm run format:check` — CI / `check:static`
- `pnpm run check:static` — typecheck + lint + format:check

Tool choice: **Biome** (openbot-aligned formatter tooling). oxlint/`check-gates` stay the architecture lint.

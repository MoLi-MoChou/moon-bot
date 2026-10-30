# Format (Biome)

Moon Bot uses **Biome for format only**. Architecture lint stays **oxlint + `check-gates`** (including the ≤350 line gate). Do not turn on Biome lint rules for layer or size policy.

## Why some `src` files are ignored

The client/host keep **dense one-line JSX / compact TS** so files stay ≤350 lines. Biome (and Prettier) expand nested JSX into multi-line form and push those files over the gate. This PR therefore:

1. Formats the rest of the repo with Biome (`lineWidth` 120, single quotes, `semicolons: asNeeded`).
2. Leaves gate-sensitive dense files on their pre-format text and lists them under `files.includes` as `!…` ignores in `biome.json`.

When a deferred file is split under 350, remove its ignore and run `pnpm run format` on it.

## Scripts

- `pnpm run format` — write
- `pnpm run format:check` — CI / `check:static`
- `pnpm run check:static` — typecheck + lint + format:check

Tool choice: **Biome** (openbot-aligned formatter tooling). Prettier was tried; it expands dense JSX the same way, so it does not avoid the ignores.

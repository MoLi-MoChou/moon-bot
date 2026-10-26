# AGENTS.md

Instructions for AI coding agents that work on this repository. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which has the same rules with more detail.

## What this project is

Moon Bot is a team of long-lived Bots with its own runtime — no DeepSeek Harness install. It has three parts:

- `core/`: the product, in TypeScript. `src/host/` is the host services (roster and store, tools, turns and delivery, groups, parts, memory, schedules, capabilities, the `api/bot` channel); `src/engine/` the `AgentRuntime` seam with two implementations (the built-in pi kernel and ACP); `src/store/` the SQLite store; `src/service/` the Fastify service, its stores and the scheduler; `src/client/` the React surface; `src/web-search/` the `auto` search provider.
- `app/`: the desktop app for Windows and Linux, in TypeScript. Its window loads the service Moon Bot runs itself; the main process bundles through esbuild.
- The runtime: the service (auth, static UI, SSE feed), the host services, the built-in engine over SQLite, the policy engine, the scheduler and the connector layer. `@earendil-works/pi-agent-core` + `pi-ai` are the only agent-loop dependencies; everything else is ours.

The Bot team:

- Every Bot is a long-lived identity whose work runs in engine sessions: one for its own chat, one for each group it is in, and a fresh one when the context fills up (earlier ones stay readable). A turn runs on the engine the Bot names — the built-in one, or an ACP agent — behind one `AgentRuntime` interface.
- The team works together: Bots message each other, share group chats and can see what the other Bots are doing. Each Bot still runs on its own and does not disturb the others.
- Bots have clear, different roles. A Main Bot has the highest rights: it creates, changes and removes other Bots. Other Bots do not get these rights. There can be more than one Main Bot.
- Users customize each Bot (name, role label, instructions, model, character).
- Behavior must be reliable: a Bot acts on evidence, stays inside its goal, and its results can be checked.

## Hard rules

1. **Keep the runtime our own.** Bot features go through the host services and the `AgentRuntime` seam; a kernel stays behind it (the built-in engine, or an ACP adapter), never called from host code. `@deepseek-ai` is gone from `core/`; do not add it back. The desktop app still carries the profile-boot path used by its import-from-DSH feature, and that is the only place the name may appear.
2. **No secrets.** Never write, print or commit API keys, tokens, cookies or the data folder’s secrets. Use the mock model (`core/dev/mock-llm.ts`) for tests; it needs no key.
3. **Only original material.** Do not copy code, text, icons, logos or graphics from other products or websites. Code under a license compatible with Apache 2.0 is the only exception: say where it comes from and add its notice to the `NOTICE` file.
4. **`client.js` and `dist/` are generated, not committed.** The root postinstall builds them on install; change `core/src/`, then run `npm run build` (`cd core && npm run build`). Never edit the artifacts by hand, and never commit them.
5. **Do not touch the user's own data.** The app keeps the team in its own data folder (`~/.moon-bot`); tests keep theirs in a temp folder and delete it. Never point a test at a real install's data.

## Commands

The repository is two npm workspaces (`core/` = `moon-bot-core`, `app/` = `moon-bot`) under one root lockfile: install once at the root (`npm ci`), then run a package's scripts in its folder or from the root with `-w` (`npm test -w moon-bot-core`). Node 22.18+ runs the .ts sources directly (native type stripping); the generated artifacts (`core/client.js`, `core/dist/`) are built by the postinstall of the install and by `npm run build`, never committed.
The root `allowScripts` names the packages whose install scripts may run (the SQLite prebuilt, esbuild's binary); npm 11.5+ gates every other one.

```sh
npm ci                                 # installs both workspaces, then builds client.js and dist/
npm run build                          # rebuilds the artifacts after a source change
npm test                               # unit tests (one asserts client.js is fresh)
npm run typecheck                      # tsc --noEmit, strict
npm run lint                           # oxlint + the architecture/size/floating-promise gates
npm run eval                           # the five-capability evaluation set
npm run web                            # the standalone service (MOON_BOT_UI serves the built UI)
```

A change is done when `npm test`, `npm run typecheck` and `npm run lint` pass; CI runs them on every pull request. The bench in `dev/bench.sh` still runs a DSH-hosted profile for comparison; it is not part of the product's start path. Use a free port for each bench, and stop every bench and process that you started.

## Branches, pull requests and issues

The full workflow is in [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work). The parts that an agent must follow:

- Start work from the latest `dev` on a branch named `fix/<issue>-<name>`, `feat/<issue>-<name>`, `docs/<name>` or `chore/<name>`. Never start a branch name with `dev/`. Open the pull request into `dev`, not `main`; only releases and hotfixes go into `main`.
- Bring a branch up to date with `git merge dev`. Never rebase a pushed branch and never force-push.
- Fill in the pull request template. Link the issue with `Fixes #<number>`; a bug fix names the bug it fixes. Write the user-visible change in the Changelog field, and do not edit `CHANGELOG.md`.
- Do not start work on an issue or pull request with the `maintainer` label; it waits for the maintainer. Do not take an issue that someone else is assigned to.
- Before you change behavior, read the design for it in `docs/plans/` (and `docs/vision.md`). A change to a decided design needs the maintainer; a new large feature adds its design note to the same pull request.
- Do not close an issue without evidence: the pull request or commit that fixed it, the issue it duplicates, or the reason it will not be fixed.
- To triage issues, follow [.agents/skills/issue-triage/SKILL.md](.agents/skills/issue-triage/SKILL.md).

## Layout

- `core/src/index.ts`: the plugin entry (module order and the runtime object). `core/index.js`, `core/client.js` and `core/dist/` are generated (never committed).
- `core/src/host/`: the host services (roster and store, tools and the capability registry, turns and delivery, groups, parts, memory, schedules, secrets, images, the browser bridge, the `api/bot` channel, the live feed).
- `core/src/engine/`: the `AgentRuntime` interface and events, the built-in engine (`builtin/`: pi adapter, runtime, bridge, services), the ACP adapter (`acp/`), the tool registry and the policy engine, the MCP connector.
- `core/src/store/`: the SQLite store — migrations, sessions and messages, tasks, the memory index, the policy counters.
- `core/src/service/`: the Fastify service, its host context, credentials, settings, the provider catalog, the scheduler, attachments, the approval bridge, memory sync and the engine wiring.
- `core/src/client/`: the browser side (sidebar, chat, panels, themes, characters, the Bot browser panel).
- `core/src/shared/`: the contracts both ends import (schema, rpc, views, the OpenUI lowering, mentions, lean).
- `core/test/`: unit tests (`.test.ts`) and fixtures; `core/test/eval/` the five-capability set. `core/dev/`: mock model, bench, smoke test, scripts.
- `app/`: the desktop app in TypeScript (main process and window, the service host child, first-run setup, installer and updates).

## Style

- Follow the code around your change. Keep functions small and names plain.
- Write a comment only when the reason is not clear from the code: a hidden constraint, an invariant, a workaround. Do not describe what the code does.
- Commit messages in English, imperative subject, the reason in the body. Keep commits small.
- The person who asked for the change is the commit author. Do not set an AI agent or bot as author or committer, and do not add `Co-authored-by` lines for one.
- User-facing text in the plugin is English. README.md is Chinese first with an English section; keep both parts in step.

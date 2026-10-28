# Contributing to DS Bot

English | [中文](CONTRIBUTING.zh.md)

Thank you for helping. This file explains how the team works, how to set up the plugin, how to test a change and which rules a change must follow. For what the plugin does and how users install it, see [README.md](README.md).

## Who can open pull requests

Collaborators of this repository push branches here and open pull requests into `dev` (see [How we work](#how-we-work)). For now, only collaborators can open pull requests. If you are not a collaborator, please open an issue for a bug (see [Report a problem](#report-a-problem)) or use [Discussions](https://github.com/Fei2411/DeepSeek-Bot/discussions) for a question or an idea.

## The rules that matter most

1. **The runtime is ours.** Bot features go through the host services and the `AgentRuntime` seam; a kernel stays behind it (the built-in engine, or an ACP adapter) and host code never calls one directly. Do not reintroduce `@deepseek-ai`: the product installs nothing underneath itself, and an issue comes before a new dependency.
2. **Bots run in engine sessions.** A Bot keeps its identity while its work runs in engine sessions: one for its own chat, one for each group, a fresh one when the context fills up. Every turn goes through the `AgentRuntime` seam — the built-in engine, or the ACP adapter — never a second loop beside it.
3. **No real secrets anywhere.** Do not commit API keys, tokens, cookies, data folders, logs or screenshots with personal data. The tests and the test bench use a scripted mock model and need no key.
4. **Only original material.** Do not copy code, text, icons, logos or other graphics from other products or websites. Code under a license compatible with Apache 2.0 is the only exception: say where it comes from and add its notice to a `NOTICE` file.
5. **Every change is tested.** Run the unit tests and the client check for every change (see [Test a change](#test-a-change)).

## How we work

Anyone on the team can do any kind of work: triage, bug fixes, features, the interface, docs. Only some decisions belong to the maintainer: the direction of the product, changes to a design that is already decided, these rules, releases and the architecture. Issues and pull requests that need such a decision carry the `maintainer` label; wait for the maintainer's answer before you start on them. What DS Bot is meant to be is in [docs/vision.md](docs/vision.md); the decided designs are in [docs/plans/](docs/plans/) (in Chinese). When you are not sure whether something is a bug or works as designed, read them first, then ask in the issue.

### Branches

| Branch | What it is | Who merges |
|---|---|---|
| `dev` | Integration branch. All fixes and features go here first | Every collaborator, when CI passes |
| `main` | Released code only. It changes when the maintainer merges `dev` for a release, or merges a hotfix | The maintainer |
| `fix/<issue>-<name>`, `feat/<issue>-<name>`, `docs/<name>`, `chore/<name>` | Your work. Start it from the latest `dev` | — |

- Do not start a branch name with `dev/`. Git cannot create `dev/<name>` while the branch `dev` exists.
- To bring your branch up to date, run `git merge dev` (on a hotfix branch, `git merge main`). Do not rebase a pushed branch and do not force-push.
- `main` is the default branch, so GitHub suggests `main` as the base of a new pull request. Change the base to `dev`.

### Issues

1. **Triage.** Give each new issue a type, a priority and an area (see [Labels](#labels)). One priority label per issue. The steps, with a script that lists what needs triage, are in [.agents/skills/issue-triage/](.agents/skills/issue-triage/SKILL.md) (in Chinese); an AI agent can follow them as well.
   - A question (how to install, how to use): select **Convert to discussion** and move it to the Q&A category.
   - Not enough information to find the cause: add `needs-info` and ask for exactly what is missing. Say that the issue is closed after 14 days without an answer.
   - A cause in a dependency or in another product: add `upstream` and link the place where it belongs.
   - The same as an open issue: add `duplicate`, link the other issue and close this one.
2. **Claim.** Assign the issue to yourself and write "I'll take this" in it before you start, so that two people do not work on the same thing. Do not take an issue that already has an assignee; ask in the issue first.
3. **Features.** A new idea starts in Discussions (Ideas). When the maintainer agrees, it becomes an issue with the `enhancement` label. Before you build a feature, write in the issue how you plan to do it. For a large feature, add a design note in `docs/plans/<date>-<topic>.md` to the same pull request.
4. **Close with evidence.** When you close an issue, link the pull request or commit that fixed it, the issue it duplicates, or the reason it will not be fixed. Write the comment in the language of the issue.

### Labels

| Kind | Labels |
|---|---|
| Type | `bug` · `enhancement` · `documentation` |
| Priority | `P0` crash, data loss or cannot use · `P1` hurts daily use · `P2` ordinary bug or feature · `P3` suggestion or narrow case |
| Area | `area/host` server side (`index.js`, `src/host/`) · `area/client` interface (`src/client/`) · `area/group` group chats, mentions, Bot-to-Bot messages · `area/memory` memory, conversation parts, context · `area/browser` Bot browser, page reading, web search · `area/build` CI, release, scripts, test bench · `area/docs` |
| Flow | `maintainer` waits for the maintainer · `needs-info` waits for the reporter · `upstream` the cause is in a dependency or another product · `duplicate` · `auto-found` found by automated testing |

An issue that spans several areas, or none, gets no area label.

### Pull requests

1. Open the pull request into `dev` and fill in the template. Link the issue with `Fixes #<number>`; a bug fix always names the bug it fixes.
2. Write one sentence about what users will notice in the **Changelog** field of the template, or "none". Do not edit `CHANGELOG.md`: the maintainer writes it from these sentences at release time.
3. When CI passes, merge it yourself with **Create a merge commit**, then delete the branch. A review is not required; if you want one, ask a teammate in the pull request.
4. A fix that is merged into `dev` does not close its issue: `Fixes #<number>` acts only on the default branch. The issue stays open until the release, which means "fixed in `dev`, not released yet".

Keep one pull request to one issue. Split a large change into several pull requests.

### Merge conflicts

- **`core/client.js`**: it is generated and never committed, so it conflicts only if both sides committed it by mistake. Resolve `core/src/client/` and drop the generated file from the merge (`git checkout --ours core/client.js` then `npm run build`).
- **`CHANGELOG.md`**: pull requests do not change it, so it should not conflict. If it does, keep both sides.

### Releases (maintainer)

1. Make sure `main` is green: only merges that pass the three checks reach it.
2. Set the version with `node scripts/version.mjs X.Y.Z` (each release gets its own version), then fast-forward `main` and push a tag: `git tag vX.Y.Z && git push origin main vX.Y.Z`. The procedure is in [docs/RELEASING.md](docs/RELEASING.md).
3. The tag drives both artifacts: the Desktop workflow builds the Windows installer and portable exe and the Linux AppImage, runs the packaged-app check and publishes a **pre-release** with the update metadata; the Web image workflow runs the browser end-to-end check and only then pushes the image to GHCR (`:vX.Y.Z`, `:main`, `:latest`, and a short-sha tag).
4. Servers move with `deploy/update.sh` (auto-rollback when the new image does not become healthy) or `deploy/rollback.sh`. The `moon-bot-connect` CLI is versioned and published separately (its own `connect-vX.Y.Z` tag); it needs the `NPM_TOKEN` secret.
5. For a hotfix, start `fix/hot-<name>` from `main`, merge it into `main`, release a patch version, then merge `main` into `dev`.

## Set up

You need:

- Node.js `22.19` or later (or `24` and later).
- Git.
- Nothing else: the tests, the bench and the app run on Node 22.18+ and npm.

```sh
git clone https://github.com/MoLi-MoChou/moon-bot.git moon-bot
cd moon-bot

# The build tool and the types; nothing else is needed to build or test.
npm ci                                 # one root install for the three workspaces
```

There is no host to install: the tests, the bench, the app and Docker all run on
the runtime in this repository (Node 22.18+).

## Layout

| Path | What it is |
|---|---|
| `core/src/index.ts`, `core/src/host/` | The host services: Bot roster and store, tools, turns and delivery, group chats, conversation parts and the search index, memory, schedules, images, the browser bridge, the `api/bot` channel (`core/index.js` is the generated re-export) |
| `core/src/engine/` | The `AgentRuntime` seam: the built-in engine (pi kernel), the ACP adapter, the tool registry, the policy engine, the MCP connector |
| `core/src/store/`, `core/src/service/` | The SQLite store, and the Fastify service with its scheduler and wiring |
| `core/src/client/` | The browser side: sidebar, chat, panels and dialogs, themes, characters, the Bot browser panel |
| `core/client.js` | Generated from `src/client/` by `scripts/build-client.ts` at install and build time. Never committed: `.gitignore` carries it |
| `core/src/web-search/` | The `auto` web-search provider. It does not depend on the Bot team code |
| `core/test/` | Unit tests and fixtures |
| `core/dev/` | The mock model, the bench, the smoke test, the character generator, and two tools for real models: the steward evaluation and a logging pass-through |

## Test a change

Run these in `core/`:

```sh
npm run build                          # src/client → client.js
npm test                               # unit tests; they also fail if client.js is stale
node scripts/build-client.ts --check   # client.js matches src/client
npm run lint                           # oxlint
```

CI runs the same three checks on every pull request, on Linux and Windows. It also scans the tracked files for keys, tokens, personal paths and e-mail addresses, and for material that must stay local. To run the scan yourself, from the repository root:

```sh
mkdir -p /tmp/ds-bot-tree && git archive HEAD | tar -x -C /tmp/ds-bot-tree && node scripts/scan.mjs /tmp/ds-bot-tree
```

A "must fix" finding fails CI; "can stay" findings are for reading. The branch rules require the single check **Test result**, which passes only when all the checks pass.

For a change to the server side (`index.js`, `src/host/`), also run the smoke test. It starts the mock model and the service from your checkout, and walks through the main flows (Bots, group chats, conversation parts, condensing, settings). `CONTEXT_WINDOW` and `CHECK_RATIO` give the mock models a small window, so a few long replies reach the check line:

```sh
CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh smoke 3096 8796 reset && node dev/smoke.mjs smoke 3096
dev/bench.sh smoke 3096 8796 stop
```

To try the plugin by hand, start a bench and open the address that it prints:

```sh
dev/bench.sh dev 3081 8771 reset    # mock model + the service; data in ../.moon-bot-test-dev
```

The mock model answers a fixed set of commands, so a bench costs no tokens. The commands are listed at the top of `dev/mock-llm.mjs`. Bench data stays in `.moon-bot-test-<name>/` beside the checkout and never touches your own data folder.

For a change to the context steward or its prompts (`src/host/steward.js`), also check it on a real model. `dev/steward-eval.mjs` runs its decisions on fixed conversation endings, and `dev/llm-tap.mjs` logs every call a real bench makes. Both cost tokens and explain their use at the top.

For a change to the Bot browser, check it in the app (`cd app && npm start`), with the mock model answering if you want no tokens spent.

## Write a change

- Keep a change to one subject.
- Do not edit `client.js` by hand and never commit it. Change `src/client/` and run `npm run build`.
- In `src/client/`, take colors from the `--bt-*` variables, corner radii from the steps 4, 6, 8, 10, 12, 16, 18, 20, 22, 999px and 50%, and springs from `motion.js`. A unit test checks this. The places written before the test are listed in `test/style-debt.json`; that list only gets shorter. When you remove one, run `node scripts/style-debt.mjs --write` to update it.
- Follow the style of the code around your change. Write a comment only when the reason for the code is not clear from the code itself.
- Write commit messages in English. Use a short subject in the imperative mood ("Keep group replies visible") and explain the reason in the body.
- The author of a commit is the person who made the change. When an AI tool helped, do not add it as an author or with a `Co-authored-by` line; turn that setting off in the tool.
- Do not edit [CHANGELOG.md](CHANGELOG.md). Write the user-visible change in the Changelog field of the pull request instead.

## Report a problem

The easiest way is from Moon Bot itself: open **Settings → Feedback**, write what happened and select **Report on GitHub**. It opens a new issue with the Moon Bot version, your system, the models and the recent errors already filled in. **Copy** puts the same text on the clipboard, and **Download** saves the full error log (the diagnostics file in the data folder).

If you open an issue by hand, include:

- The Moon Bot version, your operating system, and whether you use the web build or the desktop app.
- How you installed DS Bot (npm, release file, Git address or command line) and its version.
- What you did, what you expected and what happened, with the exact error text.
- A screenshot of the whole window, with the chat and the error.
- The steps that make it happen again.

DS Bot removes API keys, tokens, saved secrets and your home folder from its diagnostics. Read the text before you post it, and remove personal data from screenshots.

For a security problem, do not open a public issue. Use **Report a vulnerability** on the repository's **Security** tab.

Issues are for bug reports. Questions, ideas and feature requests belong in [Discussions](https://github.com/Fei2411/DeepSeek-Bot/discussions). An idea that the maintainer accepts becomes an issue.

## License

DS Bot is licensed under the [Apache License 2.0](LICENSE). When you submit a contribution, you agree that it is licensed under the same license, as section 5 of the license says.

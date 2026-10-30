# The vision of Moon Bot

English | [中文](vision.zh.md)

This file says what Moon Bot is meant to be and why. For how to use it, see the [README](../README.md); for the designs that are decided, see [docs/plans/](plans/) (written in Chinese); for how to take part, see [CONTRIBUTING](../CONTRIBUTING.md).

## What Moon Bot is

Moon Bot is a persistent team of Bots on its own runtime, open source under the Apache 2.0 license. A **Personal Agent** layer sits on top of the team: memory that surfaces itself, work that starts on its own, connectors that reach other applications, and an autonomy policy the server enforces. The user can chat with one Bot, or work with a team with clear roles: one or more Main Bots organize the work, every Bot does its own part and talks to the others, and the user can see at any time who is doing what. Bots keep working over time and have a long-term memory.

## Two forms

| Form | What it is |
|---|---|
| The web build | The service (`packages/core/src/service`) serves the interface and the `api/bot` channel on one origin behind a password. Docker runs it as one container |
| The desktop app | Opens straight into Moon Bot. Its window loads the same service, which it starts itself; data lives in its own folder and updates replace the app in place |

Both forms are the same product: the same host services, the same engine, the same UI. The runtime is Moon Bot's own — a Fastify service, the `AgentRuntime` seam with a built-in engine (pi kernel) and an ACP adapter, SQLite for sessions, tasks and the memory index, a policy engine for autonomy, and a scheduler that survives restarts. Nothing is installed underneath it.

## Ten core requirements

1. **One runtime, independent Bots.** Every Bot runs on the same engine seam, and the Bots are independent of each other; a Bot can name an external agent (ACP) instead of the built-in engine and stays a full member of the team.
2. **Reliable.** Bots work reliably: they stay aligned with the goal, act on evidence, stay inside their task, and their results can be checked. Bots will also be able to improve themselves (planned).
3. **Memory and persistence.** Bots keep working over time, that is, they have a long-term memory. A Bot can read the other Bots' memories but not change them (only a Main Bot can change another Bot's memory). A Bot manages its own memory, and the user can manage each Bot's memory too. A group chat shares one memory.
4. **Levels of rights.** A Main Bot has the highest rights: it creates and changes other Bots. Other Bots do not have these rights, and only the user deletes a Bot. There can be more than one Main Bot. Every Bot can call on every other Bot.
5. **Group chats.** Group chats are the core form of Bots working together in DS Bot. Bots in a group call on each other, and a group can have an admin Bot. The admin manages the group, adds and removes members, and by default answers the user's messages.
6. **Working folders.** Each Bot can have its own working folder, and a group chat can set one folder for all its members. A Bot can set its own working folder, so one sentence from the user is enough.
7. **Browser.** Each Bot has its own browser, and the browsers do not affect each other. Importing cookies is planned.
8. **Interface and motion.** DS Bot has a polished interface with smooth motion.
9. **A standalone app.** Moon Bot is a standalone app with a runtime of its own; it concedes nothing to a host.
10. **Local agents.** DS Bot can bring local agent CLIs in as Bots that call on each other (planned).

## Principles for trade-offs

- **Correct Bot behavior comes first.** Where the runtime's own design does not fit Bots, Moon Bot does not pile up complexity to stay compatible. Concessions go into `docs/plans/`, to be removed by the next refactor.
- **Data stays on the user's computer.** Teams, chats and memory live in DS Bot's data folder on the user's computer.
- **Done means checked.** Behavior is covered by tests; interface changes are looked at for real.

## Who sets the direction

The maintainer decides the direction of the product, changes to decided designs, the rules for working together, releases and the architecture. Anyone can do the rest of the work; see [CONTRIBUTING](../CONTRIBUTING.md#how-we-work).

## The Personal Agent layer (2026-10)

Above the team, five capabilities make a Bot a personal agent rather than a chat partner:

1. **Persistent memory** with source, time, confidence and expiry; a wrong entry can be corrected, and the correction wins.
2. **Memory used without being asked** — the turn's own words surface what matters, in a segment that never disturbs the stable prefix.
3. **Proactive action** — schedules survive a restart and fire once; the follow-up loop verifies, then tells the user.
4. **Cross-application work** through MCP connectors, every call verified and retried once when a connection drops.
5. **Autonomy with levels** — L0 to L4, budgets and approvals enforced by the server; an unasked high-risk action is refused, and the refusal names no appeal.

The design is in [plans/2026-10-24-standalone-personal-agent.md](plans/2026-10-24-standalone-personal-agent.md). A new start does not migrate old data: the previous version keeps its own data readable.

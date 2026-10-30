# packages/core/src/host：host 服务层

host 是产品的服务端：Bot 名单、回合、群聊、记忆、定时、能力、通道。它不跑模型、不管网络传输；服务层（`service/`）装配它，引擎（`engine/`）执行回合。先读根 [`AGENTS.md`](../../../../AGENTS.md)。

## 模块职责

- `roster*.ts`：Bot、群、权限预设；`store.ts`、`store-lock.ts`、`store-sessions.ts`：`state.json` 的读、迁移与单写者锁。
- `turns.ts` + `turns/{delivery,route,failure}.ts`：谁在跑、在做什么、回合结束把回答投给谁；`handoffs.ts`：Bot 之间的派活、等待与结果回收。
- `groups.ts` + `groups/{log,rounds,notice,types}.ts`：群聊日志、轮次、@ 提及与发言顺序。
- `parts*.ts`：对话分段、交接包、上下文压缩/换段；`memory/`：记忆的 Markdown 源与 SQLite 索引。
- `schedules.ts`、`capabilities*.ts`、`secrets/`、`files.ts`、`images.ts`、`deliverables.ts`、`usage/`、`tasks-panel.ts`、`browser.ts`、`connectors.ts`、`feed.ts`（SSE）、`channel/`（`api/bot` 的 RPC 路由与 handlers）。
- 每个模块 `install(rt)`：注册事件监听、工具、路由和 effect，并把其他模块要调用的函数挂到 `rt` 上；install 顺序在 [`../index.ts`](../index.ts) 里。子目录（`groups/`、`turns/`、`channel/`、`memory/`、`secrets/`、`tools/`）内部可以直接 import；新加的跨模块能力挂到 `rt` 上，不要在运行时去 import 别人的内部实现。

## 持久化边界

- 回合消息只有一个写路径：[`store/sessions.ts`](../store/sessions.ts) 的 `appendMessage`（引擎的 transcript 调它，按会话 seq 连续追加）。host 不直接 `INSERT` messages，也不另存一份对话。
- `state.json` 存团队状态（`bots`、`rooms`、`agents`、`exchanges`、`works`、`questions`、`views`、`prefs`、`capabilities` 等）：每次保存整份重写，靠 [`store-lock.ts`](store-lock.ts) + `state.lock` 保证一个 home 只有一个写者，第二个 host 只读。
- SQLite 存 `state.json` 服务不了的东西：transcript、任务队列、记忆索引、策略计数、远程邀请、交付物（[`store/db.ts`](../store/db.ts)）。
- 长文本在 `state.json` 里只留开头（`TEXT_KEPT`），全文落文件；不要把整段聊天塞回 JSON（[长消息设计](../../../../docs/plans/2026-10-16-long-messages.md)）。

## 迁移不变量

- [`store/schema.ts`](../store/schema.ts) 的 `MIGRATIONS` 只追加：已合并的迁移永不改动，下次变更在末尾加一条，`user_version` 前进。
- 已有数据不可丢：旧格式字段在 [`store.ts`](store.ts) 的 `adopt()` 里迁移（如 `mainBotId` → `mainBotIds`、`lab` → `model`）；只有确认损坏的值才回退默认。`state.json` 写失败要保留原文件（[`../../test/store.test.ts`](../../test/store.test.ts) 已锁）。
- 新库与升级库必须一致（parity）：`openStore` 对空库和旧库重放同一串迁移。加迁移时在 [`../../test/sqlite-store.test.ts`](../../test/sqlite-store.test.ts) 补一条「旧版本库打开后与新建库一致」的断言；目前没有自动 parity 门禁，靠评审和这条约定。
- 迁移只在打开时、事务里跑；不要在请求路径里临时 `ALTER`。

## 事件与接缝

- host 永不 import `client`（[`check-gates.mjs`](../../scripts/check-gates.mjs) 会拒绝）；模块之间用 `ctx.on`/`ctx.emit` 事件和 `rt` 上的函数协作。
- host 不 import kernel/ACP 实现（`engine/builtin/`、`engine/acp/`、`@earendil-works/pi-*`），只 import [`engine/registry.ts`](../engine/registry.ts) 的工具契约和 `engine/connectors/mcp.ts` 的连接器注册。回合的执行在 `AgentRuntime` 接缝（[`engine/runtime.ts`](../engine/runtime.ts)）后面，由 [`../service/engine.ts`](../service/engine.ts) 装配；host 通过 `ctx` 注入的 agent/session 面使用它。跨层需求先改接口，不要在 host 里 new 一个引擎。
- 回合事件是事实来源：引擎事件经 `turns/route.ts` 进投递与状态；host 不为界面另存进度（任务面板读的就是 turns/handoffs 的实时记录）。

## 数据与路径

- 团队 home 里有 `state.json`、`store.sqlite3`、`settings.json`、`credentials.json`、`secrets.json`，以及 `logs`、`attachments` 两个目录。host 只写 home 内的路径；工作区路径由 `folders.ts` 校验，不要绕开它自己拼。
- 测试用临时目录，跑完删除；绝不指向真实数据目录（根硬规则 5）。错误和日志里不带密钥和 home 绝对路径（由 `diagnostics.ts` 清理）。

## 门禁

- `check-gates.mjs`：host 不得 import client；单文件 ≤ 350 行；测试不得 import `.tsx`；promise 不得悬空。
- `pnpm run typecheck` 覆盖本目录；host 测试用 [`../../test/fake-ctx.ts`](../../test/fake-ctx.ts) 的假上下文，不要为了一个测试起真服务。
- 改持久化或迁移的 PR 必须在同一 PR 里更新相应测试；测试红灯不许靠删断言过去。

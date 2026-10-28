# 从 OpenBot 借鉴什么、按什么顺序做

- 日期：2026-10-28
- 材料：[运行时对比](../research/openbot-runtime.md)、[产品对比](../research/openbot-product.md)、[工程对比](../research/openbot-engineering.md)
- 许可边界：OpenBot 是 PolyForm Noncommercial 1.0.0，与本仓库的 Apache-2.0 不兼容。我们只借鉴**行为、交互、机制与结构**，全部用自己的实现与措辞重写；引用它的文件路径与字段名可以，代码、注释、文档文字一律不搬。

## 三条原则（先定下来，避免执行时走偏）

1. **把「问」变便宜，而不是变少。** 它的顺畅来自 Full access 授权；我们的红线是不做默认放行、不做等价物。能学的是「一次问清」：卡片给到可核对的命令与作用域、答案可追溯、问的时候不阻塞其他 Bot。
2. **引擎差异只能让我们更保守。** 能力描述符（并发、压缩模式、沙箱强度、是否报用量）只允许 host 少做，不允许成为「这个引擎不支持审批所以别问了」的理由。
3. **能用门禁表达的规矩就做成门禁。** 对比里最有价值的一类不是功能，而是「对方把规矩机械化」：基线棘轮、i18n 跨树、测试禁 sleep、文档链接。我们已有 `check-gates.mjs`、`style-debt`、`scan.mjs`，把同类机制抽成公共件比逐条加规则划算。

## 优先级

量：S ≤ 半天、M 1–2 天、L 3 天以上。每项的来源编号指向对应研究文档的「可借鉴清单」。

### P0（先做，多数是补洞）

| # | 事项 | 来源 | 落点 | 量 | 验收 |
|---|---|---|---|---|---|
| 1 | i18n 门禁补盲（已完成） | 工程 13 | `core/test/i18n.test.ts`、`zh.ts`、`test/fixtures/i18n/` | S | 递归扫 `core/src` + `app/ui/src`；无引号键进死词条检查；补 16 条文案；夹具证明嵌套文件会红 |
| 2 | 缺件即拒绝（fail-closed） | 运行时 2 | `host/folders.ts`、`host/permissions.ts`、`service/engine.ts` | S | 无 `sandboxPolicy` 时越界目录**被拒**而不是放过；`permissionPresets` 缺失时 `setPermission` 报可读错误、界面隐藏入口；同 PR 附「独立装配下的缺省审批语义」设计说明 |
| 3 | 回滚要回到能跑的状态 | 工程 §5.3 | `deploy/update.sh`、`deploy/rollback.sh`、`test.yml` 演练 job | M | 升级前数据快照；不健康时按 SQLite `user_version` 判定：数据已被新版本迁移则**不回滚镜像**、报出快照路径；`--restore` 可恢复；演练 job 去掉守卫必须变红 |
| 4 | 任务行说清「为什么在等」 | 产品 1 / 运行时 3 | `host/tasks-panel.ts`、`shared/rpc.ts`、`client/tasks-page.tsx` | S | 每行带 `hold`（等审批/等额度/引擎忙/等别的 Bot/排队中），只从已有事实推算；面板加状态和 Bot 筛选 |

### P1（体验与债务）

| # | 事项 | 来源 | 落点 | 量 | 验收 |
|---|---|---|---|---|---|
| 5 | 真 inbox（队列唯一可读来源） | 运行时 1 | `engine/builtin/bridge.ts`、`tasks-panel.ts`、`resume.ts`、`tools/shared.ts`、`groups.ts` | S | `waiting[]` 成为唯一真相，`inbox.nextTurn` 是只读视图且 `remove` 真删；`pendingTurns()` 与其数量一致；三处既有读点第一次能看到排队输入 |
| 6 | 排队交互 v1（列出 + 撤销） | 产品 2 | `host/turns/*`、`shared/rpc.ts`、`client` 等待块 | M | 能看见是哪几条、按 id 撤销；已开始的返回 `cancelled:false` 并如实说明；编辑/重排留给下一版 |
| 7 | 公共棘轮 + 两条新门禁 | 工程 10/11/12 | `core/scripts/ratchet.mjs`、`check-gates.mjs`、`test/fixtures/gates/{jsx,sleep}/` | S–M | `--write` 只降不升；静态 `h(Comp)` 存量上基线；测试里等时钟的写法在 lint 阶段报出文件行；两者都有会红的夹具 |
| 8 | 上下文可观测 + 手动压缩 | 运行时 8/9 | `host/channel/ops-team.ts`、`host/parts.ts`、`shared/rpc.ts`、`client/model-context.tsx` | M | 无 `sessionProjections` 时 `run-stats` 仍有数字；手动压缩只在无运行回合、无未读投递时接受；拒绝原因要说清 |
| 9 | 文档链接检查 | 工程 14 | 新增 `scripts/check-docs.mjs`、`test.yml` job | S | 相对 md 链接与锚点可解析；失败给出文件与目标；允许清单写理由 |

### P2（结构性，需要设计文档）

| # | 事项 | 来源 | 量 | 说明 |
|---|---|---|---|---|
| 10 | 投递/回合表 + 状态机，崩溃恢复三分法（先结清、再对账、后补历史） | 运行时 4/10/11 | M | 队列、恢复、审批重放共用一份可查询事实；「自动重跑」收窄为「结清 + 告知发送方 + 继续按钮」 |
| 11 | 引擎能力描述符 + 健康状态 + doctor | 运行时 7/12/13 | S–M | 描述符只许更保守；`doctor` 走「可执行 → 版本 → 握手 → 一次最小回合」，不发 prompt、不落凭据 |
| 12 | 错误码补 `QUOTA`/`OVERLOADED`，stderr 噪声分层 | 运行时 14/15 | S | 区分「可重试」与「要用户处理」；无害 stderr 只进日志 |
| 13 | 群聊归档与恢复 | 产品 3 | M | `archivedAt` 一个字段；归档 ≠ 删除；旧 `state.json` 视为未归档 |
| 14 | `test:related` | 工程 17 | M | 只用于迭代提速；完成定义仍是全量三件套 |

## 明确不做（详见各研究文档的「不要借鉴」）

- 不做 Full access 式自动批准、不做「agent 申请放宽文件/网络」的自动批、不代答审批（运行时 §四 1/2/5）。
- 不把 provider 原生会话当上下文事实源（会废掉 `read_own_chat` 与 parts 交接）。
- 不在 host 里写 `if provider === ...` 特例；差异进描述符与适配层。
- 不照搬它的 Effect/Bun/Cloudflare 运行时栈、`tool_search` 三件套、以 E2E 取代单测的测试策略。
- 阶段内不做多租户托管、macOS 签名与公证（先把单机自托管做扎实）。

## 排期建议

先 `P0 2 → 3 → 4`（都是洞），再 `P1 5 → 6 → 7 → 8`，P2 每项单独立设计文档。P0 的第 1 项已完成，见 commit `90d6fcb`。

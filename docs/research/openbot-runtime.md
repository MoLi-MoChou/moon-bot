# OpenBot 运行时与模型/引擎层对比研究

- 日期：2026-10-28
- 方向：运行时 / 模型与引擎层
- 对照对象：OpenBot 浅克隆，只读，位于 `/tmp/openbot`（PolyForm Noncommercial 1.0.0）
- 我方基线：`moon-bot` 分支 `dev`，工作树干净
- 本文性质：研究笔记，不是已定设计；落地任何一条都要先走 `docs/plans/`

## 阅读约定

本文只引用 OpenBot 的文件路径、模块名、类型名、字段名与设计结论，**不复制其代码、注释、文档文字或示例**；所有表述按我方需要重写。左列路径相对 `/tmp/openbot`，右列相对本仓库根。凡只从其 `docs/architecture/` 读到、没有逐行核对实现的结论，标「（据文档）」。

核实路径：先读 `/tmp/openbot/AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/architecture/{structure,agents,providers,change-rules}.md`，再用 `grep` 定位实现（`src/backend/agent/*`、`src/backend/process-confinement.ts`、`src/backend/mailbox-store.ts`、`packages/contracts/src/{ipc-queue,ipc-agent-status}.ts`）；我方读根 `AGENTS.md`、`core/src/host/AGENTS.md`、`core/src/service/AGENTS.md`、两份 plan，以及 `core/src/engine/**`、`core/src/host/turns*`、`core/src/host/{approvals,resume,parts,folders,permissions}.ts`。

## 一、摘要

1. **接缝形状不同，差距不在实现数量。** OpenBot 是「一个 provider 边界 + 每家一份 driver + 一份 descriptor」，我们是「一个 `AgentRuntime` + 内置/ACP 两实现」。我们不需要第三、第四个实现，缺的是把每引擎的差异写成契约（并发、压缩、沙箱、用量上报），否则 host 只能凭 `kind` 猜，"降级矩阵"停在文档里而不是代码里。

2. **会话的两条路线都成立，我们的空档在"回合级状态"。** 它把上下文托给 provider 原生会话、用预算化的交接包补位；我们把自己的 transcript 当唯一事实源、用 parts 交接。后者更适合「运行时是我们自己的」，但我们的回合与投递只有内存 Map 与 `inflight.json`，所以队列、恢复、审批重放三件事都上不去。

3. **上下文压缩我们并不落后。** 它有 0.8 阈值、把压缩当成一次真回合、超时与占 lane；我们有 steward 裁决的 checkpoint/switch、8k 笔记 + 16k 近期原文、溢出即换段、`read_own_chat` 全段检索。差的是可观测（`run-stats` 在独立装配里恒为 null）与手动入口。

4. **队列是最大的一块空白。** 它有 mailbox 表 + 投递 7 态 + hold 理由 + 编辑/重排/steer + 槽位公平；我们只有 `bridge.ts` 的 `waiting[]` 与 `pendingTurns()`，而且 `inbox` 是空 stub —— `tasks-panel.ts` 自己写下了"三处读点永远看不到排队输入"。

5. **审批的体验差距来自放权，不能照搬；但我们有两个真实的洞要补。** `permissions.ts` 依赖的 `permissionPresets`、`folders.ts` 依赖的 `sandboxPolicy` 在独立装配里都没有提供者：前者让权限预设恒为 null、"Always allow" 没有落点，后者让"工作目录越界要审批"整段被跳过（缺失即 `return`，等于放过）。

6. **健康自愈整段缺失。** 它有 7 态 provider 状态、版本与二进制来源、lastError、失败映射、备用模型 failover、额度 hold；我们只有 discovery 的 `which`/`--version` 与一张错误码表。客户端仍注册着 `model-retry` 节点的渲染器（`core/src/client/index.ts`），但独立运行时里没有事件来源。

## 二、分主题对比

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 引擎接缝与多 provider 抽象 | `AgentClient` 是唯一 provider 边界（`src/backend/agent-client.ts`）；每家 CLI 一个 driver，差异写在 driver 的 `catalog` 规则里（`src/backend/provider-drivers.ts`）；ACP 家族共享 `acp-client.ts`；目录统一走 `model/list`（`src/backend/agent/model-catalog.ts`） | `AgentRuntime` 五个成员：`start`/`stop`/`runTurn`/`steer`/`cancelTurn`（`core/src/engine/runtime.ts`）；实现是 `engine/builtin/runtime.ts` 与 `engine/acp/runtime.ts`；ACP 的线协议经 `engine/acp/transport.ts` 抽象，stdio 与 relay 两实现 | 我们的接缝更窄也更干净；但没有把"引擎之间的不同"变成可读契约，差异藏在实现内部 |
| 每引擎能力契约 | descriptor 携带 `concurrentTurns`、`workspaceEnforcement`、`contextCompaction`（`events`/`request`/`handoff`/native）、`reportsUsage`；`drain-scheduler.ts`、`context-compaction.ts` 按这些值分支（据文档） | 无。`EngineInfo` 只暴露 `id`/`label`/`kind`（`core/src/engine/runtime.ts`） | 同一套 host 逻辑无法按引擎退让：并发、压缩、用量、沙箱能力全靠口头约定 |
| 会话身份与绑定 | 公开 thread 与 provider session 分离，绑定落 `projection_provider_sessions`；chat、每个 task、每个 channel 各有一条（`src/backend/agent/thread-lifecycle.ts`、`src/backend/database/provider-sessions.ts`） | `sessions` 表一行 = 一个会话，`messages` 按 `seq` 追加（`core/src/store/schema.ts`、`core/src/store/sessions.ts`）；旧段记在 `state.json` 的 segments（`core/src/host/parts*.ts`） | 我们没有"会话 ↔ 引擎侧身份"的持久绑定：ACP 的 `acpId` 只在内存（`engine/acp/runtime.ts`），进程一换就清空，下一回合重开 |
| 回合生命周期与持久化 | `turn-lifecycle.ts` 吃 provider 通知，写 conversation 并结算 delivery；投递状态是七态枚举（`packages/contracts/src/ipc-queue.ts`），落库由 `mailbox-store.ts` 负责 | 回合跑在 `engine/builtin/runtime.ts`，事件经 `host/turns/route.ts` 路由；消息只落 `messages`；没有回合/投递表，只有 `tasks`（定时）与 `inflight.json`（`host/resume.ts`） | 回合状态是内存 Map（`host/turns/delivery.ts` 的 `live`），重启即失；没有可查询的"谁在等谁" |
| 上下文压缩：触发与执行 | `context-compaction.ts`：0.8 阈值，压缩是真实 provider 回合，占自己 thread 的 lane，启动超时 120s、运行 10 倍，另一处 `handoff` 模式走会话轮换 | `host/parts.ts` + `host/steward.ts`：`linesFor` 给出 usable/hard(0.95)/check(0.8)，回合结束后由 steward 小模型裁决 switch 或 compact；`parts-switch.ts` 的 `OVERFLOW` 立即换段；交接包 = 8k 笔记 + 16k 近期原文 + 4k 列表（`parts-handoff.ts`） | 触发线相当，交接也不弱；缺"压缩占不占队列、谁等它、等多久"的语义，以及手动入口 |
| 上下文可观测 | `contextStates` / `threadContextStates` 快照（用量、阶段、进度、分类明细），另有手动压缩入口与明确的拒绝条件（据文档；实现在 `runtime-snapshot.ts`、`context-compaction.ts`） | 客户端有 `ContextGauge`（`core/src/client/model-context.tsx`），数据来自 `run-stats`（`host/channel/ops-team.ts`）→ `sessionProjections`；独立装配没有提供该服务，`run-stats` 直接返回 null | 有 UI 无数据源；无手动压缩；无压缩进度 |
| 队列：投递状态机 | `mailbox-store.ts` 一张表管投递，字段含状态、`position`、`hold`、`expectsReply`、`editing`、`steerFallback`（`packages/contracts/src/ipc-queue.ts`）；`drain-scheduler.ts` 负责排空 | `engine/builtin/bridge.ts` 的 `waiting[]` + `pendingTurns()`；`cancel` 直接清空；`host/resume.ts` 另记一份待办 | 无状态、无顺序号、无等待原因，外部不可查；两份真相（内存 + `inflight.json`） |
| 队列：交互与 steering | `queue-controls.ts` 提供取消/编辑/重排/steer；steer 不被支持时回落队列并标 `steerFallback`；`BUSY_MESSAGE_MODES` 两个模式 | `bridge.ts` 的 `steer` 只在运行中生效，空闲即开新回合；已排队的消息无法改写、重排、拉进当前回合 | 用户对"排队中的那句话"没有任何控制权 |
| 并发与公平调度 | 每 agent 的 chat lane + 每 task 一条 lane，`agentTaskLimit`（默认 2，`concurrentTurns:false` 的 provider 为 1，据文档）；服务器级 `TurnSlots` 按"人 > 定时/同伴 > 最旧"发槽（`turn-slots.ts`） | 每 session 串行（`builtin/runtime.ts` 的 `queue`）；群聊另有轮次预算（`host/groups/rounds.ts` 的 `ROOM_TURNS_EACH`）；没有全局并发上限，也没有优先级 | 多 Bot 同时开跑时没有"谁先"的规则；一个 Bot 的多个会话互不感知 |
| 崩溃恢复 | `boot-recovery.ts` 三段：先清陈旧回合/过期请求/流式中断消息 → 再对账未结算投递（问 provider，有疑问就保留 `interrupted`，不重放不确定的副作用）→ 最后回灌 provider 侧历史 | `host/resume.ts`：`inflight.json` 记运行中回合与"已投递但没被回合接走"的消息，启动 3s 后重放，用 `taken` 集合与 inbox 比对去重；回合以 `resumeText` 重跑一次，第二次不再跑 | 我们"重跑"多于"结清"；没有对账手段；重复副作用靠提示词让模型自检 |
| 审批：分级与体验 | 三档权限（Workspace only / Ask first / Full access），授权存 `openbot-approval-automation-v3.json`，`approval-automation.ts` 的 `autoApproves` 决定"不用问"；`attention-registry.ts` 有 `alwaysAsk`、`ownerOnly`、`ApprovalResponder.owner`，也有"授权提升后结清在等请求"（权限档位与存储文件名据文档） | `engine/policy.ts` 的 L0–L4 + 每会话每日预算（L3 20 / L4 5）+ 未知工具归 L3；`host/approvals.ts` 卡片（`allowed-once` / `rejected`）；`service/approval.ts` 桥；ACP `session/request_permission` 映射（`engine/acp/permission.ts`） | 我们的分级是"按工具定级 + 预算"，比它细；它的"一揽子授权"是红线外。真实差距：`permissions.ts` 读的 `permissionPresets` 没有提供者 → `state.permissions` 恒为 null、`setPermission` 直接抛错，"Always allow for this Bot"（`client/approval-always.ts`）没有落点 |
| 工具执行 | `tool-catalog.ts` + `tool-operation.ts` + `openbot-tool-router.ts`；发现三件套（`tool_search`/`tool_describe`/`tool_call`）；`tool-call-idempotency.ts` | `engine/registry.ts`（Zod 为校验真值）+ `engine/builtin/adapter.ts` 的 `beforeToolCall` 过 `ToolGate`；MCP 连接器以 `mcp__<server>__<tool>` 入表，默认 L3（`engine/connectors/mcp.ts`） | 无幂等键；工具失败即失败，没有"这次失败可重试"的语义 |
| 沙箱与路径边界 | `workspace-sandbox.ts`（`workspaceWrite` 根 + 临时目录）、`process-confinement.ts`（macOS 用 seatbelt；Linux 因 bubblewrap 拒绝不了"尚不存在"的受保护文件而 fail closed）、`PROJECT_SETTINGS` 保护清单 | `host/folders.ts` 的 `within()`/`cleanWorkDir`/`teamFolder`；`approveFolder` 依赖 `sandboxPolicy`，独立装配没提供者 → 越界目录审批被整段跳过；没有进程级隔离 | 我们只有"算路径"，没有"执行边界"：越界写入没有任何拦截 |
| 引擎健康与降级 | 七态 + `version` + `cliSource` + `lastError`/`lastErrorAt` + `restartPending`（`packages/contracts/src/ipc-agent-status.ts`）；版本检查与受管安装（`provider-runtime-releases.ts`，据文档）；失败映射 `provider-status.ts`；备用模型 failover（`turn-lifecycle.ts` 的 `FAILOVER_CAUSES`、`usage-limit-gate.ts`） | `engine/acp/discovery.ts`（`which` + `--version`，2–3s 超时，`unsupported` 带原因）；失败码表 `engine/failure.ts`；无状态、无重启、无备用模型；`client/index.ts` 仍注册 `model-retry` 节点渲染器，但没有事件来源 | 从"能发现"到"能解释、能自愈"之间整段缺失 |
| 错误分类与噪声治理 | 六因分类（billing / provider_unavailable / rate_limit / authentication / network / timeout）；`provider-diagnostics.ts` 把 MCP、遥测导出、ACP SDK 的 echo、凭据回退等 stderr 降级为日志；`redactText` | `engine/failure.ts` 的 `CODES`（AUTH / RATE_LIMIT / TIMEOUT / CONTEXT_WINDOW_EXCEEDED / SERVER / INVALID_REQUEST / TRANSPORT / UNKNOWN）+ `maskSecrets`；`host/turns/failure.ts` 双语文案；`host/diagnostics.ts` 的 `cleanText` | 缺"额度/欠费"与"过载"两档；缺"引擎 stderr 噪声不上浮为用户错误"的过滤层 |
| 多 agent 编排 | 邮箱 + `expectsReply` + 派活回执；`interrupt_agent`；`list_agents` 带 status/queuedMessages；routine flows 与 workflows 两张图（含 approval 节点）；侧线程 `start_task`（8 开 / 50 总）；subagent 汇总（据文档） | `host/handoffs.ts` 的 works 树（parent/child、results 汇总、全部回齐才答）；`message_bot`/`stop_bot`/`group_relay`；`host/groups/rounds.ts` 的发言顺序与 @ 接力；Main Bot 权限 | 我们的派活是树、群聊是轮次，比"平铺邮箱"更有结构；它强在图编排、并行侧线程，以及"中断的作用域" |

几处值得点名的观察：

- 它的 `approvalPolicy` 在 `thread-lifecycle.ts`、`drain-scheduler.ts` 里固定传 `on-request`，`never` 只出现在画像生成（`profile-generation.ts`）。`docs/architecture/structure.md` 给了原因：`never` 会拒绝需要同意的 MCP 工具调用并拒绝 elicitation。也就是说 **`never` 不是"全放行"，而是"不再问，于是被门挡住"**；真正换来流畅的是另一根杠杆 —— Full access 授权。我们反对的是后者，不是把前者当假想敌。
- 它的"授权"边界做得很清楚：只属于跑 agent 的那台机器、不过 Team API、远端成员不能代批。这一点值得学的是**边界的写法**，不是授权的松紧。
- 我们对 `run-stats` 的依赖是 DSH 时代的接线：`ctx.get('sessionProjections')` 没有提供者就返回 null（`host/channel/ops-team.ts`）；同类还有 `permissionPresets`、`sandboxPolicy`、`directoryPicker`、`compaction`。独立装配只 `provide` 了 `relayRegistry` 与 `schedule`（`core/src/service/engine.ts`）。

## 三、可借鉴清单

量：S ≤ 1 人日，M 2–4 人日，L > 4 人日。依赖写编号，表示必须先有它。

| # | 想法（一句话） | 为什么值得 | 落点 | 量 | 依赖 | 风险 / 与红线的关系 |
|---|---|---|---|---|---|---|
| 1 | 把 `bridge.ts` 的空 `inbox` 换成可读的待办队列 | 一处改动解锁三处读点：重复请求检查、关停取消、群 relay；`pendingTurns()` 与 inbox 不再各说各话 | `core/src/engine/builtin/bridge.ts`、`core/src/host/tasks-panel.ts`、`core/src/host/resume.ts`、`core/src/host/tools/shared.ts`、`core/src/host/groups.ts` | S | — | 低。纯队列形状，不碰审批与权限 |
| 2 | 服务缺失时"拒绝"而不是"放过"，并把降级显式化 | `approveFolder` 在 `sandboxPolicy` 缺失时直接 `return`；`permissions.ts` 在 `permissionPresets` 缺失时抛错或给 null —— 两处都是"缺件即放松" | `core/src/host/folders.ts`、`core/src/host/permissions.ts`、`core/src/service/engine.ts` | S | — | 收紧审批行为，须同 PR 附设计说明并请维护者确认（AGENTS：改审批行为走设计文档） |
| 3 | 队列项带"为什么在等" | 现在只有"在跑/没在跑"；用户看不出是在等额度、等槽位还是等审批 | `core/src/host/tasks-panel.ts`、`core/src/shared/rpc.ts`、`core/src/engine/builtin/bridge.ts` | S | 1 | 低。只增只读字段 |
| 4 | 投递/回合表 + 状态机（queued→starting→running→…） | 队列、恢复、面板、审批重放都需要同一个可查询的事实；现在每次重启靠 `inflight.json` 猜 | `core/src/store/schema.ts`（追加迁移）、`core/src/store/sessions.ts`、`core/src/host/turns/delivery.ts` | M | 1 | 迁移只追加、只能有一个写路径；不能让这张表变成第二份对话 |
| 5 | 排队交互：取消已有、编辑、重排、把排队消息 steer 进当前回合 | 用户现在只能"发出去等"，说错一句就得等整轮跑完 | `core/src/host/turns/*`、`core/src/shared/rpc.ts`、`core/src/client` 的等待块 | M | 4 | 编辑只改文本，不改来源与风险等级；不能借编辑绕过审批 |
| 6 | 每会话 lane + 全局槽位，优先级"人 > 定时 > Bot > 最旧" | 多 Bot 同跑时现在没有规则，谁先到谁先占 | `core/src/engine/builtin/runtime.ts` 或新 `core/src/host/slots.ts`、`core/src/host/groups/rounds.ts` | M | 4 | 默认不设上限，只在显式配置后生效；否则改变"多 Bot 并行"的既有观感 |
| 7 | 引擎能力描述符（并发、压缩模式、沙箱强度、是否报用量） | 让 host 按引擎退让，而不是靠 `kind === 'acp'` 猜；也是"降级矩阵"落到代码的唯一办法 | `core/src/engine/runtime.ts`（`EngineCapabilities`）、`engine/acp/discovery.ts`、`core/src/service/engine.ts` | S–M | — | 低。描述符只描述，不得成为"自动放行"或"自动降级预算"的依据 |
| 8 | 上下文使用量的真生产者 | `ContextGauge` 已存在但没数据；`parts.ts` 已有估算，差一步外露 | `core/src/host/channel/ops-team.ts`（`run-stats`）、`core/src/host/parts.ts`、`core/src/host/usage/*` | S | —（窗口来自 ModelSource，可与 7 并行） | 只做本地显示，不进 `state.json`、不过 relay |
| 9 | 手动"现在压缩" + 压缩期的显式拒绝与 hold | 用户能自救，也能看懂为什么按钮是灰的；对应它的手动压缩与拒绝条件 | `core/src/host/parts.ts`、`core/src/host/parts-switch.ts`、`core/src/shared/rpc.ts` | M | 7、8 | 换段会中断回合，拒绝条件要写死并测到 |
| 10 | 恢复三分法：先结清、再对账、后补历史 | 现在启动即重放，重放与"到底发生了什么"无关；对账能把"重跑"降为少数情况 | `core/src/host/resume.ts` | M | 4 | 改变现有"重启后自动续跑"的体验，须设计文档 |
| 11 | 把自动重跑收窄为"结清 + 告知发送方 + 给一个继续按钮" | 重跑可能重复副作用；告知发送方比静默更诚实 | `core/src/host/resume.ts`、`core/src/host/turns/route.ts` | S | 10 | 用户会失去"自动继续"；换来可审计。与我们"结果可被检查"的定位一致 |
| 12 | 引擎健康状态枚举（可用/未安装/版本过低/待登录/错误 + 版本 + 来源） | discovery 已经知道路径与版本，只是没把它变成可展示、可判断的状态 | `core/src/engine/acp/discovery.ts`、`core/src/shared/rpc.ts`、设置页与 `client/bot-settings.tsx` | S–M | 7 | 低。状态只读 |
| 13 | doctor：一条命令走完"可执行 → 版本 → 握手 → 一次最小回合" | 现在排障靠看日志；握手失败与模型失败混在一起 | `core/src/engine/acp/*`、`core/dev/` 或 `scripts/` | M | 12 | 探测会起子进程：只做 `initialize`/`session/new`，不发 prompt，不落凭据 |
| 14 | 错误码补 `QUOTA`、`OVERLOADED`，并把"可重试"与"要用户处理"分开 | 现在 AUTH/RATE_LIMIT/SERVER 混在一张表里，UI 只能给一句人话 | `core/src/engine/failure.ts`、`host/turns/failure.ts`、`client/diagnostics.ts` | S | — | 文案改动要同步 `zh.ts` 的 key 测试 |
| 15 | 引擎 stderr 的噪声分类（MCP 子进程、遥测导出、SDK echo 只进日志） | 否则一条无害的 stderr 会变成用户看到的"模型出错" | `core/src/engine/acp/runtime.ts` 或新 `engine/acp/diagnostics.ts`、`host/diagnostics.ts` | S | 14 | 只降级"确认无害"的行；带 OpenBot/Moon Bot 字样的一律保留 |
| 16 | 备用模型（用户显式配置的顺序，失败后切换） | 一次额度或一次 5xx 不该让整轮白跑 | `core/src/host/models.ts`、`core/src/service/llm.ts`、`host/turns/route.ts`、bot 字段 | M | 12、14 | 换模型不换权限：预算仍按会话算，切换不得成为"绕过审批"的通道 |
| 17 | 审批卡带作用域与"谁在答"，并记录答案归属 | 我们的卡片只有 `text`/`code`；群聊与远程接入后会分不清是谁批的 | `core/src/host/approvals.ts`、`core/src/service/approval.ts`、`engine/policy.ts`、`shared/rpc.ts` | M | 4 | 必须走设计文档；只改善可核对与可追溯，不引入"永不再问" |

建议施工顺序：`1 → 2 → 3 → 4 → {5, 6, 10} → 7 → {8, 9, 12, 17} → 13 / 14 / 15 / 16`。第 2 条与第 17 条动的是审批面，先写设计说明；其余三条线（队列、上下文、健康）可以并行。

三条与红线直接相关的读法：

- 第 2 条是**收**，不是放：缺件时拒绝，属于把红线补严，但仍算改审批行为，要走设计文档。
- 第 7 条容易被误用成"这个引擎不支持审批，所以就别问了"。描述符只能让 host **更保守**（例如不支持工具门的引擎，其 Bot 不该拿到 L3 以上的能力），不能反过来放松。
- 第 16 条与第 17 条都不得引入"因为失败/因为已授权，所以不必再问"。换模型换的是算力，不是权限；审批记录变清楚，问的次数不变。

## 四、明确不要借鉴

1. **用 Full access 授权（`autoApprove`）换流畅。** 这是它体验的主要来源，也是我们红线写死不做的东西：默认自动允许、静默放行、不经用户替 Bot 提权。红线内的替代是把"问"变便宜 —— 卡片给到可核对的命令与作用域、一次一答、审批不阻塞其他 Bot 的回合 —— 而不是少问。
2. **把"agent 申请放宽文件系统或网络"也纳入自动批的范围。** 它的 `approval-automation.ts` 把这档也并进了授权，理由大意是：把这档扣住，会让每个 agent 都留一张用户关不掉的卡。对我们不成立 —— 这类请求本身就是提权，必须每次问。
3. **把 provider 原生会话当成上下文事实源。** 它的会话轮换、历史回灌、`history_search`/`history_read` 都是围绕"provider 持有上下文"建的。我们一旦照搬，`read_own_chat` 的跨段检索、parts 的交接与记忆冻结都会失效，而且两个引擎会各有一套上下文语义 —— 与"接缝中立"冲突。
4. **每 provider 的特例分支。** `CODEX_MCP_ADAPTER_VERSION` 那样的版本号、OpenCode 那几个协议补丁，是长期兼容压出来的产物。我们要的是 descriptor + 适配层内的集中差异，不能在 host 里写 `if provider === ...`。
5. **超时后由宿主"替用户答"的请求。** 它的 `AUTOMATIC_RESPONDER` 用于"没人及时回答的界面块"，属于代答。我们的规则是：问到的请求必须由用户答，答不了就过期作废，不代答、不默认。
6. **工具发现三件套（`tool_search`/`tool_describe`/`tool_call`）。** 它需要它，是因为十来个内置工具之外还有每家 MCP 服务器撑大的目录。我们是 ~26 个团队工具加 MCP，目录还看得过来；先加一层发现只会多一次模型步进。
7. **Effect/Bun 的运行时栈、Cloudflare/D1 的主机模型、agent import 与 instance transfer 的 wire 格式。** 依赖与许可证都不兼容（其源码是 PolyForm Noncommercial），产品面也不同；这类"整体架构"只能读思路，不能搬。
8. **以 E2E 取代单元测试的测试策略。** 它把单测限制在迁移、信任边界、脱敏等少数区域；我们的门禁是 `npm test` + `npm run typecheck` + `npm run lint`，照搬会直接违反本仓规则。

## 五、建议的前 3 个动作

### 动作 1：队列可读化（真 inbox + 等待原因）

- 目标：让"排队中的输入"在 host 里只有一个可读来源，且行为不变。
- 文件：`core/src/engine/builtin/bridge.ts`（把 `waiting[]` 暴露成 `SessionInbox` 形状，`remove` 真能删）、`core/src/host/tasks-panel.ts`（`queuedOf` 优先读 inbox）、`core/src/host/resume.ts`（去重改为读 inbox，不再只读 `inflight.json`）、`core/src/host/tools/shared.ts` 与 `core/src/host/groups.ts`（两处读点顺带生效）。
- 步骤：① 在 bridge 内保留 `waiting[]` 作为唯一真相，`inbox.nextTurn` 返回它的只读视图；② `steer` 仍先进运行中的回合，失败才入队（保持现有回落语义）；③ `cancel` 同时清 inbox 与 `waiting[]`；④ `tasks-panel` 的 `queuedOf` 去掉对 `pendingTurns` 的分支，直接读 inbox。
- 验收：`core/test/engine-bridge-queue.test.ts` 现有断言不改仍绿；新增一条"入队后 `inbox.nextTurn` 与 `pendingTurns()` 数量一致"；新增一条"`tools/shared` 的重复请求检查能看见排队中的同源请求"；`core/test/tasks-panel.test.ts` 的 fake agent 用真 inbox 后仍绿；`npm test`、`typecheck`、`lint` 全绿。
- 不做：不改取消语义、不动审批、不加持久化。

### 动作 2：缺件即拒绝（fail-closed），并把预设缺失变成显式降级

- 目标：堵住"服务不在就放过"的两个口子，并让缺件在 UI 上可见而不是抛错。
- 文件：`core/src/host/folders.ts`（`approveFolder`：`sandboxPolicy` 缺失时抛可读错误，不 `return`）、`core/src/host/permissions.ts`（`permissionCatalog` 返回 undefined 时，`setPermission` 给明确错误、`channel` 视图给 null 且界面隐藏入口）、`core/src/service/engine.ts`（装配处留一行注释说明为何不提供这些服务）、`core/src/client` 设置页（预设为空时不渲染选择器）。
- 前置：同 PR 在 `docs/plans/` 补一段"独立装配下的缺省审批语义"（缺失 = 拒绝，不是允许），请维护者确认后再改代码。
- 步骤：① 先加测试固定现状（越界目录当前通过）；② 改成拒绝；③ `permissions.test.ts` 保留 `runtime({ presets: false })` 的 "catalog 为 undefined" 断言，新增一条"`setPermission` 给出可读错误且不写 state"；④ 界面兜底。
- 验收：`core/test/work-dir.test.ts` 新增"无 `sandboxPolicy` 时把工作目录设到 team 目录之外被拒"；`core/test/permissions.test.ts` 覆盖两种缺失；一条界面级断言"`state.permissions === null` 时不渲染选择器、不显示 Always allow"；三件套全绿。
- 不做：不新增权限档位、不改预算、不改拒绝文案的既有措辞（文案改动另立设计）。

### 动作 3：上下文可观测（`run-stats` 真数据 + 手动压缩）

- 目标：让已有的 `ContextGauge` 有数，并给一个受控的手动压缩入口。
- 文件：`core/src/host/channel/ops-team.ts`（`run-stats` 改读本地来源）、`core/src/host/parts.ts`（暴露当前 part 的估算与最近一次压缩结果）、`core/src/shared/rpc.ts`（新增一个 `context-compact` case）、`core/src/client/model-context.tsx`（无数据时不渲染环）。
- 步骤：① 在 `parts.ts` 记一份内存态：`{ used, total, checkedAt, lastAction }`，`used` 用现有 `estimateTokens` 与 `contextLines` 的 window；② `run-stats` 组装成 `contextPressure` 形状（`pressureTokens`/`contextWindow`），不再依赖 `sessionProjections`；③ `context-compact` 只在"无运行回合、无未读投递"时接受，否则返回明确原因；④ 手动压缩走与 steward 相同的决策入口，不新增第二条压缩路径。
- 验收：`core/test/tasks-panel.test.ts` 或新 `context-stats.test.ts` 断言 `run-stats` 在无 `sessionProjections` 时也给出数字；`core/test/steward.test.ts` 加一条"手动触发走同一 `linesFor` 阈值"；界面在 mock 数据下环有百分比；运行中触发手动压缩返回拒绝且不产生回合；三件套全绿。
- 不做：不改压缩阈值、不改交接预算、不做"到点自动压缩"的新策略（现有 steward 已经覆盖）。

三个动作之外，下一步按顺序是 7（能力描述符）→ 12（健康状态）→ 13（doctor），它们是"引擎健康"整条线的前置。

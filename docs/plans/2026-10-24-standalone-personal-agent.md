# Moon Bot Personal Agent 重构：去 DSH 独立运行时开发方案

- 日期：2026-10-24
- 状态：提案。含 vision.md 定位相关变更（Personal Agent 能力叠加于 Bot 小队之上），合并前需维护者确认
- 需求来源：《Moon Bot Personal Agent 产品与技术改造计划书》（2026-10-24）；本文吸收对其审计的修正后，是唯一实施依据
- 分支：`feat/standalone-personal-agent`（自 `dev` 拉，PR 进 `dev`）

## 一、已锁定决策

| 决策点 | 结论 |
|---|---|
| DSH | 彻底移除，一次性切换，新版不含任何 `@deepseek-ai/*` 组件与启动路径 |
| 产品形态 | 保留 Bot 小队：群聊、派活、交接、记忆隔离不动；五项 Personal Agent 能力建在小队之上，Chief 即主代理 |
| 引擎 | `AgentRuntime` 统一接口；内置引擎为默认，ACP 适配器为第二实现 |
| 内置引擎内核 | `pi-agent-core` + `pi-ai`（阶段 0 原型验收；不过关退备胎：`pi-ai` 传输层 + 自写薄 loop） |
| ACP agent 地位 | 完整 Bot：同一套外壳（名字/记忆/进群聊/被派活），协议覆盖不到处在界面标注降级 |
| 存量数据 | 新起点不迁移，旧版继续可读旧数据；Changelog 向用户明示 |
| 存储 | 记忆以 Markdown 为事实源（现有 Agent Memory Repo 格式）；SQLite 承载索引、会话、任务 |
| 服务 | Fastify + `@fastify/websocket` + `@fastify/static`；Electron 壳改加载自家服务地址 |
| 语言 | **全面 TypeScript**：core 与 app 的源码、入口与测试全部迁为 .ts/.tsx；例外仅生成物（client.js）与 vendored 文件（client/vendor/framer-motion.js） |

## 二、技术栈

| 层 | 选择 | 许可证 | 引入阶段 |
|---|---|---|---|
| loop 内核 | `pi-agent-core`（状态/事件/消息队列） | 待核（大概率 MIT） | 0 验收，2 引入 |
| provider/流式 | `pi-ai`（统一 LLM API，任意 OpenAI 兼容端点） | 同上 | 0 验收，2 引入 |
| 工具与契约校验 | Zod（已在依赖） | MIT | 1 |
| 存储 | better-sqlite3 + FTS5（trigram，中文可用） | MIT | 1 |
| 服务框架 | Fastify + websocket/static 插件 | MIT | 3 |
| 调度 | croner + SQLite 持久化 next-run 轮询 | MIT | 4 |
| 连接器 | `@modelcontextprotocol/sdk` + 自有策略层 | MIT | 5 |
| 通用 agent 接入 | ACP（JSON-RPC over stdio）客户端实现 | 规范开放 | 5 |
| 智能 UI | `@openuidev/react-ui` 系（实现时验证 API 与许可证） | 待核 | 6 |
| 消息渲染 | react-markdown + remark-gfm + rehype-highlight | MIT | 3 |
| 客户端/构建 | 现有 React 客户端与 esbuild 流程不动 | — | — |

全部新依赖登记 NOTICE（AGENTS.md 规则 3）；客户端改动一律走 `src/client → npm run build → 同提交 client.js`（规则 4）。Host 的 .ts 经 Node 22.18+ 原生类型剥离直接运行（engines ≥22.18 已满足），不新增构建步骤；app 的 Electron 主进程与 client 同走 esbuild。

TS 现状盘点（2026-10-24 实测）：core 源码侧仅剩 `index.js`（70 行）、`web-search.js`（783 行）、`dev/mock-llm.mjs`（742 行）、`scripts/build-client.mjs`（79 行）四个待迁文件；`src/host`、`src/client` 已全部 TS。大头是 app 的 16 个 .mjs 与 106 个 .test.js。

## 三、现状基线与差距

不是绿地工程。以下为阶段 0 前已确认的事实，阶段计划直接建立在其上。

### 3.1 保留不动的资产

- client 全部 UI（约 40k 行 React；唯一例外是 `dsh-primitives.ts` 的两个组件）
- roster/store、groups/rounds（群聊轮次）、handoffs、parts + 记忆冻结（字节稳定保 prefix cache）、delivery、turns/route（事件路由）
- memory（Agent Memory Repo：自动复盘、Bot/群/队分区、journal、快照、记忆面板）
- schedules 五种触发（at/间隔/每日/每周/cron）、permissions/approvals、secrets、usage、files/images/chat-index、浏览器桥、`api/bot` 通道（73 个 RPC case）

### 3.2 差距清单

| 能力 | 已有 | 缺口（本方案要做的） |
|---|---|---|
| 持久记忆 | 结构化记忆、自动复盘、分区隔离 | 有效期/过期、冲突与纠错、置信度元数据 |
| 主动使用记忆 | recall 读路径、记忆面板 | 相关性排序（FTS5 BM25 + 时效/置信度）、主动浮现注入（稳定段+动态段） |
| 主动行动 | 五类定时触发 | 持久化与重启恢复验证、条件/事件触发、行动闭环（验证/跟进）、通知策略 |
| 跨应用执行 | 无 | MCP 连接器、策略包装、结果验证、失败恢复 |
| 自主性 | permissions/approvals 机制 | 统一 Policy Engine（L0–L4 风险分级、预算、审批）挂到工具门与连接器 |
| 渲染 | DSH `MarkdownText` | 自研 ChatGPT 风格渲染（四主题明暗、流式安全、代码块复制/高亮） |

### 3.3 DSH 移除清单

- 28 个文件引用、5 个运行时符号（`BlockAssembler`/`createUserMessage`/`defineTool`/`ToolRunContext` + UI 原语）
- 桌面窗口本身：`app/src/profile.mjs` 的 `dsh-web-app` bundle——需自建窗口宿主（Fastify + Electron 加载）
- DSH Agent 客户端功能（侧栏 agent 行、`dsh-offer.tsx`、`FishLogo`）——随 DSH 删除
- `app/src/import.mjs`（从 `~/.dsh` 导入）——功能随定位变化废弃
- 测试基座 `npm run harness`/`dev/harness`——换到自有 mock 基座
- `dsh-types.d.ts`、`dsh-packages.d.ts`、`dsh-update.ts`、`cordis.patch.yml`（用途在阶段 0 查明后删）

## 四、目标架构

```text
   Web 客户端(现有 React)          Electron 壳(改加载自家 URL)
        |                               |
        +---------------+---------------+
                        v
             Fastify 服务（Event Gateway）
          auth(平移 web-login) · 静态 · WS
                        |
                api/bot 通道(现有 73 RPC 扩展)
                        v
       Host 服务层（现有代码为主）
   roster · groups/rounds · handoffs · parts
   memory(Markdown+SQLite索引) · schedules
   policy engine(L0–L4) · usage · secrets
                        |
                AgentRuntime 接口
          +-----------------------------+
          |                             |
    内置引擎(默认)                  ACP 适配器
   pi-agent-core + pi-ai         stdio JSON-RPC
   记忆冻结注入 · 工具门          Claude Agent/Gemini CLI/
   事件→parts 映射               opencode…(完整 Bot)
          |                             |
          +-----------------------------+
                        |
              工具执行层（Zod 注册表）
      本地工具 · Bot 团队工具 · MCP 连接器
                        |
              结果验证 → 记忆/任务状态更新
```

原则（继承自计划书 §1.4 并保留）：引擎执行回合；记忆、策略、调度、验证归 Moon Bot。ACP 路径上协议覆盖不到的能力按降级矩阵处理，不在协议外强求控制。

## 五、阶段计划

### 阶段 0：基线固化（5–8 人日）

- 行为固化测试：趁 DSH 在位，把现有 loop 边界行为写成测试（流中断恢复、工具超时、重试节奏、取消语义、工具调用幂等），作为新引擎验收锚。
- Pi 原型验收，五项判据：① 任意 OpenAI 兼容端点（自定义 base URL + key）；② 每次 tool call 可被拦截/拒绝/挂起；③ system prompt 与记忆冻结段顺序由我方控制；④ 取消/恢复语义；⑤ 事件可映射到现有 parts 模型。另核许可证。
- 查明 `cordis.patch.yml` 用途；产出最终依赖清单。

验收：行为测试全绿并入主分支；Pi 判据全过（或记录退备胎原因）。

### 阶段 1：契约层 + core TS 收尾（6–10 人日）

- `AgentRuntime` 接口定稿（`start/stop/runTurn(→AsyncIterable<EngineEvent>)/cancelTurn`）。
- 统一事件协议：EngineEvent 形状 → 现有 parts/cells 的映射定案（`turns/route.ts` 只换事件源）。
- SQLite schema：sessions/messages/tasks/memory index；Zod 全量建模。
- `shared/` 契约扩展（rpc 增补新 case）。
- core TS 收尾：`index.js→index.ts`（新独立入口直接以 TS 落地）、`web-search.js→.ts`、`dev/mock-llm.mjs→.ts`、`scripts/build-client.mjs→.ts`；`npm run typecheck` 升为 CI 门禁。

验收：接口与 schema 评审通过；类型层零 DSH 依赖；core 源码无 .js/.mjs（vendored 与 client.js 生成物除外）。

### 阶段 2：内置引擎（12–18 人日）

- pi 内核接入 + 适配层：记忆冻结注入、工具门（permissions/approvals 平移至此）、事件映射。
- 工具注册表：Zod 定义，替换 `defineTool`；四个工具模块平移。
- 自有 session/message 存储（SQLite，取代 DSH session 格式）。

验收：mock-llm 全测试过；进程内对话+工具+群聊回合跑通并对照阶段 0 行为测试；此时 DSH 仍在位可对照。

### 阶段 3：独立服务与客户端切换（11–16 人日）→ 里程碑 M1

- Fastify：auth 平移、静态托管 client.js、WS 事件流；Dockerfile 更新。
- 自研 `MarkdownText`（react-markdown + remark-gfm + rehype-highlight；ChatGPT 风格：代码块头+语言+复制按钮、表格、行内代码、流式安全、四主题明暗），同签名替换 4 个调用点。
- Electron：`main.mjs` 改加载自家服务地址；删 `profile.mjs`/`host.mjs`/`host-process.mjs`；app 的 16 个 .mjs 全部迁 .ts，主进程经 esbuild 打包。

验收：`docker run` 单容器端到端可用；桌面版可用；运行时零 DSH。

### 阶段 4：记忆与主动升级（12–18 人日）

- FTS5 trigram 索引 + 相关性/时效/置信度排序；有效期、冲突、纠错。
- 主动浮现：稳定段+动态段分层注入，保 prefix cache；量化 token 成本。
- 调度持久化（SQLite next-run + croner 轮询，不依赖内存定时器）、条件/事件触发、行动闭环（验证→跟进→通知策略）、用户可暂停/取消。

验收：无显式回忆指令的跨会话记忆评测通过；重启后调度恢复；主动行动端到端闭环。

### 阶段 5：策略引擎 + 连接器 + ACP（15–22 人日）

- Policy Engine：L0–L4 风险分级、预算、审批，统一挂到工具门与连接器。
- MCP 首批连接器（本地文件、日历、邮件）+ 策略包装 + 结果验证 + 部分失败恢复。
- ACP 适配器：subprocess 管理、事件映射、完整 Bot 注册（名字/记忆/群聊/派活）、降级矩阵标注。

验收：一个真实跨应用工作流端到端含失败恢复；一个 ACP agent 作为完整 Bot 进群聊并被派活。

### 阶段 6：OpenUI + 评测 + 清扫（12–18 人日）→ 里程碑 M2 发版

- `@openuidev` 集成：与现有 8 种卡片 views 并存，异常输出安全降级，交互经 Moon Bot API、前端不可自批高风险。
- 五项能力评测集（JSON fixture + 脚本，进 `core/test/`）。
- 测试全 TS 收尾：106 个 .test.js 随各阶段改动就近迁移，此处清零并纳入 typecheck。
- 清扫：删全部 DSH 残留、`dev/harness` 换基座、NOTICE、README（双语）/AGENTS/vision 同步、Changelog（明示新起点不迁移）。

验收：全仓无 `@deepseek-ai` 引用；评测达标；`npm test`/`--check`/`lint` 全绿。

## 六、工期汇总

| 阶段 | 人日 |
|---|---|
| 0 基线固化 | 5–8 |
| 1 契约层 + core TS 收尾 | 6–10 |
| 2 内置引擎 | 12–18 |
| 3 服务与客户端 + app TS | 11–16 |
| 4 记忆与主动 | 12–18 |
| 5 策略/连接器/ACP | 15–22 |
| 6 OpenUI/评测/清扫 + 测试 TS | 12–18 |
| 合计 | 73–110 人日 |

假设 1–2 名熟悉本仓库的开发者，日历工期约 3.5–5 个月。关键路径 0→1→2→3；阶段 3 内的渲染与服务可并行；阶段 4 与 5 可部分并行（记忆升级与 ACP 适配无依赖）。

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| Pi 停维护或验收不过 | 面小可 vendor 进仓；备胎为 `pi-ai` 传输层 + 自写薄 loop，接口不变 |
| 动态注入破坏 prefix cache | 稳定段+动态段分层设计；token 成本监控进 usage |
| 流式加固坑（中断/重试/幂等） | 阶段 0 行为固化测试兜底 |
| ACP 各家能力差异 | 降级矩阵 + 逐家验收进测试 |
| 一次性切换 | 新起点无迁移负担；发版走 RC 内测；旧版保留可读旧数据 |
| 新依赖许可证 | 阶段 0/6 两次核验，NOTICE 登记 |
| 质量门禁 | 350 行文件门限、`npm test`/`--check`/`lint` 每阶段全跑 |

## 八、明确不做

- 不迁移旧数据（产品决策，旧版可读）。
- 不做恋爱陪伴向的情感设计。
- 不造通用 agent 框架；不引入 LangChain 类全家桶。
- 不维护 DSH 双栈过渡版。
- 不在 ACP 路径上追求超出协议的控制力。

## 九、最终验收

五项能力（全部可运行、可重复测试）：

- [ ] 持久记忆：跨会话与重启后可用，有来源与时间，可纠错、过期、删除。
- [ ] 主动使用记忆：无显式回忆指令时正确检索并使用，评测集达标。
- [ ] 主动行动：无进行中回合时可触发、执行、跟进已授权任务；重启可恢复；通知可控。
- [ ] 跨应用执行：至少一个真实多步工作流端到端，结果经验证，失败可恢复不重复。
- [ ] 自主性：L0–L4 分级贯彻，未授权被服务端拒绝，模型不可经提示词绕过。

基础设施：

- [ ] 全仓无 `@deepseek-ai` 依赖与启动路径；Web 与桌面均独立运行。
- [ ] `AgentRuntime` 可替换（内置/ACP 两实现并存即证明）。
- [ ] 会话、记忆、任务状态由 Moon Bot 自有格式持有。
- [ ] 现有 Web UI 与桌面核心功能保留；OpenUI 与现有消息共存。
- [ ] 工具执行有服务端权限校验；任务持久化、恢复、审计。
- [ ] 全仓为 TypeScript（core 与 app 的源码、入口、测试）；例外仅 client.js 生成物与 vendored 文件；`typecheck` 进 CI。

## 变更

- 2026-10-24：初稿（整合产品计划书、审计修正、选型与四项产品决策）。
- 2026-10-24：补充「全面 TypeScript」决策：core 与 app 的源码、入口、测试全部迁 TS，typecheck 升为 CI 门禁。

## 十、阶段 0 验收记录（2026-10-24，分支 feat/standalone-personal-agent）

- **Pi 原型验收：5/5 通过**（`core/test/pi-proto.test.js`，对本地 OpenAI 兼容端点，无真实密钥）。
  ① 自定义 base URL + key 经 `openai-completions` API 驱动 agent（Authorization 头、路径、model 均验）；② `beforeToolCall` 拦截：放行/拒绝（block+reason）/挂起（await 审批门）三态齐备，被拒调用以错误结果回到模型；③ system prompt 基底+冻结记忆段顺序稳定，`transformContext` 注入动态段不落盘、不破坏稳定前缀；④ `abort()` 流中取消（部分内容保留在 transcript，stopReason=aborted），`followUp+continue()` 从同一 transcript 恢复；pi 的 LLM 转换会把未完成的 aborted 回复留在 transcript 但不送上线——引擎适配层按需补写；⑤ 事件五类（agent_start/message_end/tool_execution_start/tool_execution_end/agent_end）一一映射到现有 session/event 词表（turn/start、assistant/message、tool/call、tool/result、turn/end）。
- **包名修正**：npm 上的 `pi-agent-core`/`pi-ai` 是占位包；真实包为 **`@earendil-works/pi-agent-core@1.4.0` + `@earendil-works/pi-ai@1.4.0`**（MIT，活跃维护，`pi-mono` 后继）。已入 core 依赖并登记 NOTICE。备胎结论无需启用：主判据全过。
- **行为固化测试**：`core/test/loop-boundaries.test.js` 冻结 loop 边界契约（孤儿工具调用不卡死下一回合、事件重放不重复记账/不重复通知、流中断以 aborted 收尾且已说内容交回发送方、未开口的 aborted 给"was stopped"行）。既有 886 项测试（follow-through、bot-messages、rounds 等）继续作为整体回归网。
- **cordis.patch.yml 用途查明**：把 moon-bot-core 挂进 DSH profile（bot + web-search-auto 两个 mount），覆盖 web 搜索提供方配置（searchProvider: auto），并以 lean 形态关闭 DSH 自带的 Automation 入口/调度器/调度工具/产品遥测/会话日志上传。阶段 3 服务自建后整文件随 DSH 移除清单删除。
- **最终依赖清单**（引入阶段见 §二）：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`（已引入）；zod（已有）；better-sqlite3、Fastify、@fastify/websocket、@fastify/static、croner、@modelcontextprotocol/sdk、react-markdown、remark-gfm、rehype-highlight（阶段 1–5 按需引入，各自引入时登记 NOTICE）；`@openuidev/react-ui` 系实现时再核 API 与许可证（阶段 6）。
- 门禁：`npm test` 894 项 / 891 过 / 0 红；`npm run lint`（含 350 行门禁）过；`npm run typecheck` 0 错。

## 十一、阶段 1 验收记录（2026-10-24，feat/standalone-personal-agent）

- **AgentRuntime 定稿**（`src/engine/runtime.ts`）：`start/stop/runTurn(→AsyncIterable<EngineEvent>)/steer/cancelTurn`。`steer` 为第五个成员：DSH inbox 的「插话进运行中回合」语义必须有落点（pi 的 steer 队列），文档即接口。会话配置按回合携带（model/effort/systemPrompt/工具名单），引擎不留配置状态。
- **事件协议**（`src/engine/events.ts`）：与 session/event 同词表的封闭集合（turn/start、user/message、assistant/stream 增量、assistant/message、tool/call、tool/result、turn/end + EngineStopReason）；`engineEventOf` 从未类型载荷读回。流式增量专给阶段 3 客户端流，router 不依赖。
- **SQLite schema**（`src/store/`，better-sqlite3@12 + FTS5 trigram，迁移表 user_version）：sessions/messages（会话内 seq 递增）、tasks（next_run_at + 独占认领）、memory_index（scope 整体重建、supersede 链、置信度/有效期列；FTS 走 ≥3 字符词条、更短的中文词走子串过滤）。行全部 Zod 建模。测试 `test/sqlite-store.test.js`。
- **shared/rpc 增补**：`engines`（列出各 Bot 的引擎）与 `engine-set`（迁移某 Bot 到另一引擎）。
- **core TS 收尾**：`index.js→src/index.ts`（根 index.js 为生成再导出）、`web-search.js→src/web-search.ts`（拆 config/engines/host/native/provider/readers/source 七模块，全 strict 类型，30 测全过）、`dev/mock-llm.mjs→.ts`、`scripts/build-client.mjs→.ts`。构建：build-host 新增 engine/store/web-search 层与根 shim（index.js、web-search.js 均生成物，--check 覆盖）。CI test.yml 同步。**core 源码已无手写 .js/.mjs（vendored 与 client.js 除外）**；新测试起用 .ts（engine-contract）。
- **门禁**：`check-gates` 认识 engine/store 层（client 不得引二者；engine 不得引 host/client；store 只可引 shared 与自身）。测试 glob 增 `*.test.ts`。
- 门禁数字：`npm test` 907 / 904 过 / 0 红；typecheck 0；lint 过。

## 十二、阶段 2 进行记录（2026-10-24 起）

- **内置引擎核心已落地**（`src/engine/builtin/`，commit 9b339c1）：services（宿主注入的 ModelSource/PromptSource/ToolGate/TranscriptStore 四缝）、adapter（pi Agent 构造与事件映射、prompt 顺序 base+冻结+动态、beforeToolCall 过门）、runtime（每会话一次一回合、排队、steer 并入、cancel→aborted、全量落库）。`test/builtin-engine.test.ts` 五项全绿：门控工具回合、拒绝回给模型、双回合排队+steer、流中取消、无模型错误收尾。
- **宿主桥已落地**（bridge.ts，commit 01032a7）：每会话一个 engine agent（followup 开回合、steer 并入运行中回合/空闲即开回合——DSH inbox 语义、cancel 中止、status 反映运行中）；engine 事件以 session/event 喂给既有 route。`test/engine-bridge.test.ts`：group_relay 群聊回合全链路经引擎跑通、message_bot 请求往返并记入 exchange。**对照锚成立：roster/groups/delivery/route 原代码 + 引擎事件源 = 群聊与请求闭环**，DSH 仍在位可随时对照。
- **历史回放已落地**（commit dc1a578）：每回合内核消息以 raw 形式全量落 SQLite（schema v2 加 raw 列；toolResult 行入档），第二回合起 initialState.messages 原样回放，回放的首条 system 消息由 createInitialSystemMessage 携带工具声明（agent 对自带 transcript 不再自建首条）。多回合测试验证：触发语/工具调用/工具结果/上一答全在第二请求的线上，工具照常提供。
- **Anthropic 线路已通**（commit 31f3125）：ResolvedModel 增 api 字段，adapter 按协议选流（openai-completions 默认、anthropic-messages 新增）。`test/engine-mock-llm.test.ts` 起真 dev/mock-llm.ts 跑脚本回合（回声回复 + remember 工具调用闭环）——阶段 2 的 mock-llm 锚点（进程内形态）。
- **工具注册表（四个工具模块平移完成）**（commit 7b16685）：chat/team/capability 三模块 17 个工具全部经 shared.register 入 Zod 注册表（schema 校验为引擎路径真值；参数描述图原样保留），defineTool 只剩 tools/dsh.ts 的派生处。执行器换 ToolContext；folders/shared 助手随之适配。待续：memory/secrets/groups 模块的 8 个工具（remember/forget/recall/list_secrets/request_secret/group_relay/read_group_chat/read_own_chat）入注册表。
- 阶段 3 侦察结论：client.js 平台面仅 3 个模块（react、react-dom、@deepseek-ai/dsh-client-ui-primitives——即 MarkdownText 与 FishLogo 两个组件，后者随 DSH Agent 功能删除，前者按计划自研）；web.mjs 是 DSH 前的密码代理（口令→launch token→DSH cookie，含限速），Fastify 服务将平移该 auth；api/bot 通道可经捕获的 route 复用（与测试同法）。Fastify/@fastify/websocket/@fastify/static 已装（5.12.7/11.3.4/10.1.7）。
- 门禁：`npm test` 912 / 909 过 / 0 红；typecheck 0；lint 过。

## 十三、阶段 3 进行记录（2026-10-24/25 起）

- **关键侦察**：桌面应用 app/ui 已是独立 React 壳（vite 构建，815 行 + 直接复用 core/src/client 组件；primitives.js 已用 react-markdown+remark-gfm 自实现 MarkdownText、FishLogo 置空）——窗口宿主已存在，无需重建 DSH web 壳。窗口协议已定：POST api/bot（RPC）+ GET api/bot/feed（SSE，重连以 hello 对齐），两条路由本就由 host 模块经 connection.fetch 注册（feed.ts），Fastify 只需捕获转发。宿主 ctx.get 服务面可枚举（约 19 个），且 fakeContext 证明缺省可降级。
- **Fastify 服务已落地**（src/service/，commit dddcf1a）：ServiceContext（fakeContext 的生产版：真实事件扇出、路由捕获、effect 释放；方法为绑定箭头属性——host 模块会裸取 ctx.on；inject 对存在的服务即刻交付、不存在的永不到来）；server.ts 服务两条路由 + /healthz + 密码门（timing-safe 比较、按址限速 5 次/10 分钟、HMAC 签名 httpOnly cookie、loopback 可免密、非 loopback 无密码拒启）。test/service.test.ts 三项全绿（state over HTTP、feed hello、auth 全链路）。
- **工具注册表全量对齐**（commit a16bf24）：剩余 9 个（groups/memory/secrets/browser 模块）迁 rt.registerTool，26/26 双路对齐（dsh-only 与 registry-only 皆空）。registerDshTool 对需要活 agent 的工具（group_relay 的轮次排空）在 ToolContext 里透传。**阶段 2 的工具注册表项至此收口**。
- **独立栈已闭环**（commit 6ee3a3f）：wireService 把 host 运行时、SQLite、内置引擎与桥接合一——prompt 取自已注册 section（bot-memory 单列为冻结段）、模型走独立 provider 路由、工具定义每回合经注册表解析（后挂能力免重接）、resolveAgent 发引擎 agent、事件以 {type,data} 信封进 route/feed（DSH 信封形状，直传裸事件是错的）。独立 credentials（0600 文件）与 settings（路径变更+版本号）落地；独立 llm 服务（知名端点小目录 + 路由 + OpenAI/Anthropic 形状的 /models 活发现 + 推理档位）。sessionController.prompt 把用户消息作为回合触发词投递。test/service-turn.test.ts：HTTP 发消息 → 引擎在 provider 路由上跑回合 → 答复上 SSE feed，端到端全绿。无密钥端点用 'keyless' 占位（pi 的客户端拒绝空 key，会静默失败——已修）。feed 套接字在服务停止时关闭（否则 close() 挂起）。
- **web 模式已通**（commit aac8eee）：app/ui 经 client TS 拆分后重新可构建（import 落到真实 .ts/.tsx、design 模块新家、CSS 常量各自的 -css.ts 模块），服务同源托管页面+bundle+API（已验：页面 200、bundle 1.1MB、state ok）。聊天分页改读 SQLite：sessionController.page 由 wiring 装入（user/assistant 行转为分页器读的 session 事件；工具结果仅活动视图），桥 agent 的 session 带下一 seq；引擎持久化触发词的 source（否则用户行不显示）。HTTP 回合后 chat RPC 返回双方消息（测试锁）。
- **独立入口与镜像已立**（commit 2a61d4d）：core/src/service/main.ts（读旧 web 模式同名环境变量 + MOON_BOT_UI），以 dist/service/main.js 交付；Dockerfile 两段——vite 构建 UI、运行段装 core 真依赖（better-sqlite3 需 install script）后跑服务入口。**发现（下一步必办）**：编译后的 dist 在运行时仍引两个 DSH 工具函数——createUserMessage（10 处，可平替为本地构造）与 BlockAssembler（3 处：memory/images/parts-note，需自写流式装配器）——DSH-free 镜像必须先去掉；tools/dsh.ts 的 defineTool 已随注册表隔离。
- **注册派生修正**（后续 commit）：defineTool 惰性 import 曾把注册变成异步（173 测试看到空工具表）——改为 createRequire 同步加载；且无 DSH 时的回退不是恒等：须把参数表折成 schema 形状（properties+required），这正是 DSH defineTool 替我们做的一步。有 DSH 时走真 defineTool，无 DSH 时全独立，两态同测。
- **dist 已 DSH-free 可启动**（commit 6719631）：llm-bits.ts 平替 createUserMessage（content+source+稳定 id）与 BlockAssembler（流序块装配、中断前缀、usage/finish），10 处 import 迁移，LlmStreamChunk 随行；tools/dsh.ts 的 defineTool 惰性加载（无 DSH 安装时恒等回退——独立 context 的收集器本不需要包装，而模块级 import 正是 DSH-free 启动的唯一断点）。已验：编译后的 dist/service/main.js 在无任何 DSH 安装下启动（health、state RPC、入口日志）；dist 里剩余 @deepseek-ai 引用皆为惰性路径（MCP 连接器字符串、诊断版本探测），缺席即降级。
- 待续：Electron 主进程改载服务地址。**侦察结论**：HostProcess 走 IPC（子进程发 {type:'ready',url}，shutdown 收敛，ELECTRON_RUN_AS_NODE=1 运行）——需要一个 app/src/service-host.mjs 子进程壳（起 startService、IPC 报 ready、应答 shutdown），core 包加 "./service" 导出指向 dist/service/server.js，app 依赖加 moon-bot-core: file:../core；UI 目录用打包内的 ui/dist。**关键风险**：better-sqlite3 的 prebuilt 是 Node ABI，ELECTRON_RUN_AS_NODE 的内嵌 Node 是 Electron ABI——打包时必须 electron-rebuild（electron-builder 可做）或验证 ABI 兼容；旧 DSH 主机无原生模块所以没遇过。另：app .mjs→.ts；平台服务补齐（attachments/approval）。
- 门禁：916 / 913 过 / 0 红。

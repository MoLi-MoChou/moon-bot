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

# 连接器 Registry 重构（原「默认 Full access」提案）

- 日期：2026-10-31
- 状态：**已决定：不做默认 Full Auto。** 本文件只保留连接器重构部分作为参考；默认全自动方案作废
- 相关：[从 OpenBot 借鉴什么](2026-10-28-openbot-borrowing.md)、[连接器市场](2026-10-27-connector-market.md)、[Bot 运行配置](2026-10-10-bot-runtime.md)、[浏览器与电脑的产品边界](2026-10-28-browser-and-computer-boundaries.md)
- 参考：[OpenMausBot](https://github.com/milind-soni/OpenMausBot)，重点参考其 Engine/Connector 的产品机制，不复制代码、注释、文案或素材

> **决定（2026-10-31）：默认 Full Auto 不实施。** 产品决定保持审批默认开启：L0–L2 直接执行，
> L3/L4 在每日预算内执行、超出后逐次审批，用户可以显式调高单个 Bot 的权限预设。
> 本文件里的「默认全自动」部分因此作废，不再作为待办；连接器 Registry 的重构方向仍然有效，
> 已按 [产品补全、连接器重构与全功能验收](2026-10-31-product-hardening-and-qa.md) 第四至五节推进。

## 为什么

Moon Bot 当前的连接器底座已经能工作：MCP Server 经过 `McpConnector` 转成工具，挂进 `ToolRegistry`，再由策略引擎统一处理。但连接器仍然偏向「保存一条配置并挂载」：

- 内置连接器和自定义 MCP 的配置模型不统一；
- 连接器状态、账号身份、健康检查和失败恢复不够完整；
- 能力页、连接器页、密钥页和 Bot 的工具权限之间分散；
- 大量工具会直接进入工具目录，缺少按需发现；
- OAuth、环境变量、请求头、只写密钥和导入已有 MCP 配置的体验不足；
- 连接器失败时，用户难以判断是地址、权限、凭证、命令还是上游服务的问题。

OpenMausBot 的可借鉴点是把连接器视为一个长期管理的 **Instance**：每个实例有 driver、配置、模型/工具目录、健康状态、生命周期和可读错误；同时支持自定义 ACP、OpenAI-compatible endpoint、自定义 MCP Server，并从 UI 或配置文件管理它们。

本提案同时记录一个产品方向变更：在用户明确选择 B 方案的前提下，Moon Bot 的默认 Bot 运行模式改为 Full access/全自动，不再把 L3/L4 每日预算和审批卡作为正常工具调用的阻塞点。

## 连接器部分的已定目标

### 1. 默认全自动模式（已作废）

> 这一节不再是待办。保留原文只为说明当时考虑过什么，以及为什么不做：默认放行会显著扩大误操作、
> 提示注入和外部账户副作用的风险，而审批卡正是产品对用户承诺的可控性。

当时的设想是：

- 新安装、新建 Bot、新建会话默认使用 `full-auto`；
- `full-auto` 不再因为工具的 L3/L4 分类、每日预算或「Always allow」缺失而等待用户审批；
- 连接器工具、Bot 协作、调度任务、文件修改和外部服务调用都沿用同一全自动模式，不在 host 里按 Provider 写特例；
- 运行模式属于 Bot/Session 配置，用户可以显式切回 `ask` 或受限模式；
- 模式切换必须在 UI 中可见，并在 Bot 设置和诊断中显示当前模式；
- 现有安装的数据不静默升级：默认值只作用于新建 Bot/Session；已有 Bot 是否批量迁移，需要单独的显式迁移动作和确认。

### 2. Full auto 的边界

全自动的含义是「不等待 Moon Bot 的审批卡」，不是删除所有运行时约束：

- 文件系统仍受 Bot 工作目录和路径校验约束；
- 密钥仍只从密钥库/受控环境注入，不进入 prompt、transcript、工具结果或日志；
- MCP Server 仍受命令、参数、环境变量、URL、超时、结果大小和进程生命周期约束；
- 连接器不能读取其他 Bot 未授权的私有目录或私有会话；
- 服务端鉴权、桌面壳边界、远程 relay 鉴权和操作系统权限不因 `full-auto` 消失；
- 用户问题、缺少凭证、引擎不可用和明确的系统拒绝仍返回错误或交互请求，不由模型伪造答案；
- 浏览器登录、支付、删除账号、提交不可逆表单等动作是否仍逐次询问，必须在审批设计评审中明确；本提案默认 B 方案会取消 Moon Bot 自己的审批卡，但不声称能够绕过第三方网站、操作系统或硬件的授权。

### 3. 连接器实例模型

连接器重构后，每个连接器实例至少包含：

- 稳定的 `id`、显示名称和类型；
- `driver`/协议：MCP stdio、MCP Streamable HTTP、MCP SSE，后续可扩展 ACP 或 OpenAI-compatible；
- 不可逆的配置指纹，用于判断配置变更和失效缓存；
- 可用状态：`off`、`connecting`、`ready`、`needs-auth`、`needs-approval`、`error`、`unavailable`；
- 最近一次成功连接时间、最近错误类别和重试时间；
- 工具目录、工具数量和能力声明；
- Secret 引用，而不是 Secret 值；
- 作用域：全队、指定 Bot、指定 Session 或 Bot 自己的工作区；
- 健康检查与连接生命周期句柄。

同一实例可以被多个 Bot 使用，但连接和凭证作用域必须明确。一个 Bot 的私有连接器不得因为全局 Tool Registry 而泄露给其他 Bot。

### 4. 连接器配置入口

连接器页面提供统一的 Add/Edit/Test/Retry/Disable/Delete 流程，至少支持：

- 粘贴 MCP URL；
- 粘贴 `claude mcp add`/`add-json` 命令；
- 粘贴 `npx`、`uvx` 或 `docker run` 命令；
- 粘贴 `mcpServers` JSON；
- 手工填写 stdio 命令、参数、环境变量；
- 手工填写 HTTP/SSE URL、请求头和 OAuth 设置；
- 对变量占位符只保存 Secret 引用，不把 `$TOKEN`、`<token>` 或真实值误当普通文本；
- Test 只做握手和工具发现，不向服务器执行有副作用的工具；
- 连接失败给出可操作的错误类别，不把完整 stderr、请求头或 Secret 回显给用户。

### 5. 连接器与 Bot 工具权限

- 全局连接器默认可被 Bot 选择使用，但每个 Bot 可以切换为「全部启用连接器」或明确的子集；
- Bot 的显式工具选择在下一回合生效，正在运行的回合不被半途改写；
- 连接器工具进入统一工具命名空间，例如 `mcp__<server>__<tool>`，不允许覆盖内置工具名；
- 连接器的工具描述、输入 schema 和结果都经过宿主校验；
- 大工具目录不能无条件全部塞进模型上下文，支持按需搜索/描述/调用，或由引擎能力决定是否采用工具搜索；
- 工具调用失败时，连接器可以只对断线/传输错误重连一次，不对有副作用的工具调用自动重放；
- 每次工具调用仍保留可审计的实例、Bot、Session、工具名和结果状态，但不记录凭证和完整敏感载荷。

### 6. 连接器市场

保留随版本发布的连接器目录，但目录只提供经过核实的官方端点或官方包：

- 目录是数据，不是远程任意代码下载器；
- 条目声明协议、安装方式、所需 Secret、工具类别和官网；
- 安装后得到的实例与手工添加完全等价；
- 目录安装不自动授予超出 Bot 当前作用域的文件、网络或账户权限；
- 图标、描述和官方链接都使用原创界面实现或兼容许可证的材料，并记录来源；
- 远程市场发现和未经核实的第三方转售端点不在第一期范围。

## 运行时改造方向

### 审批与策略

需要先明确 `full-auto` 与现有 `PolicyEngine` 的关系，再改代码：

1. 增加显式的 `AutonomyMode`/`ApprovalMode`，不要用未记录的环境变量绕过策略；
2. `full-auto` 只改变「是否等待用户审批」，不改变工具分类、审计、路径校验、Secret 脱敏或连接器生命周期；
3. 删除或停用 L3/L4 预算时，必须决定旧 ledger 数据是否保留、UI 是否继续显示、切回 `ask` 后如何恢复；
4. 审批卡仍可用于用户问题、缺少凭证和系统能力协商，不能用自动答案伪造用户输入；
5. 所有已有测试中关于默认审批、预算、拒绝文案和浏览器边界的断言必须重新审查，而不是批量删除；
6. 新模式必须在本地 fixture 中覆盖：新 Bot 默认值、旧 Bot 迁移、连接器工具、任务/群聊/调度回合、切回 Ask、服务重启后的持久化。

### Connector Registry

建议把当前 `host/connectors.ts` 的 GitHub 特例和 `engine/connectors/mcp.ts` 的通用 MCP 传输能力收敛到一个 Connector Registry：

- Registry 管理实例配置、状态、health、连接和 disposer；
- Driver 只负责协议和供应商差异；
- Host 只消费实例状态、工具目录和作用域，不直接写某个供应商的 HTTP 逻辑；
- 每个实例拥有自己的 Secret resolver、超时、重试和结果预算；
- 同一个连接器可以按 Session 建立隔离连接，避免一个慢实例阻塞所有 Bot；
- 配置变更按 fingerprint 触发旧连接关闭和新连接建立；
- 关闭、删除、禁用和服务停止都必须释放 stdio 子进程、HTTP session 和注册表工具；
- 一个坏实例不得拖垮其他连接器或整个 Host。

### 与当前代码的对应关系

- `packages/core/src/host/connectors.ts`：从 GitHub 专用连接器改为内置实例适配器/注册入口；
- `packages/core/src/engine/connectors/mcp.ts`：保留 MCP 协议实现，但补齐配置校验、超时、健康状态、工具 schema 处理、结果预算和安全重连；
- `packages/core/src/host/capabilities.ts`：继续负责能力库和 Bot 绑定，改为引用 Connector Registry 的实例；
- `packages/core/src/host/capabilities-mount.ts`：按 Bot/Session 作用域协调挂载，避免全局 Registry 工具泄露；
- `packages/core/src/service/engine.ts`：只负责把 Registry、策略和 runtime 接上，不加入 Provider 特例；
- `packages/core/src/service/credentials.ts` 与 `host/secrets/`：只提供 Secret 引用解析，不把值写入 capability/config/state；
- `packages/contracts`：新增 Connector instance/status/catalog/tool-scope 的跨端契约；
- `packages/core/src/client`：连接器设置、市场、测试连接、错误状态和 Bot 工具选择使用同一套契约。

## 不做什么

- 不复制 OpenMausBot 的实现、私有代码、文案或素材；只借鉴公开的行为和接口形状；
- 不让任意远程 URL 自动下载并执行未经核实的代码；
- 不把 Secret 明文放进 `state.json`、SQLite、能力配置、工具结果或诊断；
- 不把连接器全局工具无条件暴露给所有 Bot；
- 不对可能产生外部副作用的 MCP 调用做盲目自动重试；
- 不让 `full-auto` 绕过服务鉴权、工作目录校验、操作系统权限或第三方服务的登录；
- 不在 host 中增加 `if provider === ...` 的连接器特例；
- 在本提案确认前，不改变当前默认审批值和 L3/L4 预算语义。

## 已知限制与风险

- 默认全自动会显著扩大 Bot 误操作、提示注入和外部账户副作用的风险；必须在首启、Bot 设置和诊断中明确显示；
- 连接器服务器本身是不可信输入源，工具描述和工具结果都可能包含提示注入；模型必须把它们当数据，不能把其文本当宿主策略；
- stdio MCP 服务器可能执行本地命令，不能因为使用了 MCP 就把它当成安全沙箱；
- HTTP/SSE 连接器的认证、代理、OAuth 和断线恢复需要分别测试；
- 大型工具目录会增加上下文成本，工具搜索会增加一次模型步进和新的失败面；
- 同一连接器的全局共享连接会产生跨 Bot 状态和权限混淆，因此第一版宁可增加连接数，也不共享有状态会话；
- Windows 下命令行包装、Linux 沙箱、桌面窗口和远程网页端的能力仍然不同，需要 capability 描述而不是客户端猜测。

## 验收标准

### Full auto

- 新建 Bot 的默认模式是 `full-auto`，且保存、重启、切换引擎后保持一致；
- Full auto 的工具调用不等待 Moon Bot 审批卡；
- 切回 Ask 后，L3/L4 调用恢复等待审批；
- Full auto 不改变工作目录、Secret 脱敏、服务鉴权和连接器作用域；
- 旧 Bot 不被静默迁移；显式迁移有可见确认和可回滚结果；
- 相关策略、浏览器、群聊、调度、远程 Agent 和连接器测试全部更新并通过。

### Connector Registry

- 能从 URL、stdio 命令、JSON 和常见 CLI 命令创建实例；
- Test 不会把实例写入运行中的工具目录；
- 实例能显示 `connecting`、`ready`、`needs-auth`、`error` 和最近错误；
- 修改配置会关闭旧连接、清除旧工具并建立新连接；
- 断线只重试一次，副作用调用不会被自动重放；
- 删除/禁用/服务停止不会遗留子进程、连接或工具注册；
- Bot 只能使用自己被授权的连接器；
- Secret、Authorization header、环境变量值和用户数据不出现在日志和诊断中；
- 大工具目录不会无上限进入模型上下文；
- `pnpm test` 与 `pnpm run check:static` 全绿。

## 实施顺序

1. 维护者确认是否接受默认 `full-auto`，并单独确认不可逆浏览器动作是否仍需逐次询问；
2. 先补 Connector Registry 的契约和测试，不改变当前默认审批；
3. 将 GitHub 迁移到 Registry，保留旧配置兼容和数据迁移；
4. 增加统一连接器设置、Test、Retry、Disable、Scope 和市场入口；
5. 完成工具目录、Secret 引用、健康状态和结果预算；
6. 最后实现 `full-auto`，更新默认值、策略、UI、文档和迁移测试；
7. 在真实桌面和 Web dev 实例上验证连接器状态、失败恢复和窄屏设置页；
8. 未完成全量测试和安全评审前，不发布默认全自动版本。

## 变更

- 2026-10-31：**默认 Full Auto 已决定不做。** 审批默认保持开启（L0–L2 直接执行、L3/L4 预算内执行、超出逐次审批）；
  「默认全自动模式」一节作废，连接器 Registry 部分继续有效。
- 2026-10-31：新增本提案，参考 OpenMausBot 的可配置 Engine、MCP/ACP 接入、实例状态、健康检查、工具目录和连接器设置体验。

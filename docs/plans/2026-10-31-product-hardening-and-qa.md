# Moon Bot 产品补全、连接器重构与全功能验收方案

- 日期：2026-10-31
- 状态：按用户授权自主实施；**默认 Full Auto 已决定不做**，审批默认保持开启
- Moon Bot 仓库：https://github.com/zk020106/moon-bot
- 参考项目：
  - OpenMausBot：https://github.com/milind-soni/OpenMausBot
  - OpenBot：本仓库已有只读研究材料，见 [`docs/research/openbot-runtime.md`](../research/openbot-runtime.md)、[`docs/research/openbot-product.md`](../research/openbot-product.md)、[`docs/research/openbot-engineering.md`](../research/openbot-engineering.md)
- 关联方案：
  - [`2026-10-31-full-auto-and-connectors.md`](2026-10-31-full-auto-and-connectors.md)
  - [`2026-10-27-connector-market.md`](2026-10-27-connector-market.md)
  - [`2026-10-27-remote-agents.md`](2026-10-27-remote-agents.md)
  - [`2026-10-29-engine-capabilities.md`](2026-10-29-engine-capabilities.md)
  - [`2026-10-28-browser-and-computer-boundaries.md`](2026-10-28-browser-and-computer-boundaries.md)

> 本方案是完整的产品补全、连接器改善、ACP 验证、视觉验收和发布前测试计划。它不是“只跑几个单测”的验收清单。完成后必须同时证明：功能正确、权限边界正确、失败可解释、各端布局可用、文字和控件位置正确、旧数据可迁移、实际模型回合可运行。

## 一、目标

本轮目标是把 Moon Bot 从“核心运行时已经能工作”推进到“可长期使用、可诊断、可验证、可发布”的状态：

1. ~~默认 Full Auto/全自动方案~~：**已决定不做**。产品保持审批默认开启，不以绕过系统权限、服务鉴权、工作目录边界或 Secret 脱敏为代价换取自动化；
2. 连接器从当前 GitHub 特例 + 能力挂载模式，收敛为可管理的 Connector Registry；
3. 重新评估设置页中的 Capabilities 功能：保留它、合并它，或在不损失能力的前提下隐藏/迁移它，不能让用户面对重复入口；
4. 重新验证 ACP：确认本地 ACP、远程 ACP、断线、权限请求、无模型目录、版本不兼容等情况；如果 ACP 对用户没有实际价值，提供可用的替代路线，而不是保留一个“看起来支持、实际不可用”的入口；
5. 增加毛玻璃/透明度设置，并保证可读性、对比度、性能、减少动效和不支持 `backdrop-filter` 的环境都有降级；
6. 使用 `deepseek-v4.1flash` 作为本轮模型回归和人工验收的指定模型（前提是本地模型目录和凭据已配置；密钥不得进仓库）；
7. 完成全功能测试、视觉检查、窄屏检查和失败场景检查后，才可将本轮标记为完成。

## 二、总体原则

### 2.1 参考方式

OpenMausBot 和 OpenBot 只作为行为、交互和架构的参考，不复制源码、注释、产品文案、图标或图片。实现必须遵守 Moon Bot 的 Apache-2.0 代码库边界和本仓库的原创材料规则。

重点参考：

- OpenMausBot 的自定义 Engine、MCP/ACP 接入、连接器实例状态、健康检查、工具目录、配置导入和失败解释；
- OpenBot 的任务状态、队列交互、Agent 状态、权限作用域、视觉反馈、设置搜索和跨端 capability 思路；
- 不参考或不直接复制它们的默认无限授权、宿主桌面全权控制、Provider 特例堆叠和与本仓库许可证不兼容的实现。

### 2.2 完成标准

“完成”必须同时满足：

- 代码行为有单元/集成测试；
- Web 和 Desktop 至少各有一条真实 UI 验证路径；
- 关键流程用 `deepseek-v4.1flash` 完成真实回合或有明确的离线替代证明；
- 所有新增用户可见文字有英文基准和中文翻译；
- 文字不截断、按钮不溢出、弹层不出屏、窄屏可操作；
- 明暗主题、透明度、减少动效和不支持毛玻璃的浏览器均可用；
- 失败、断线、超时、缺凭证、无 ACP、能力未批准等情况都有可读结果；
- `pnpm test` 与 `pnpm run check:static` 全绿；
- 全部相关文档、计划、README 链接与实际行为一致。

## 三、范围与自主实施决策

本轮由用户授权自主决策。为避免扩大安全和发布风险，按以下顺序实施：

### 3.1 本轮立即实施

- 网页端和桌面共享界面的错误分级、就近提示、连接重试和文字布局；
- Connector Registry 前置的错误分类、健康状态、测试/重试/禁用/删除体验；
- Capabilities 与 Connectors 的职责边界评估和兼容迁移测试；
- ACP 真实可用性测试、doctor 输出和不可用时的可读 fallback；
- 全量功能矩阵、异常矩阵、布局检查和 Web/Desktop smoke；
- 现有数据、Secret 脱敏、工作目录、审批、群聊和 transcript 改动的回归验证。

### 3.2 本轮不擅自改变

- 不把默认审批改成 Full Auto；
- 不删除 L3/L4 预算、审批卡或用户拒绝路径；
- 不绕过工作目录、Secret、服务鉴权、连接器作用域或第三方网站权限；
- 不在没有真实兼容性证据时迁移格式化工具链；
- 不因为附件提到真实模型就写入凭据、调用未授权在线服务或将密钥记录在报告；
- 不提交生成物、截图中的用户数据或真实连接器配置。

默认 Full Auto 不做，审批默认值保持现状。Oxc Formatter 迁移先保留评估结论；需要改变既定工具链行为时，单独拆分方案、测试和维护者确认。透明度设置已按第七节实施，属设备本地偏好，不涉及团队状态。

## 四、Connector Registry 与连接器体验

将连接器视为长期管理的实例，而不是一个散落的配置对象。每个实例应支持：

- 稳定 ID、显示名、协议和驱动；
- `off`、`connecting`、`ready`、`needs-auth`、`needs-approval`、`error`、`unavailable` 状态；
- 配置指纹、最近成功连接时间、最近错误类别、重试时间；
- Secret 引用，不保存或返回 Secret 明文；
- 全队/Bot/Session/工作区作用域；
- 工具目录、工具数、schema、能力声明；
- Test、Retry、Disable、Delete 和生命周期释放；
- 配置修改后关闭旧连接、清理旧工具、建立新连接；
- 断线只对明确可安全重试的传输错误重连一次；副作用工具不盲目重放；
- 一个坏连接器不能拖垮其他 Bot 或整个 Host。

统一入口至少支持：

- MCP URL；
- MCP stdio 命令和参数；
- `claude mcp add`/`add-json`；
- `npx`、`uvx`、`docker run`；
- `mcpServers` JSON；
- HTTP/SSE/Streamable HTTP 的 headers、环境变量和 OAuth 配置；
- 变量占位符转为 Secret 引用；
- 只做握手和工具发现的 Test 流程；
- 可操作的错误分类：地址、协议、凭证、权限、超时、命令不存在、上游拒绝、工具 schema 无效。

候选落点：

- `packages/core/src/host/connectors.ts`：内置连接器/Registry 入口；
- `packages/core/src/engine/connectors/mcp.ts`：协议校验、结果预算、健康和重连；
- `packages/core/src/host/capabilities-mount.ts`：按 Bot/Session 作用域挂载；
- `packages/contracts`：Connector instance/status/catalog/scope 契约；
- `packages/core/src/client`：统一设置页、测试连接、状态、失败和 Bot 选择。

## 五、Capabilities 设置功能取舍

当前 Capabilities 同时承担 MCP、Skill、Pack、Bot 绑定和连接状态等职责。实施前必须完成评估，不能一边保留旧入口、一边新增 Connector Registry，造成两个“安装工具”的页面。

推荐拆成两层：

- **Connectors**：连接、凭证、协议、工具目录、健康状态、测试和重试；
- **Capabilities**：Skill、Pack 以及“哪些 Bot 可以使用哪些 Connector”的授权/绑定视图。

迁移要求：

- 新用户不会在两个页面重复配置同一 MCP；
- 老用户的能力配置可以迁移；
- 删除/禁用连接器前能看到影响范围；
- Bot 设置明确区分“已连接”和“已授权”；
- 空状态、错误状态、无权限状态都有合理文案；
- 窄屏下页面不会因表格、状态标签或配置表单溢出。

## 六、ACP 真实可用性与兜底

### 6.1 本地 ACP

验证：可执行 ACP CLI 发现、`initialize`、`session/new`、`prompt`、`session/update`、`cancel`、模型/effort 透传、工具调用、权限请求、用户拒绝/接受、进程退出、stderr、无响应、超时、恢复和跨平台路径。

### 6.2 远程 ACP

验证：`moon-bot-connect` WebSocket relay、邀请码生命周期、替换连接、断线可解释结束、重连后的新回合、审批不被服务端代答、relay 不记录 ACP 内容和 token。

### 6.3 不可用时的 fallback

按优先级提供 OpenAI-compatible API、稳定 wrapper、MCP 工具接入或内置 Moon Bot engine。设置页显示不可用原因、推荐替代方式和可复制命令；不把不支持 ACP 的 CLI 静默标成 ACP。

每个 ACP Engine 输出机器可读和 UI 可读结果：

- `usable`；
- `supportsTools`；
- `supportsPermissions`；
- `supportsResume`；
- `supportsModelDiscovery`；
- `supportsUsage`；
- `failureCode`；
- `recommendedFallback`。

## 七、毛玻璃/透明度设置

已实施（设备本地偏好）：

- 四档：关闭 / 轻度 / 标准 / 强度，位于通用设置 → 透明度；
- 全部经 `--bt-glass-tint`、`--bt-glass-blur`、`--bt-glass-filter` token；
- 只存本设备（`localStorage` 的 `moon-bot:glass`），不写入团队状态、不跨设备；
- `@supports not (backdrop-filter: blur(1px))` 回落到不透底色；
- `prefers-reduced-transparency: reduce` 同样回落；
- 桌面窗口和插件宿主在首帧就应用保存的档位，避免闪回默认值；
- 错误提示、连接状态条、浮动头部和提示浮层都读取同一组 token；
- 由 `packages/core/dev/check-layout.mjs` 在真实浏览器里逐档位、逐尺寸测量：
  不越出视口、不裁切文字、按钮不被覆盖、窄屏不压住头部药丸与输入框、
  文字对比度 ≥ 4.5:1。

高模糊档位的性能观察仍需在目标设备上补充记录。

## 八、全功能测试方案

本轮测试必须记录指定模型 `deepseek-v4.1flash` 是否可用。模型不可用时，明确记录原因并使用离线 mock 完成结构测试，不能偷偷切换未记录的真实模型。

### 8.1 自动检查

从仓库根执行：

```sh
pnpm test
pnpm run check:static
pnpm run build
pnpm run eval
```

报告标明执行环境、模型、是否真实模型、费用、跳过原因和离线替代检查。

### 8.2 功能矩阵

逐项验证：首次启动和目录迁移；Bot/群创建、编辑、删除、隐藏、归档、恢复；权限；私聊、群聊、@、派活、队列、steer、取消、重启恢复、失败和继续；上下文、压缩、记忆；模型、思考强度、额度、超时、过载；内置 engine、本地/远程 ACP 和 fallback；工具、Secrets、MCP、Connector、Capabilities、浏览器、调度、Webhook、后台投递、附件、文件库、relay、邀请码、诊断、健康、更新和 UI 外观。

### 8.3 异常矩阵

每个主要功能至少测：空状态、缺失配置、缺 Secret、错误 URL、错误命令、无权限、超时、断线、重复请求、并发请求、服务重启、数据迁移、过长文字、特殊字符和中文、深色/浅色、窄屏/宽屏、无桌面壳 Web、ACP 能力缺失和第三方恶意提示文本。

## 九、视觉与文字位置验收

“功能通过”不代表 UI 通过。所有页面和状态必须检查实际渲染，而不是只检查 DOM 存在。

### 9.1 截图尺寸

至少检查 Desktop 1280×800、1440×900；窄屏 390×844、430×932；中等宽度 768×1024；高 DPI；深色/浅色；透明度关闭和标准档位。

### 9.2 逐类检查

- 页面标题、返回按钮和操作按钮在同一视觉层级；
- 侧栏收起后主内容仍可操作；
- Bot 名称、头像、状态、模型和权限对齐；
- 状态标签不截断、不挤压；
- 连接器错误文字不撑破卡片；
- 长 URL、命令、工具名、模型名可换行或水平滚动；
- label、输入框、帮助文案和错误提示关系清楚；
- 保存、取消、删除、重试按钮在窄屏可点击；
- 审批卡、问题卡、Secret 卡完整显示；
- 工具过程、任务、队列和群聊状态能看出归属；
- 透明背景下文本、边界、焦点环和 hover 状态清晰；
- Toast、Modal、Popover 不被侧栏、键盘或视口裁剪；
- 中文、英文、数字、长模型名混排不错位；
- 读屏顺序、键盘焦点和 `aria-label` 与视觉顺序一致。

每个异常场景同时检查：提示文字的实际位置、与触发控件的距离、是否与按钮重叠、是否遮挡输入框、是否能换行、是否有正确的 `role`/焦点、是否会在切换页面后残留。

### 9.3 验证方式

- 使用 dev Web 实例和 Desktop 真实窗口；
- 改 UI 后先构建受影响产物，再刷新页面；
- Playwright 截图用于定位回归，不替代功能断言；
- 每个视觉修复保留可复核的异常/修复记录；
- 不提交生成物、用户数据或真实连接器凭证。

## 十、实施阶段

0. **基线**：记录 `pnpm test`、`check:static`、`build`、`eval`、doctor、Web/Desktop smoke、ACP 和基线截图；确认指定模型是否可用。
1. **连接器与 Capabilities**：先完成职责评估、契约、状态、Secret 引用、作用域、测试和迁移。
2. **ACP**：按矩阵测试 discovery、握手、权限、取消、断线、恢复和 fallback。
3. ~~**Full Auto**~~：不做。审批保持默认开启；用户仍可显式调高单个 Bot 的权限预设。
4. **毛玻璃/透明度**：已完成 token、fallback、对比度与设备本地持久化；高模糊档位的目标设备性能观察仍待补充。
5. **全量回归与视觉验收**：用指定模型或记录离线替代，跑功能/异常矩阵、截图和人工位置检查，修复文案、布局、i18n、无障碍问题，最后重新跑全量测试。

## 十一、格式化工具链评估

当前仓库使用 Biome。Oxc Formatter 迁移单独评估，不与业务行为混合：先记录版本和格式基线，再验证 TS/TSX、JSON、CSS、Markdown、JSX classic transform、门禁、三平台一致性和生成物规则。若兼容性或稳定性不足，保留 Biome并记录阻塞原因；不为了统一工具降低质量。

## 十二、交付物

- Connector Registry 设计与契约；
- Capabilities 取舍结论和迁移说明；
- ACP 可用性报告、失败样例和 fallback 说明；
- ~~Full Auto 审批设计~~：已决定不做，理由记录在提案的变更里；
- 毛玻璃/透明度 UI 设计和降级说明（评估通过后）；
- 功能测试矩阵及通过/失败结果；
- `deepseek-v4.1flash` 模型测试记录或离线替代证明；
- Web/Desktop/窄屏/深浅主题截图检查记录；
- 更新后的用户文案、中文翻译和帮助文档；
- 全量测试日志和剩余已知限制。

## 十三、明确不做什么

- 不把 OpenMausBot 或 OpenBot 的代码、文案、图形、Logo 直接复制到 Moon Bot；
- 不因为要“全自动”而删除 Secret 脱敏、路径校验、连接器作用域和服务鉴权；
- 不把截图通过、DOM 存在或生成物一致冒充 UI 位置正确；
- 不用一个成功的 ACP discovery 结果掩盖真实回合不可用；
- 不因视觉问题难测就跳过中文、长文字、窄屏、透明度和减少动效；
- 不把测试模型的密钥、cookie、聊天内容或真实连接器凭证写入报告。

## 变更

- 2026-10-31：新增完整产品补全、连接器与 Capabilities 评估、ACP 可用性/fallback、毛玻璃设置、指定模型回归测试、全功能测试和视觉排版验收方案；补充 Moon Bot GitHub 仓库地址。
- 2026-10-31：补充格式化工具链评估。
- 2026-10-31：用户授权自主实施；明确本轮先完成网页端错误提示/连接恢复、连接器与 ACP 测试加固及全量 QA，不擅自改变默认审批或引入未经确认的 Full Auto。
- 2026-10-31：**默认 Full Auto 已决定不做**，审批默认保持开启。连接器 Registry、Capabilities 取舍、ACP 能力报告与全量 QA 已按本方案推进。

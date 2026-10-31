# 产品补全与 QA 基线记录

- 日期：2026-10-31
- 对应方案：[产品补全、连接器重构与全功能验收](../plans/2026-10-31-product-hardening-and-qa.md)、[错误提示、就近反馈与文字布局](../plans/2026-10-31-error-feedback-and-layout.md)
- 环境：Node 22 / pnpm workspace / Linux 容器
- 指定真实模型：**已使用 `deepseek-v4.1-flash-1017` 完成真实回合回归**（经本机模型网关，`openai-completions`）；密钥只写入 0600 的 `credentials.json`，未进入 settings、state 或日志，本报告不含任何凭据。

## 已完成并验证

| 检查 | 结果 | 说明 |
|---|---|---|
| `pnpm test` | 通过 | connect 18、core 1314、desktop 66 通过；desktop 1 个预期 skip |
| `pnpm run check:static` | 通过 | typecheck、lint gates、Biome format 全部通过 |
| `pnpm run eval` | 通过 | autonomy、memory、proactive、recall、workflow 五项 |
| 真实模型回合 | 通过 | `deepseek-v4.1-flash-1017` 经 Moon Bot 服务完成完整回合 |
| `pnpm --filter moon-bot-core run doctor` | 通过 | ACP discovery/doctor 可运行 |
| Web 无头 Chromium E2E | 通过 | 登录、团队、Bot 创建、mock 回复 |
| 浏览器布局检查 | 通过 | 透明度 3 档 × 3 尺寸 × 5 类错误面 |
| 逐页视觉矩阵 | 通过 | 12 个设置页 × 3 尺寸 × 2 主题 |
| `git diff --check` | 通过 | 无空白错误 |

## 本轮实际落地

### 连接器健康（七状态）

- 状态补全为 `off` / `connecting` / `ready` / `needs-auth` / `needs-approval` / `error` / `unavailable`；
- 新增配置指纹、最近成功时间、最近错误时间、自动重试时间；
- 失败分类决定下一步：被拒的凭据要换 token（不重试），传输失败按 5s/15s/60s/300s 退避自动重试一次，
  缺命令或服务端 404 归为 `unavailable`，未知失败只报告不盲重试；
- 断开连接会清空失败信息，不留幽灵错误；
- 同一次失败只发一次界面通知。

### Capabilities 与 Connectors 去重

- 连接（MCP，含市场与自定义）归 Connectors 页：地址、凭据、协议、工具、健康；
- 库页只创建和编辑技能与能力包；
- 库页仍列出连接，但只显示"谁在用"和一个"在连接器中打开"的入口，不能在这里新建或改配置；
- 新建按钮从"MCP"改为"技能或能力包"，筛选标签去掉 MCP。

### ACP 能力报告

- 新增机器可读报告：`usable`、`supportsTools`、`supportsPermissions`、`supportsResume`、
  `supportsModelDiscovery`、`supportsUsage`、`failureCode`、`recommendedFallback`；
- 能力只按 agent 在握手中声明的 method 判定，未声明即视为不支持；
- `doctor` 命令新增 `--json`，并打印一句结论与下一步；
- 修正 discovery 表：`claude` 与 `codex` 是厂商原生 CLI，不是 ACP agent，原先被标为 ACP 导致列出"看起来支持"。

### 真实模型回归发现并修复的缺陷

用 `deepseek-v4.1-flash-1017` 跑多流程时发现：**群聊房间自身的会话解析不到模型**，
每一次群聊回合都在 relay 之前就以 `NO-MODEL` 结束，群聊永远不回复。房间不是 Bot，
`selfOf(roomId)` 返回空，而 `configOf` 只看这个。修复后房间借用管理员的模型，
管理员缺失时取第一个真正有模型的成员。

修复同时抽成可测的 `sessionConfigOf`，并补了反向验证：移除修复时新增测试确实变红。

### 错误提示与位置

- 面板错误统一为 `bt-panel-error`：背景、边框、间距、可换行，不再贴边；
- 清除 `style={{ padding: 0 }}` 造成的贴边覆盖；
- 连接器错误统一走 `connectorErrorText()`（错误码 → 友好文案，未知原文走 `hostText`）；
- 聊天发送失败留在输入框上方，恢复草稿，并写入诊断；
- 顶部连接提示提供「重试」，点击立即完整同步；
- 桌面窗口与插件宿主启动即应用设备本地的透明度档位。

### 透明度（毛玻璃）设置

- 新增四档：关闭 / 轻度 / 标准 / 强度；
- 仅存本设备（`localStorage`，`moon-bot:glass`），不进入团队状态，不跨设备；
- 全部走 `--bt-glass-tint` / `--bt-glass-blur` / `--bt-glass-filter` token；
- 不支持 `backdrop-filter` 时自动回落到不透底色；
- `prefers-reduced-transparency: reduce` 同样回落；
- 设置位置：通用设置 → 透明度。

### 连接器错误

- `CustomConnectorForm` 的测试连接与保存失败；
- `ConnectorRow` 的连接/重试/断开失败；
- `ConnectorsPage` 的删除等操作失败；
- 连接器 `error` 状态文案。

## 布局检查发现并修复的真实缺陷

用 `packages/core/dev/check-layout.mjs` 在无头 Chromium 里量真实盒子（不是断言 DOM 存在），发现两处真实问题：

1. **窄屏下顶部连接提示压住头部药丸**。修复：把提示与 toast 的偏移改为 token（`--bt-notice-top` / `--bt-toast-bottom`），窄屏下让开安全区、药丸和输入框。
2. **聊天发送错误文字对比度 4.39:1**，低于 WCAG AA 的 4.5:1。修复：错误块改为 `var(--bt-ink)` 文字 + 危险色 8% 背景，同时获得边框、圆角与换行。

## 布局检查覆盖

`check-layout.mjs` 逐项测量，任何一项失败即非零退出：

- 透明度档位：`off` / `standard` / `strong`；
- 视口：390×844、768×1024、1280×800；
- 错误面：连接提示、面板错误、toast、输入框错误、回合错误；
- 断言：不越出视口、不裁切文字（除非可滚动）、按钮不被覆盖、窄屏不压住药丸与输入框、文字对比度 ≥ 4.5:1。

## 未完成 / 需要额外条件

## 真实模型回归（已完成）

通过 Moon Bot 自身服务跑通完整链路，未使用离线 mock 替代：

1. `provider-add` 注册 `openai-completions` 路由，模型 `cline/cline-pass/deepseek-v4.1-flash-1017`；
2. 模型目录解析出 `magpie/cline/cline-pass/deepseek-v4.1-flash-1017`；
3. `create-bot` 建 Bot，`update-bot` 指到该模型；
4. `send` 发消息，回合状态为 `completed`；
5. `chat` 读回 transcript，Bot 回复 `REAL-MODEL-OK`（两次不同措辞的指令都命中）；
6. 工具回合：模型尝试调用 `list_files`；
7. 记忆：写入并在 `memory-view` 读回；
8. 群聊：两个 Bot 分别回复 `ROOM-ALPHA` 与 `ROOM-BETA`（修复 NO-MODEL 后）。

密钥边界同时验证：明文只出现在 `credentials.json`（权限 0600），`settings.json`、`state.json` 和
服务日志中均不含该值。
- **Connector Registry 全量重构**：契约、作用域、健康、生命周期和迁移是独立批次，本轮只做了错误文案与状态体验。
- **Capabilities 与 Connectors 的页面合并与迁移**：需要设计确认后实施。
- **默认 Full Auto**：**已决定不做**（2026-10-31）。审批默认保持开启：`DEFAULT_BUDGET` 仍是 L3 每日 20 次、L4 每日 5 次，超出后逐次审批，拒绝文案不变。`approvals.ts` 的改动只涉及审批卡闭环与 ID 对齐，未触碰预算或默认放行。
- **Biome → Oxc Formatter 迁移**：单独评估，需先做全量格式基线与三平台一致性验证。
- **全页面人工截图矩阵**：本轮自动化覆盖了错误面与透明度；Settings / Tasks / Capabilities / Browser 等页面的逐页人工位置复核仍建议按方案清单执行。

## 结论

运行时、错误提示、连接恢复、透明度设置与自动化门禁已达到可交付基线，全量测试和静态检查全绿。上述未完成项均需要额外授权、凭据或独立设计确认，未完成的不能被标记为发布验收通过。

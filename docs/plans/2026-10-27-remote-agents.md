# 远程 Agent 接入：中转、邀请码与接入 CLI

- 日期：2026-10-27
- 相关：独立里程碑 E1；建立在 [独立个人 Agent](2026-10-24-standalone-personal-agent.md) §阶段 5 的 ACP 适配器之上

## 为什么

ACP Bot（Claude / Gemini / OpenCode）今天只能用本机的 CLI：`AcpRuntime` spawn 子进程、走 stdio。同事电脑上的 Codex、另一台机器上的 Claude Code，都进不了这支团队——除非把整台机器交给对方。要让「外部 agent 成为可派活的成员」，需要：

- 外部 agent **主动连出**到 Moon Bot 服务器（不开入站端口、不改防火墙）；
- Moon Bot 侧只做**配对与转发**：不跑模型、不存对话，一个轻量中转；
- 接入要**一条命令**：拿到邀请码的人 `npx moon-bot-connect --token …` 即入队，可随时吊销。

取舍：

- 中转是盲转发：Moon Bot 不解析 agent 的会话内容，ACP 线协议（JSON-RPC）原样过线。协议将来的扩展不需要中转改代码。
- 复用 `AcpRuntime` 的全部会话语义（session/new、prompt、update、cancel）：把「写到子进程 stdin」抽象成 transport，本地 stdio 与远程 relay 是同一接口的两个实现——对 host 的 roster、turns、delivery 来说两种 Bot 完全一样。
- 邀请码是唯一入队凭据：不引入用户体系，不碰 UI 的 cookie 鉴权。码可吊销，吊销即断线。
- 断线是事实，不是错误：远程 Bot 的回合以 error 收尾，Agent 重连后新回合继续；不自动重发未完成的 prompt（交给派活方决定要不要重派）。

## 已定的行为

### 引擎 spec

- Bot 的 `engine` 在 `kind: 'acp'` 之外新增 `kind: 'acp-remote'`，带 `agentId`（邀请码创建时命名，如 `kai-laptop-claude`）。
- `kind: 'acp'`（本地 spawn）行为不变。
- roster 校验：`acp-remote` 必须有非空 `agentId`，长度 ≤ 120。

### Transport 抽象

- `AcpTransport`：`send(line)`、`onLine(cb)`、`dispose()`。`AcpRuntime` 收 transport 工厂，其余不动。
- stdio 实现：现状（spawn 子进程）。
- relay 实现：帧即行，一条 WebSocket 消息一条 JSON-RPC 行。

### 中转（relay）

- 端点：现有 Fastify 服务上的 `GET /api/bot/relay`，WebSocket upgrade，`@fastify/websocket`。
- 鉴权：连接带 `token` 查询参数，与 UI 的 cookie 鉴权分开；无效/已吊销的 token 关连接。
- 配对：token 解析出 `agentId`；同一 `agentId` 新连接顶掉旧连接（先来者收到关闭帧）。
- 转发：host → agent 的请求与通知、agent → host 的响应与 `session/update` 通知，全部原样过线。中转不看内容。
- 生命周期：连接断开时，该 agent 名下所有在跑回合以 `turn/end (error)` 收尾；Bot 的会话与历史保留。

### 邀请码

- 只有 Main Bot 能创建/吊销（沿用[角色与权限](2026-10-07-roles-and-permissions.md)）。
- channel 新端点：`relay/invites`（列出）、`relay/invite-create`（命名 agentId，返回一次性展示的 token）、`relay/invite-revoke`、`relay/status`（哪些 agentId 在线）。
- token 随机 32 字符，存哈希；创建时明文只出现一次。
- UI：设置页「远程 Agent」一栏——创建、复制命令、吊销、在线状态点。

### 接入 CLI（`connect/` 新 workspace，包名 `moon-bot-connect`）

- `moon-bot-connect --url wss://host:8290/api/bot/relay --token <邀请码> [-- command args…]`
- 不带 command 时自动发现本机 agent（claude / gemini / opencode，规则与 `discovery.ts` 一致）。
- 桥接：agent 的 stdio 行 ↔ WebSocket 帧；断线即退出（非零码），由系统守护或人工重跑。
- 发布 npm 后 `npx` 即用；仓库内先 `node connect/src/main.ts` 可跑。

### 反向工具（Moon Bot MCP，本期不做）

- 给外部 agent 挂 MCP server：列 Bot、提问、派活、传文件；权限在执行端审批。独立 PR。

## 不做什么

- 中转不做协议解析、不做存储、不做重放：断线丢回合，不丢历史。
- 不做多路复用：一个 `agentId` 一条连接。
- 不做 agent 侧的自动重连退避：CLI 退出即止，守护交给运行它的机器。
- 不改本地 ACP（`kind: 'acp'`）的任何行为。

## 已知限制

- 明文 HTTP 下 token 可被链路截获；生产应走 HTTPS（与阶段 D 的证书同源）。
- `agentId` 是全局键：两个邀请码不能同名；吊销后同名可再发。
- 远程回合的工具调用结果（`tool_call_update`）依赖 agent 侧如实上报，中转不校验。

## 变更

- 2026-10-27：定下（E1 第一刀：中转 + 邀请码 + CLI；反向 MCP 另立）。

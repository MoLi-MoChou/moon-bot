# core/src/service：服务层

Fastify 服务、host 装配、凭证与设置、调度、审批桥、远程中转。这里是整个产品的 composition root：只有这一层可以把 host、store、engine、策略接在一起。先读根 [`AGENTS.md`](../../../AGENTS.md)。

## 装配唯一入口

- [`engine.ts`](engine.ts) 的 `wireService()` 是唯一装配入口：ServiceContext + runtime（`createRuntime`）+ SQLite store + BuiltinRuntime + PolicyEngine + RelayRegistry + 附件与审批桥。新服务在 `wireService` 里接。
- [`server.ts`](server.ts) 只做壳：鉴权、cookie、静态资源、`POST /api/bot`（转给 host 捕获的 route）、`GET /api/bot/feed` 的 SSE、`/healthz`、`/login`、relay 的 WebSocket upgrade。不要在 `server.ts` 里写业务；业务在 host 的 [`channel/`](../host/channel/)。
- [`main.ts`](main.ts) 只读环境变量并启动（`MOON_BOT_DATA`/`PASSWORD`/`WEB_HOST`/`WEB_PORT`/`UI`，旧名 `MOCHOU_*`/`DSH_BOT_*` 仍兼容）；桌面 app 的 `service-host.ts` 用 `startService` 起同一套。

## 鉴权边界

- 无密码只允许 loopback：非 loopback 且 `password === ''` 时 `startService` 直接抛错。
- `/login`、`/healthz` 和 relay 路径不走 UI cookie；其余请求都要 `mb-session`（HttpOnly、SameSite=Lax、签名 cookie）。
- 密码比较用 timing-safe，按客户端地址限速（5 次/10 分钟）；登录页和 JSON 两种回答都要保留。不要放宽这两条。
- relay 用自己的邀请码（`token` 查询参数），与 UI cookie 互不相通；无效或已吊销的连接以 4401 关闭。邀请码只存 hash（[`../store/relay.ts`](../store/relay.ts)），明文只在创建响应出现一次。

## relay 与 healthz

- relay 是盲转发：一帧一条 JSON-RPC 行，不解析、不存储、不重放；一个 `agentId` 一条连接，新连接顶掉旧的（关闭码 4000）。
- 断线是事实：该 agent 名下在跑的回合以 error 结束，历史保留；不自动重发 prompt。
- `/healthz` 回答 `{ ok: true }`，构建信息可用时带上 `revision`（`MOON_BOT_REVISION`，或镜像里的 `/opt/moon-bot/REVISION`），供 Docker healthcheck、`deploy/update.sh` 和部署验证使用；不要把它改成需要鉴权的端点，也不要让它去读团队数据。

## 数据与密钥

- home 下 `settings.json`、`credentials.json`（0600，写临时文件再 rename）与 host 的 `state.json`、`store.sqlite3` 分开；密钥永不进 state、SQLite、日志或诊断。
- 日志只打非敏感信息（服务 URL、是否设了密码这类）；加日志前先问「会不会把 key、cookie、邀请码、数据目录绝对路径写出去」。诊断文本经 [`../host/diagnostics.ts`](../host/diagnostics.ts) 的 `cleanText` 抹掉密钥和 home 路径。
- 附件在 `<home>/attachments/`（内容寻址 + 索引，[`attachments.ts`](attachments.ts)）；不要把用户文件写到工作区或 home 以外。

## 只做壳，不做业务

- 新增端点：先在 [`../shared/rpc.ts`](../shared/rpc.ts) 加 case 与类型，再在 host 的 [`channel/`](../host/channel/) 加 handler；service 只做协议转换、静态资源和鉴权，不承载业务规则。
- 审批：引擎的 gate 把待答请求交给 `approval/request`，由 [`approval.ts`](approval.ts) 的桥接到卡片；群聊的审批由 [`../host/approvals.ts`](../host/approvals.ts) 从群里答。不要在 service 里绕开 bridge 直接放行。
- 调度器（[`scheduler.ts`](scheduler.ts)）只做「到点把任务投递到会话」，业务状态在 tasks 表；它重启后从 `next_run_at` 恢复，不要改成纯内存定时器。

## 测试

- 服务测试在 `core/test/service.test.ts`、`service-turn.test.ts`、`service-providers.test.ts`、`service-failure.test.ts` 和 `relay.test.ts`；用临时 home，不连真实数据。
- 手工验证用 `core/dev/bench.sh` + [`../../dev/mock-llm.ts`](../../dev/mock-llm.ts)；浏览器级检查是 [`../../dev/e2e-web.mjs`](../../dev/e2e-web.mjs)。不要拿镜像或安装包当验证。
- 改了鉴权、cookie、relay 或 healthz 的行为，必须在同一 PR 里补测试；这些是边界，不靠肉眼。

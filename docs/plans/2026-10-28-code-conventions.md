# 代码约定升级：JSX 收窄、机械门禁与审批红线

- 日期：2026-10-28
- 相关：665e968（`Convert client UI modules to TSX and finish line-limit splits`）；[独立个人 Agent](2026-10-24-standalone-personal-agent.md) §阶段 5（策略引擎与审批）；根 `AGENTS.md` 与四个分区 `AGENTS.md`（`core/src/client`、`core/src/host`、`core/src/service`、`app`）

## 为什么

约定一直散在 `AGENTS.md`、`CONTRIBUTING.md` 和代码注释里，新来的 agent 和贡献者容易只看到一半：

- 665e968 的提交说明是「内建标签用 JSX，组件调用继续用 `h(Comp)`」。这半句被当成了永久规则，于是静态组件也一直写 `h(Comp)`，两种写法在同一个文件里混着；迁移没有终点。
- 能机械检查的边界（层依赖、350 行、测试 import `.tsx`、floating promise、设计 token、i18n 词条）已经进了 lint 或测试；不能机械检查的（什么时候保留 `h()`、测试怎么等状态、审批默认怎么算）没有写清楚，全靠口口相传。
- 审批、手机端、发布这三块的行为已经定了，但没有一处写给 agent 看：审批默认是什么、能不能加「全部放行」、手机端做不做原生 App、发布和 `REVISION` 是什么关系。

这份文档把这次升级定下来：**能把关的写进门禁，关不了的写成分区文档里的硬规则**。分区 `AGENTS.md` 的组织方式参考了同类开源项目的做法（根总纲 + 区域文件 + 能机械化的进 lint）；文字全部按 Moon Bot 的代码重写，没有复制任何外部项目的文字、代码或示例。

## 已定的行为

### JSX

- 内建标签（`div`、`span`、`button`…）一律 JSX。`h('tag')` 只允许出现在写不了 JSX 的上下文：纯 `.ts` 文件，或 props 要整体展开、children 在运行时拼的动态对象；每一处都要就地注释原因。
- 组件按「静态/动态」分：元素类型和 props 在源码里固定的，写 JSX `<Comp .../>`；元素类型来自变量（`h(entry.component, …)`）、props 来自外部对象、或上下文写不了 JSX 的，才保留 `h(Comp, ...)`。新代码不再新增静态 `h(Comp)`。
- 运行时不变：JSX 仍编译成 `h()`（`core/tsconfig.json` 的 `jsx: react` + `jsxFactory: h`，`core/scripts/build-client.ts` 的 esbuild `jsx: transform`）。不引入 `react/jsx-runtime`：宿主只提供 `react`/`react-dom`，`core/test/client-bundle.test.ts` 会断言 bundle 没有 jsx runtime 依赖。

### 门禁与「只能靠文档」的分界

| 规则 | 谁在检查 |
|---|---|
| 层边界（client 不 import host/engine/store/service；host 不 import client；shared 只 import zod） | `core/scripts/check-gates.mjs` |
| 逻辑文件 ≤ 350 行 | `core/scripts/check-gates.mjs` |
| 测试文件不 import `.tsx` | `core/scripts/check-gates.mjs` |
| 不悬空 promise；`dsh-types.js` 只能 `import type`；`.d.ts` 不导出值 | `core/scripts/check-gates.mjs` |
| 颜色/圆角/弹簧不写字面量 | `core/test/style-debt.test.ts` + `core/test/style-debt.json`（只减不增） |
| `t('…')` 词条都有中文 | `core/test/i18n.test.ts` |
| `client.js` 与源码一致；bundle 不依赖 jsx runtime | `core/test/client-bundle.test.ts` |
| app 与 core 版本一致 | `app/test/package.test.mjs` |
| 窗口的样式表组覆盖 core 的清单 | `app/test/ui-sheets.test.mjs` |
| 发布 tag 与版本一致 | `.github/workflows/desktop.yml` |
| 内建标签/静态组件必须 JSX | 暂无门禁：迁移完成后加进 `check-gates.mjs`，现在靠评审 |
| 测试等待用真实屏障、不许 sleep | 暂无门禁：靠评审 |
| 审批默认开启、不做全局放行 | `core/test/policy.test.ts` 锁等级、预算和拒绝文案；默认值靠评审与本文 |
| 迁移只追加、新库=升级库 | `core/scripts/check-gates.mjs` 不管；`core/test/sqlite-store.test.ts` 测重开幂等，parity 靠评审 |
| host 不 import kernel/ACP 实现 | `check-gates.mjs` 允许 host→engine，靠评审 |
| 窗口不直连数据目录 | 架构（preload + IPC）与 `app/test/` 部分覆盖，靠评审 |
| `main` 一直可发布 | 流程（`CONTRIBUTING.md`），无门禁 |

### 审批红线

- 审批默认开启：L0–L2 直接执行，L3/L4 在每会话每日预算内执行、超出后逐次审批（`core/src/engine/policy.ts` 默认 L3 20 次/日、L4 5 次/日）；审批经 `core/src/host/approvals.ts` 接到界面卡片和群聊。
- **禁止把产品滑向默认放行。** 不做 `approvalPolicy: never` 式的全局开关，也不做等价物：默认无限预算、默认自动允许、静默放行、不经用户就替 Bot 提权。该问的必须问，问到的请求要由用户答（允许一次/拒绝）才算数；拒绝文案不给出申诉口（`core/test/policy.test.ts` 锁住）。
- 「Always allow for this Bot」是用户为单个 Bot 调高权限预设（`core/src/client/approval-always.ts`），是一次显式操作，不是产品默认，也不是全局开关。
- 改风险等级表、每日预算、审批默认值或拒绝文案，都算改已定设计：先在 `docs/plans/` 写或改设计、和维护者确认，再动代码和测试。

### 手机端

- 先做响应式网页（阶段 D）：手机浏览器打开同一个服务地址，不引入原生 App，不写第二套移动端界面，也不做应用商店上架。
- 界面改动要能在窄屏用：侧栏可收起、主要操作不被遮挡、弹层不溢出视口（`app/ui/index.html` 已有 viewport meta）。
- 外网访问走服务的密码页与 HTTPS（证书与阶段 D 同源）；非 loopback 监听必须设 `MOON_BOT_PASSWORD`，`startService` 会拒绝裸奔。
- 桌面壳专有能力（窗口控制、自动更新、搬移数据、内置浏览器）不得进入共享组件；手机端和网页端走这些能力缺省的降级路径。

### 发布

- `main` 永远可发布：只有发布和 hotfix 进 `main`，合进去的代码三件套全绿、可直接打 tag。
- 发布走 tag：在 `main` 上打 `vX.Y.Z` 并建 GitHub Release，步骤在 [`docs/RELEASING.md`](../RELEASING.md)。`.github/workflows/desktop.yml` 在 `v*` tag 上出 Windows 安装包 / Linux AppImage / macOS zip 和更新元数据（预发布），`.github/workflows/web-image.yml` 先跑浏览器端到端（mock 模型）再把镜像推去 GHCR。
- 版本号（`core/package.json` = `app/package.json` = tag，用 `scripts/version.mjs` 改）对用户；`REVISION`（构建来源的短 sha，写进镜像 `/opt/moon-bot/REVISION`、image label，并由 `/healthz` 带出）对部署和排障。`deploy/` 是服务器入口：`install.sh` 首次安装，`update.sh` 更新并等 `/healthz`（不健康自动回滚），`rollback.sh` 手工回滚；数据放在部署目录的 `data/`（不进仓库），部署只换容器、不碰数据。

### 分区文档

- 根 `AGENTS.md` 只留通用规则；`core/src/client/AGENTS.md`、`core/src/host/AGENTS.md`、`core/src/service/AGENTS.md`、`app/AGENTS.md` 各写本区域的边界、文件放哪、自己的坑与硬规则。
- 新增区域要新建它的 `AGENTS.md` 并在根登记；能在 lint/门禁/测试里表达的约定先加门禁，不要只写文档；两份说法冲突时按更严的做，并改掉另一份。

## 与 665e968 的关系

665e968 做的是两件事：内建标签 `h('tag')` 改成 JSX（classic jsxFactory 不变），以及「组件调用保留 `h(Comp)`，供 ReactNode helper 使用」。本次**收窄**第二件事，不是推翻它：

- 保留：classic jsxFactory、`h()` 作为运行时、ReactNode helper 可以返回 `h(Comp)`（当它是动态组件时）。
- 收窄：静态组件不再保留 `h(Comp)`，改为 JSX；`h(Comp)` 只给动态组件和写不了 JSX 的上下文。
- 不变：JSX 仍编译成 `h()`，不引入 `jsx-runtime`；`h()` 仍是 `createElement` 的别名。

## 迁移状态

- **内建标签已强制**：665e968 完成迁移；写本文时只剩 4 处 `h('tag')`：`core/src/client/dsh-primitives.ts` 一处（纯 `.ts`，写不了 JSX）属于规则允许的例外；`core/src/client/engine-menu.tsx` 与 `core/src/client/mention-chips.tsx` 的其余三处是待迁移的存量，随迁移清零。
- **静态组件迁移进行中**：写本文时 `grep -rhoE '\bh\([A-Z]' core/src/client` 仍有约 600 处；新代码不再新增，存量按文件逐步迁移。
- **门禁待补**：JSX 形态还没有 lint 规则；迁移完成后在 `core/scripts/check-gates.mjs` 加「内建标签 `h('tag')` 与静态 `h(Comp)` 报错」的检查，并在这里更新门禁表。

## 不做什么

- 不复制、不改写、不引入外部项目的文字、代码或示例；只借鉴「根总纲 + 区域文件 + 能机械化的进 lint」这种结构。
- 不推翻 665e968，不切换 `react/jsx-runtime`，不换 React 版本。
- 不为无法机械检查的规则硬造 lint 规则（例如「测试要等真实屏障」），宁可写成区域文档里的硬规则。
- 不引入 `approvalPolicy: never` 或任何等价的默认放行开关。
- 不做原生手机 App，不做第二套移动端界面。
- 不重写 `deploy/**`、`.github/**`、`CONTRIBUTING.md` 里的流程（它们各有职责）；发布流程的细节仍以 `CONTRIBUTING.md` 为准。

## 已知限制

- JSX 形态、测试等待方式、审批默认值目前没有自动门禁，只能靠评审和本文；665e968 之后两种写法混在一处，就是没有门禁的后果。
- 迁移的「新库 = 升级库」没有自动 parity 测试，只有 `core/test/sqlite-store.test.ts` 的「重开幂等」和评审。
- 审批的「默认开启」靠 `core/test/policy.test.ts` 锁等级、预算和文案，不锁「不许加全局开关」这条红线本身。
- `core/src/service/engine.ts` 的 gate 注释和 `core/src/engine/policy.ts` 顶部注释都说 L4「always asks」，而实现是「L4 在每日预算内执行、超出才问」（`core/test/policy.test.ts` 锁的是实现）。本文按实现写；注释与实现的这处不一致留给设计评审决定，不顺手改行为。
- [浏览器与电脑的边界](2026-10-28-browser-and-computer-boundaries.md) 要求浏览器动作里的 L4（提交表单、登录、支付、删除账号）每次都问；当前 policy 的 L4 是预算内放行，实现浏览器动作时要先把两处口径对齐，再写代码。

## 变更

- 2026-10-28：定下约定升级（JSX 收窄、门禁分界、审批红线、手机与发布流程、分区文档），同时改写根 `AGENTS.md` 并新增四个分区 `AGENTS.md`。

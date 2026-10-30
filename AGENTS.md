# AGENTS.md

给在本仓库工作的 AI coding agent 的说明。人类贡献者看 [CONTRIBUTING.md](CONTRIBUTING.md)（同样的规则，更详细的流程）。各区域的边界和坑写在分区文档里，动手前先读对应那份（见文末「分区文档」）。

## 这个项目是什么

Moon Bot 是一支长期存在的 Bot 小队，跑在自己的运行时上，不安装 DeepSeek Harness。仓库是三个 pnpm workspace 包（见根 `pnpm-workspace.yaml`；过渡期仍用 `packages/core/` / `apps/desktop/` / `apps/connect/` 目录名）：

- `packages/core/`（`moon-bot-core`）：产品本体，TypeScript。`src/host/` 是 host 服务（roster 与 store、工具、回合与投递、群聊、对话分段、记忆、定时、能力、`api/bot` 通道）；`src/engine/` 是 `AgentRuntime` 接缝和两个实现（内置 pi kernel、ACP 适配器）；`src/store/` 是 SQLite 存储；`src/service/` 是 Fastify 服务和它的装配；`src/client/` 是 React 界面；`src/web-search/` 是 `auto` 搜索提供方。
- `apps/desktop/`（`moon-bot`）：Windows、Linux、macOS 的桌面应用，TypeScript。窗口加载 Moon Bot 自己起的服务地址；主进程经 esbuild 打包。
- `apps/connect/`（`moon-bot-connect`）：把本机 ACP agent 接到远程中转的一条命令，见 [远程 Agent 设计](docs/plans/2026-10-27-remote-agents.md)。

运行时：服务（鉴权、静态界面、SSE feed）、host 服务、SQLite 上的内置引擎、策略引擎、调度器和连接器层。`@earendil-works/pi-agent-core` + `pi-ai` 是仅有的 agent loop 依赖，其余都是我们自己的。

这个 Bot 小队：

- 每个 Bot 都是长期身份，它的工作在引擎会话里跑：自己的聊天一个、每个所在的群一个、上下文满了换一个新段（旧段仍可读）。一个回合跑在 Bot 指定的引擎上（内置引擎或 ACP agent），都在同一个 `AgentRuntime` 接口后面。
- 团队协作：Bot 之间可以发消息、共享群聊、看得到彼此在做什么；每个 Bot 仍独立工作，互不打扰。
- Bot 角色分明：Main Bot 权限最高，能创建、修改、删除其他 Bot；其他 Bot 没有这些权限。Main Bot 可以有多个。
- 用户可以定制每个 Bot（名字、角色标签、指令、模型、形象）。
- 行为必须可靠：Bot 依据证据行动、守在自己的目标里，结果可以被检查。

## 硬规则

1. **运行时必须是我们自己的。** Bot 功能走 host 服务和 `AgentRuntime` 接缝；kernel 留在接缝后面（内置引擎或 ACP 适配器），host 代码永远不直接调用它。`@deepseek-ai` 已从 `packages/core/`、`apps/desktop/` 的依赖里移除，不要加回来；`packages/core/src/host/host-types.d.ts` 只是历史接缝留下的**类型**声明（只能 `import type`），`apps/desktop/src/move-data.ts` 只把 `DSH_HOME`/`~/.dsh` 当作「别的应用的数据目录」来避开，都不是运行时依赖。
2. **不要密钥。** 永远不要写、打印或提交 API key、token、cookie 或数据目录里的密钥。测试用 mock 模型（[`packages/core/dev/mock-llm.ts`](packages/core/dev/mock-llm.ts)），不需要 key。
3. **只用原创材料。** 不要从别的产品或网站复制代码、文字、图标、logo 或图形。只有与 Apache-2.0 兼容的许可证是例外：写明出处，并把它的 notice 加进 `NOTICE`。
4. **`client.js` 和 `dist/` 是生成物，不提交。** 根 `postinstall` 在安装时构建它们；改 `packages/core/src/` 后运行 `pnpm run build`（或 `cd packages/core && pnpm run build`）。永不手改产物，永不提交产物（`packages/core/client.js`、`packages/core/dist/`、`apps/desktop/ui/dist/`、`apps/desktop/dist-main/` 都在 `.gitignore` 里）。
5. **不要碰用户自己的数据。** 应用把团队放在它自己的数据目录（`~/.moon-bot`）；测试把数据放在临时目录并删掉。永远不要把测试指向真实安装的数据。

## 命令

布局是 `apps/*`（`desktop`、`connect`）与 `packages/*`（`core`、`contracts`、`ui`）。workspace 共用根 `pnpm-lock.yaml`（**不要**再提交 `package-lock.json`）：在根装一次（`pnpm install` / CI 用 `pnpm install --frozen-lockfile`），然后按包运行脚本（在包目录里，或用 `--filter`，例如 `pnpm --filter moon-bot-core test`）。Node 22.18+ 直接跑 `.ts` 源码（原生类型剥离）；生成物（`packages/contracts/dist/`、`packages/ui/dist/`、`packages/core/client.js`、`packages/core/dist/`）由安装时的 postinstall 和 `pnpm run build` 构建，不提交。根 `package.json` 的 `pnpm.onlyBuiltDependencies` 列出允许跑安装脚本的包（SQLite 预编译、esbuild 等）。

**两个「pnpm」不要混：** 仓库包管理器是根 `packageManager` 字段里的 pnpm（当前 `pnpm@10.18.3`，`engines.pnpm` 与之对齐）。`apps/desktop` 依赖里的 `pnpm@11.7.0` 是**打进桌面端、给插件装依赖的 CLI 二进制**，不是本仓的包管理器；改仓库脚本/CI 时不要去动它的版本语义，web 镜像构建仍会删掉 `apps/desktop/node_modules/pnpm`。

**启用仓库 pnpm（新 clone）：** Node 自带 Corepack。在仓库根执行 `corepack enable`，再 `corepack prepare pnpm@10.18.3 --activate`（版本必须与根 `packageManager` 一致）；之后用 `pnpm install`。不要用 npm/yarn 装依赖，也不要提交 `package-lock.json` / `yarn.lock`。CI 与 Dockerfile 同样钉在这个版本（workflow 从 `packageManager` 读；镜像里 `corepack prepare` 写死同一号）。

```sh
pnpm install                           # 安装三个 workspace，然后构建 client.js 和 dist/
pnpm run build                         # 源码改动后重建产物
pnpm test                              # 单元测试（含一个断言 client.js 与源码一致）
pnpm --filter moon-bot-core run test:related  # 只跑碰得到改动的测试；迭代用，完成定义仍是三件套
pnpm run typecheck                     # 全 workspace tsc --noEmit（pnpm -r）
pnpm run lint                          # 全 workspace oxlint；core 另跑架构/行数/floating-promise 门禁
pnpm run check:static                  # typecheck + lint + format:check（根上一键；CI 的 test job 跑这个）
pnpm run format                        # Biome 仅 format（不替代 oxlint/gates；见 docs/format.md）
pnpm run format:check                  # Biome format 门禁（已含在 check:static）
pnpm run eval                          # 五项能力的评测集
pnpm --filter moon-bot run web         # 网页版：密码页 + 服务，默认 http://127.0.0.1:8290
```

改动完成的定义是 `pnpm test` 与 `pnpm run check:static`（= 全仓 typecheck + lint + Biome `format:check`）全绿；CI 在 `.github/workflows/test.yml` 上对每个 PR 从仓库根跑 `check:static`（不再只在 `packages/core` cwd），另跑 `pnpm run eval` 和泄漏扫描。`packages/core/dev/bench.sh` 起 mock 模型 + 构建后的服务，是开发用的实例，不是用户安装后的启动方式；每个 bench 用空闲端口，用完停掉自己起的所有 bench 和进程。

## 分支、PR 与 issue

完整流程在 [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work)。agent 必须遵守的部分：

- 从最新的 `dev` 开出 `fix/<issue>-<name>`、`feat/<issue>-<name>`、`docs/<name>` 或 `chore/<name>`。分支名永远不要以 `dev/` 开头。PR 进 `dev`，不进 `main`；只有发布和 hotfix 进 `main`。
- 用 `git merge dev` 更新分支。永不 rebase 已推送的分支，永不 force-push。
- 填 PR 模板。用 `Fixes #<number>` 关联 issue；bug 修复要写明修的是哪个 bug。用户可见的变化写进 Changelog 字段，不要改 `CHANGELOG.md`。
- 不要开始带 `maintainer` 标签的 issue 或 PR，它们等维护者。不要接已经指派给别人的 issue。
- 改行为之前，先读 `docs/plans/` 里对应的设计（以及 [docs/vision.md](docs/vision.md)）。改已定的设计需要维护者；新的大功能在同一个 PR 里附设计文档。
- 没有证据不要关 issue：修它的 PR 或 commit、它重复的 issue、或者不修的原因。
- 整理 issue 的步骤见 [CONTRIBUTING.md](CONTRIBUTING.md#issues)。

## 目录

- `packages/core/src/index.ts`：模块入口（模块顺序和 runtime 对象）。`packages/core/index.js`、`packages/core/client.js`、`packages/core/dist/` 都是生成物（永不提交）。
- `packages/core/src/host/`：host 服务（[分区文档](packages/core/src/host/AGENTS.md)）。
- `packages/core/src/engine/`：`AgentRuntime` 接口与事件、内置引擎（`builtin/`：pi 适配器、runtime、bridge、services）、ACP 适配器（`acp/`）、工具注册表、策略引擎、MCP 连接器。
- `packages/core/src/store/`：SQLite 存储——迁移、会话与消息、任务、记忆索引、策略计数、远程邀请（[迁移不变量](packages/core/src/host/AGENTS.md)）。
- `packages/core/src/service/`：Fastify 服务、host context、凭证与设置、服务商目录、调度器、附件、审批桥、记忆同步、引擎装配（[分区文档](packages/core/src/service/AGENTS.md)）。
- `packages/core/src/client/`：浏览器侧界面——侧栏、聊天、面板、主题、形象、Bot 浏览器面板（[分区文档](packages/core/src/client/AGENTS.md)）。
- `packages/contracts`（包名 `moon-bot-contracts`）：两端共用的契约（schema、rpc、views、OpenUI 转换、mentions、lean、model/connector catalog）。公开面是包 barrel（**具名** re-export，禁止 `export *`）：`import { … } from 'moon-bot-contracts'`。只依赖 `zod` 与自身文件，不得引入 React / Fastify / SQLite / Electron，也不得 import client/host/engine/store/service（`check-gates` + `shared-boundary` 测试）。
- `packages/ui`（包名 `moon-bot-ui`）：公用 React kit（`EmptyState`、`Field`/`Select`、`Row`/`Card`/`Switch`/`SwitchRow`/`InlineText` 与 `*_CSS`）。公开面是具名 barrel：`import { … } from 'moon-bot-ui'`。可依赖 React（peer）；不得 import host/engine/store/service/client 或 Fastify/SQLite/Electron（`check-gates` + `kit-boundary`）。样式用宿主已装的 `--bt-*`；kit 内弹簧 timing 用本地 `spring.ts`（不拖入整个 `client/motion`）。
- `packages/core/test/`：单元测试（`.test.ts`）和 fixtures；`packages/core/test/eval/` 是五项能力评测集。`packages/core/dev/`：mock 模型、测试台、冒烟检查、脚本。
- `apps/desktop/`：桌面应用（主进程与窗口、服务子进程、首次启动、搬移数据、安装包与更新）；`apps/desktop/ui/` 是窗口自己的界面，从 `packages/core/src/client/` 取 Bot 视图（[分区文档](apps/desktop/AGENTS.md)）。
- `apps/connect/`：`moon-bot-connect` CLI，把 ACP agent 经 WebSocket 中转接入。
- `docs/`：愿景（`docs/vision.md`）、已定设计（`docs/plans/`，中文）和发版 runbook（`docs/RELEASING.md`）。`docs/dev/release-checklist.md` 是发版前的真机检查单。
- `deploy/`：在服务器上运行网页版的入口（一次安装脚本、compose、更新与回滚脚本）。

## 代码风格

- 跟着改动周围的代码。函数小、名字直白。
- 只在原因不能从代码看出时才写注释：隐藏的约束、不变量、workaround。不要描述代码做了什么。
- commit 信息用英文，祈使句标题，原因写在正文。commit 保持小。
- 提需求的人是 commit 作者。不要把 AI agent 或 bot 设为作者/提交者，也不要给它加 `Co-authored-by` 行。
- 用户可见文案（产品界面）以英文为准，中文进 `packages/core/src/client/i18n/zh.ts`。README 中文优先、带英文一节，两边保持同步。
- 设计文档和 AGENTS 文档用中文写。

## 验证

一条改动算完成，只有 `pnpm test` 与 `pnpm run check:static`（全仓 typecheck + lint + Biome `format:check`）全绿。CI 另跑 `pnpm run eval`（五项能力，用脚本化端点，离线）和 `scripts/scan.mjs`（泄漏扫描）；本地默认不跑这两项，但泄漏扫描的规则要记在心里。

- **默认离线。** [`packages/core/dev/mock-llm.ts`](packages/core/dev/mock-llm.ts) 是脚本化的 mock 模型，不需要 key；测试和测试台的数据都在临时目录里，跑完删掉。
- **界面一律在 dev 实例上验证。** 用 [`packages/core/dev/bench.sh`](packages/core/dev/bench.sh) 起 mock 模型 + 本机服务（`packages/core/dev/bench.sh <name> <web-port> <mock-port> reset|start|stop`；它不是安装包），在浏览器/窗口里真实操作；改完源码先按需构建再刷新页面。
- **不要拿生成物或安装包当界面验证。** `client.js`、`dist/`、`apps/desktop/dist-pack/` 只能证明产物是最新的，证明不了交互；[`packages/core/test/client-bundle.test.ts`](packages/core/test/client-bundle.test.ts) 也只检查 `client.js` 与源码一致。浏览器级检查用 [`packages/core/dev/e2e-web.mjs`](packages/core/dev/e2e-web.mjs)（密码页、团队、一次问答，CI 用它），窗口截图用 [`apps/desktop/scripts/shot.mjs`](apps/desktop/scripts/shot.mjs)。
- **测试里等状态用真实屏障。** 用有超时、失败时报出观察值的 `waitFor`（如 [`packages/core/test/capabilities.test.ts`](packages/core/test/capabilities.test.ts)），或事件/`setImmediate` 的 tick（如 [`packages/core/test/styles.test.ts`](packages/core/test/styles.test.ts)）。禁止「先 sleep N 毫秒再断言」；没有真实屏障的测试会在慢机器上随机红。
- **费钱或在线的检查不算默认清单。** 真实模型上的 [`packages/core/dev/steward-eval.mjs`](packages/core/dev/steward-eval.mjs)、[`packages/core/dev/llm-tap.mjs`](packages/core/dev/llm-tap.mjs)，真机安装/更新检查，以及发版前的实机检查，都要先说明要花什么再跑。

## UI 写法

界面在 `packages/core/src/client/`，被两种宿主加载：服务托管的网页和桌面窗口（见 [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md)）。细节见 [`packages/core/src/client/AGENTS.md`](packages/core/src/client/AGENTS.md)。

- **内建标签一律 JSX。** `div`、`span`、`button` 这类原生标签写成 JSX，`h('tag')` 在两棵客户端树（`packages/core/src/client`、`apps/desktop/ui/src`）里由 `packages/core/scripts/check-gates.mjs` 的 `intrinsic-h` 门禁禁止，`.ts` 文件同样在内；需要在纯 `.ts` 里写内建标签时，把该文件改成 `.tsx`（`primitives.tsx` 就是这样来的），不要为了留在 `.ts` 而开例外。
- **组件：静态的写 JSX，动态的才留 `h()`。** 元素类型和 props 在源码里固定的，写成 `<Tick on={...}/>`；元素类型来自变量（`h(entry.component, …)`）、props 来自外部对象、或上下文写不了 JSX 的，才保留 `h(Comp, …)`。静态组件的 JSX 迁移正在进行，新代码不再写静态 `h(Comp)`。
- **JSX 仍然编译成 `h()`。** `packages/core/tsconfig.json` 是 classic transform（`jsx: react` + `jsxFactory: h`），[`packages/core/scripts/build-client.ts`](packages/core/scripts/build-client.ts) 用同一套；不要引入 `react/jsx-runtime`（宿主只提供 `react`/`react-dom`，[`packages/core/test/client-bundle.test.ts`](packages/core/test/client-bundle.test.ts) 会失败）。
- **设计 token 不写字面量。** 颜色、圆角、弹簧只用 `--bt-*` 变量和 [`packages/core/src/client/motion.tsx`](packages/core/src/client/motion.tsx) 的预设；门禁是 [`packages/core/test/style-debt.test.ts`](packages/core/test/style-debt.test.ts) + `packages/core/test/style-debt.json`（这份债只减不增）。
- **内建标签门禁**：`intrinsic-h` 只认 JSX，`h(Comp, …)` 仍允许（动态组件），fixture 在 `packages/core/test/fixtures/gates/intrinsic-h/`。
- **每个逻辑文件 ≤ 350 行**（[`packages/core/scripts/check-gates.mjs`](packages/core/scripts/check-gates.mjs)），按职责拆分，不要为过线塞注释。
- **文案进 `zh.ts`。** 所有用户可见文案走 `t('English key')`，中文在 [`packages/core/src/client/i18n/zh.ts`](packages/core/src/client/i18n/zh.ts)；[`packages/core/test/i18n.test.ts`](packages/core/test/i18n.test.ts) 会扫出没有中文的 key。动效要尊重 `reducedMotion()` / `prefers-reduced-motion`。

## 安全与审批

- **运行时是自己的**（硬规则 1）：Bot 功能经 host 服务和 `AgentRuntime` 接缝，kernel 在接缝后面。
- **审批默认开启。** [`packages/core/src/engine/policy.ts`](packages/core/src/engine/policy.ts) 按 L0–L4 风险分级：L0–L2 直接执行；L3/L4 在每个会话的每日预算内执行，超出后逐次审批（默认 L3 20 次/日、L4 5 次/日）。审批由 [`packages/core/src/host/approvals.ts`](packages/core/src/host/approvals.ts) 接到界面卡片和群聊，用户答一次或拒绝；「Always allow for this Bot」是用户给单个 Bot 调高权限预设（[`packages/core/src/client/approval-always.ts`](packages/core/src/client/approval-always.ts)），不是产品默认。
- **红线：不要让产品滑向默认放行。** 不做 `approvalPolicy: never` 式的全局开关，也不做等价物：默认无限预算、默认自动允许、静默放行、或不经用户就替 Bot 提权。该问的必须问，问到的请求要由用户答（允许一次/拒绝）才算数，不能由服务端或模型代答；拒绝文案不给出申诉口（[`packages/core/test/policy.test.ts`](packages/core/test/policy.test.ts) 锁住了这一点）。
- **改审批行为必须走设计文档。** 改风险等级表、每日预算、审批默认值、拒绝文案，都算改已定设计：先在 `docs/plans/` 写或改设计、和维护者确认，再动代码和测试。哪些动作必须每次问以设计文档为准（例如 [浏览器与电脑的边界](docs/plans/2026-10-28-browser-and-computer-boundaries.md) 规定表单提交、登录、支付、删除账号逐次审批，不受自动放行影响）。
- **密钥只进密钥文件。** 凭证在 `credentials.json`、用户密钥在 `secrets.json`（都 0600）；不写进 `state.json`、SQLite、日志或诊断。诊断文本经 [`packages/core/src/host/diagnostics.ts`](packages/core/src/host/diagnostics.ts) 的 `cleanText` 抹掉密钥和 home 路径。

## 手机端

- **先做响应式网页（阶段 D），不引入原生 App。** 手机浏览器打开同一个服务地址，不写第二套移动端界面；也不做 App Store/Play 上架。
- 界面改动要能在窄屏用：侧栏可收起、主要操作不被遮挡、弹层不溢出视口；`apps/desktop/ui/index.html` 已有 viewport meta。
- 外网访问走服务的密码页和 HTTPS（阶段 D 的证书与远程接入同源，见 [`docs/plans/2026-10-27-remote-agents.md`](docs/plans/2026-10-27-remote-agents.md)）；非 loopback 监听必须设 `MOON_BOT_PASSWORD`，`startService` 会拒绝裸奔。
- 手机端没有桌面壳的能力（窗口控制、自动更新、搬移数据、内置浏览器）；共享组件不得依赖这些能力（见 [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md)）。

## 发布

- **`main` 永远可发布。** 只有发布和 hotfix 进 `main`；合进去的代码必须三件套全绿、可以直接打 tag。
- **发布走 tag。** 在 `main` 上打 `vX.Y.Z` 并建 GitHub Release，流程写在 [`docs/RELEASING.md`](docs/RELEASING.md)：`.github/workflows/desktop.yml` 在 `v*` tag 上构建 Windows 安装包（NSIS + portable）与 Linux AppImage，连同更新元数据（`latest.yml`、`latest-linux.yml`、`.blockmap`）发布预发布；macOS 目前没有构建任务，要有时再加一个 job；`.github/workflows/web-image.yml` 先跑浏览器端到端（mock 模型），绿了才把镜像推去 GHCR（每次 `main` 推送带短 sha tag，`main`/`latest` 跟随 `main`，`v*` tag 再带版本号 tag）。镜像只由工作流发布，不手 publish。
- **CLI 单独发版。** `moon-bot-connect` 有自己的版本与 tag（`connect-vX.Y.Z`，`node scripts/version.mjs connect X.Y.Z`），发版走 [`.github/workflows/publish-connect.yml`](.github/workflows/publish-connect.yml)（需要 `NPM_TOKEN` 秘密），先跑 `pnpm --filter moon-bot-connect run verify:package` 验证的是 tarball 而不是 checkout。详见 [docs/RELEASING.md](docs/RELEASING.md)。
- **版本号用脚本改，不要手改一个。** `node scripts/version.mjs` 打印两个 manifest 的版本和它对应的 tag，`node scripts/version.mjs X.Y.Z` 同时写 `packages/core/package.json` 与 `apps/desktop/package.json`（[`apps/desktop/test/package.test.mjs`](apps/desktop/test/package.test.mjs) 会断言它们一致）；tag 就是这个版本，`desktop.yml` 会核对 tag 与 `apps/desktop/package.json`。`CHANGELOG.md` 由维护者在发版 PR 里写（PR 不改）。
- **版本号与 `REVISION` 是两样东西。** 版本号是用户看到的发布版本（manifest = tag）；`REVISION` 是这次构建来自哪个 commit（短 sha），镜像构建把它写进 `org.opencontainers.image.revision` 和 `/opt/moon-bot/REVISION`（[`Dockerfile`](Dockerfile)），`/healthz` 在有构建信息时把它带出来，[`deploy/update.sh`](deploy/update.sh) 部署后打印它。不要拿 `REVISION` 当版本号，也不要为每个 commit 升版本号。
- **服务器入口是 [`deploy/`](deploy/)。** 首次安装用 [`deploy/install.sh`](deploy/install.sh)（一条命令：写一次 `.env`、起容器、等 `/healthz`）；升级用 `deploy/update.sh`（记录当前 tag、拉取、重启、不健康自动回滚）或 `deploy/rollback.sh` 手工回滚。服务器拉已发布镜像，不在这里构建；数据落在部署目录的 `data/`（首次安装时创建为空，之后部署只换容器、不碰数据）。环境变量（`MOON_BOT_PASSWORD`、`MOON_BOT_DATA`、`MOON_BOT_WEB_HOST/PORT`、`MOON_BOT_WORKSPACE`）见 `deploy/.env.example`。

## 分区文档

根这份只放所有区域通用的规则；具体区域的边界、文件放哪、自己的硬规则写在区域文件里，动手前先读对应那份：

- [`packages/core/src/client/AGENTS.md`](packages/core/src/client/AGENTS.md)：界面层。只依赖 `moon-bot-contracts` 契约，不直接读 store/service；状态与渲染、`--bt-*` 与 reduced-motion、i18n、组件测试范式（esbuild + vm）。
- [`packages/core/src/host/AGENTS.md`](packages/core/src/host/AGENTS.md)：host 服务层。模块职责、`appendMessage` 唯一写路径、`state.json` 与 SQLite 的分工、迁移不变量，只走 `AgentRuntime` 接缝。
- [`packages/core/src/service/AGENTS.md`](packages/core/src/service/AGENTS.md)：服务层。`wireService` 唯一装配入口、relay/healthz/鉴权边界、数据与密钥不进日志、server 只做壳不做业务。
- [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md)：桌面壳。窗口与 Host 子进程的边界、窗口不直连数据目录、打包与自动更新、独立窗口与网页端共享同一套界面代码的规则。

新增一个区域时，新建它的 `AGENTS.md` 并在上面登记。能用 lint/门禁/测试机械检查的约定就加进 `packages/core/scripts/check-gates.mjs`、oxlint 或测试，不要只写在文档里。两份说法冲突时按更严的做，并改掉另一份。

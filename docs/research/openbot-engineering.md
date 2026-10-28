# OpenBot 工程实践对比：门禁、测试、发布与运维

- 对比对象：`/tmp/openbot`（OpenBot 0.52.1，PolyForm Noncommercial 1.0.0，只读浅克隆）
- 本仓库快照：`dev` @ v0.1.5（工作树干净）
- 法律边界：本文只引用对方的**文件路径**与**API/字段名**（例如脚本名、配置键、命令名），所有机制描述与判断用自己的话重写；没有复制对方的代码、注释、文档句子、示例或表格。对方许可证与本仓库 Apache-2.0 不兼容，因此下面每一条"可借鉴"只给做法和落点，不给可粘贴的实现。
- 方法：先读两边根 `AGENTS.md`，再读对方 `docs/architecture/change-rules.md`、`docs/development-checks.md`、`docs/RELEASING.md`、`docs/docker.md`、`docs/multi-tenant-hosting.md`，然后用 grep 定位实现；没有通读 170MB，也没有运行任何构建、测试或安装。

## 1. 摘要

1. 对方把"能机械判断的规矩"全部落成 CI 里的独立检查，并且每条检查都自带**正反例夹具**（一条规则匹配不到东西也算通过，所以他们用夹具证明规则会红）。我们已有等价骨架：`core/scripts/check-gates.mjs` 的七条门禁 + `core/test/lint-gates.test.ts` 的夹具树；但七条之外的设计 token、i18n、发布、部署仍靠人和评审。
2. 对方的存量治理几乎都是"基线只降不升"的棘轮，且有统一的 `--write`（只降）/`--add`（当前值起基线）语义，跑在一份公共实现上。我们只有 `core/test/style-debt.json` 这一处是棘轮，没有公共工具，所以每出现一种新债务就要再写一套。
3. i18n 是我们查实的漏洞：`core/test/i18n.test.ts` 的"缺中文"扫描只读 `core/src/client/` **顶层**文件（第 25 行），"死词条"扫描只认**带引号**的键（第 105 行）。结果是 `app/ui/src/composer-menu.tsx` 有 16 条 `t()` 文案没有中文、词典里 204 个无引号键不参与死词条检查——两处都是门禁自己看不见，而不是没写。
4. 测试策略两边几乎相反：对方"只写 E2E"、把单元测试限制在迁移、渲染进程/主进程信任边界、脱敏、规则夹具四类，本地用 `test:changed`/`test:related` 选测，CI 按**实测时长**分两片；我们是 137 个测试文件、约 990 个用例在 3 个 runner 上各跑一遍，没有选测、没有时长数据。反过来，我们的 CI 有浏览器全链路（`core/dev/e2e-web.mjs`）和 Windows 上"安装→升一版→卸载→数据保留"的实机演练，这两项强于对方的手工验收清单。
5. 发布链路的差距集中在两端：**发布前**缺一个能一屏拦下脏树、版本与 tag 不一致、tag 已存在、更新产物与 manifest 不符的 preflight；**发布后**缺 macOS 任务、签名与公证。镜像发布我们是通的（e2e 绿了才推 GHCR、`REVISION` 写进 label 与 `/opt/moon-bot/REVISION`），但缺 provenance 与匿名拉取校验。
6. 部署与多租户：对方的单机运维文档（可校验的备份、日志轮转、只读根、明确反对自动升级）比我们的 `deploy/` 细一档；我们最该补的是"升级前快照 + 旧镜像遇到新库时怎么办"，而不是去追多租户——沙箱、计费、root 守护进程、签名 PKG 这一整套在本阶段是负收益。

## 2. 分主题对比表

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| CI 编排 | `.github/workflows/ci.yml`：`detect` 车道按改动路径选 lane，`Check` 内先串后并（先桌面静态检查，再 i18n 与类型棘轮并行），`all-checks-pass` 汇总所有 job 的 result，`deploy-production` 需要全部绿 | `.github/workflows/test.yml`：`test` 矩阵 3 个 OS/Node 组合各跑 `npm test`+`typecheck`+`lint`+`eval`，另有 `scan`、`app`、`app-package`、`result` | 没有按改动选车道，全量 ×3；`result` 只串 4 个 job，语义上等价于对方的汇总 job，但没有"跳过即通过"的显式规则 |
| 本地检查面 | `AGENTS.md` 规定只跑最窄测试 + 单个 `typecheck:*` 项目；`.githooks/pre-commit` 跑 `check:staged`、`check:ui`、`scripts/staged-typecheck.ts`（按暂存文件选项目） | `core/scripts/lint.mjs` 一把跑 oxlint + 全部门禁；根 `AGENTS.md` 要求三件套全绿 | 我们的本地成本更高但结论更可信；缺"按改动挑项目"的帮手，也完全没有 git 钩子 |
| 设计系统预算 | `scripts/ui-foundation-check.ts`：禁用原生控件、限定 Kobalte/Lucide 只在设计系统内、禁内联色/字号/圆角/过渡字面量、扫死 CSS 类、`data-testid` 与复合 ARIA 预算为 0；`tools/ui-foundation/fixtures/{renderer,renderer-clean}` 双树 + `scripts/ui-foundation-check.test.ts` 逐行断言 | `core/scripts/style-debt.mjs` + `core/test/style-debt.json` + `core/test/style-debt.test.ts`（颜色/圆角/弹簧按文件+值计数，只降不升）；`check-gates.mjs` 的 `intrinsic-h` | 覆盖面窄：没有原生控件/ARIA/testid 规则；扫描范围只 `core/src/client`，`app/ui/src/app.css` 里的 `#fff` 落在预算外 |
| 类型与存量棘轮 | `scripts/type-ratchet.ts` + `tools/typescript/type-baseline.json` + 公共规则 `scripts/debt-ratchet.ts`（超基线红、低于基线也要 `--write` 才更新、`--add` 起基线） | `core/tsconfig.json` 已开 `strict`/`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`verbatimModuleSyntax`；无基线机制 | 我们的类型起点更严（对方还在为 `exactOptionalPropertyTypes` 攒基线）；缺的是**通用棘轮工具**，样式债务以外没有可复用的棘轮 |
| i18n | `scripts/i18n-check.ts`：键必须以模块前缀开头、不能跨模块重复、占位符与复数形态要一致、反向查找必须唯一、未使用的英文键报错、`--fix` 按英文顺序排、`--json` 出覆盖率报告 | `core/test/i18n.test.ts`：缺中文、死词条两件事 | 缺递归与跨树扫描、缺无引号键、缺占位符/复数/前缀校验、没有 `--fix`；已查实 16 条缺中文、204 个键不进死词条检查 |
| 死代码与未用依赖 | `knip.config.ts`：按 workspace 列 `entry`/`project`、`ignoreDependencies` 逐条写原因、用 `compilers` 把 CSS `@import` 翻成可追踪的 import | 无 | 未用导出与未用依赖没有任何检查；例：`app/package.json` 的 `pnpm` 依赖与 `app/src/host-process.ts` 传给子进程的 pnpm 参数已无消费者 |
| 文档链接与素材 | `scripts/check-doc-links.ts`（`git ls-files '*.md'`，查相对 md 链接与 `#anchor`，锚点按 GitHub 规则生成，跳过代码块）、`scripts/check-image-assets.ts`（图片/视频只许出现在白名单目录） | 无；`scripts/scan.mjs` 的 `FORBIDDEN_FILES` 只覆盖 `shots/`、`spec/` 这类本地目录 | 41 个受版本控制的 md、118 条相对链接、11 个带锚点的链接没有自动校验；"截图进仓库"只靠文化 |
| 门禁自证 | 每条 GritQL 规则配 `// flag` 正反例并由 `scripts/anti-slop-rules.test.ts` 校验；UI 检查双树夹具；`docs/development-checks.md` 明确记录"一条规则曾经匹配不到任何东西" | `core/test/lint-gates.test.ts` + `core/test/fixtures/gates/**`（floating 15 种写法、boundary、lines、tsx、d.ts、intrinsic-h、clean） | 夹具传统已有，但只覆盖 `check-gates`；`i18n.test.ts` 没有"这条检查能红"的夹具，`style-debt` 只有零散单测 |
| 上下文预算 | `scripts/agent-context-budget.ts` + `tools/agent-context/budget.json`：对一个无用户数据的 fixture agent 量 instructions、可见工具、schema/描述、guidance、`list_models` 结果的字节数，按棘轮规则只降不升 | 无；`core/src/host/prompt.ts` 的 `TEAM_RULES` 是长段常量 | 提示词与工具描述只会变长，没有任何预算；一块最贵的"代码"没有门禁 |
| 选择性测试 | `test:changed`（`vitest run --changed origin/main --maxWorkers=1`，先校验 merge-base）、`test:related`（`vitest related --run`）；`vitest.config.ts` 关掉 `forceRerunTriggers` 以免误选全量 | 无；`core/package.json` 的 `test` 是 `node --test "test/*.test.ts"` | 137 个文件全量跑；改一行也要等全套。Node 侧没有现成的依赖图选测 |
| 分片与时长 | `tools/vitest/balanced-sequencer.ts` 按 `tools/vitest/test-durations.json` 做贪心装箱（最长优先），未记录的文件按中位数；`scripts/test-durations.ts` 用一次全量跑重写时长表；CI 两片各 15 分钟上限 | 无分片、无时长数据 | 没有测量就没有分片依据；3 个 runner 各跑一遍全量，是当前最大的 CI 支出 |
| 等待规范与环境隔离 | `tools/biome/anti-slop/rules/no-sleep-in-tests.grit`（禁测试里 `await new Promise(r => setTimeout(r, N))`，配正反例）+ `tools/vitest/hermetic-setup.ts`（清 `*_API_KEY`/`*_TOKEN` 等、`TZ=UTC`、`HOME` 指向临时目录） | 根 `AGENTS.md` 的"测试里等状态用真实屏障"只靠评审；`core/test/harness-resolve.mjs` 每次运行给一个临时 home | 等待规则可机械化却仍靠人（`docs/plans/2026-10-28-code-conventions.md` 自己列为"暂无门禁"）；环境隔离不扫密钥变量、不固定时区 |
| 单元 vs E2E | `AGENTS.md`：只用 E2E（`scripts/*-e2e.ts` 驱动真实进程，结束时写可复核的产物），vitest 只允许四类受保护区域 | 单元优先：`core/test/*.test.ts` 约 990 个用例；`core/dev/smoke.mjs`、`core/dev/e2e-web.mjs`（CI 用）、`app/scripts/check-packed.mjs`/`check-update.mjs` | 路线相反，各有所长；我们的浏览器全链路与 Windows 安装-更新-卸载演练是对方手工清单里的项目 |
| 结构与边界 | `biome.json` 的 `noImportCycles` + `docs/architecture/structure.md` 的工作区图与依赖方向 + `docs/architecture/change-rules.md` 的十条 | `check-gates.mjs` 六层边界（含 service 组合根）、≤350 行、失效豁免检查；分区 `AGENTS.md` | 我们的层规则更细，而且有"豁免失效"这条对方没有；缺循环依赖检查，也没有一张可被引用的依赖方向图 |
| 发布：版本与 preflight | `scripts/release-preflight.ts`：semver、CHANGELOG 段落与公告、工作树干净、与 `origin/main` 同步、tag 不存在、`release` 环境秘密齐全、生产环境分支策略；`release.yml` 的 `validate` job 再核一次 tag | `scripts/version.mjs`（双 manifest 同写）+ `desktop.yml`/`publish-connect.yml` 的 tag 校验 + `app/test/package.test.mjs` | 缺"发布前一屏"：脏树、tag 已存在、秘密缺失、CHANGELOG 段落是否写好，现在都要人记 |
| 发布：平台与签名 | `release.yml`：macOS arm64/x64 各一台 runner 签名+公证+staple，Windows 走 Azure Artifact Signing，Linux 未签名；三平台全绿才 publish；附 SPDX SBOM 与 provenance；AppImage 只读挂载检查 | `.github/workflows/desktop.yml`：Windows（NSIS+portable）与 Linux AppImage，未签名，发成 pre-release | 缺 macOS job、签名与公证、SBOM/attestation；`docs/RELEASING.md` 与 `AGENTS.md` 已把 macOS 写成"要有时再加" |
| 发布：更新产物 | `scripts/verify-update-artifacts.ts`：每平台只许一个更新产物、核对 manifest 里的 size 与 sha512、要求 blockmap、700/750MiB 上限、查 asar 内重复原生运行时与不该入包的模型 | `desktop.yml` 上传 `latest*.yml` 与 `.blockmap`；`app/scripts/check-update.mjs` 在 CI 里真下载真安装（sha512 由 electron-updater 校） | 增量更新其实是通的（blockmap 都在）；缺的是**发布端独立核对**：manifest 与产物是否配对、体积上限、不该入包的东西 |
| 发布：镜像 | `release.yml` 的 `docker`/`docker-publish`：从 AppImage 建镜像、按架构 tag、join 成版本 tag、attest provenance、校验匿名可拉 | `.github/workflows/web-image.yml`：e2e 绿后 push `:short`/`:main`/`:latest`/`:vX.Y.Z`，`REVISION` 作 build-arg | 缺 provenance/attestation、缺匿名拉取校验、缺按架构（arm64 用户只能跑 amd64 镜像） |
| 部署：单机 | `docs/docker.md`：`docker/instances/` 的 systemd 封装、只读根 + tmpfs、LXCFS 修 CPU 视图、rsyslog+logrotate、`backup`/`verify`（校验和 + `integrity_check` + 计数）、升级**不自动** | `deploy/install.sh`、`update.sh`（`.previous` 记镜像、不健康自动回滚）、`rollback.sh`、`docker-compose.yml`（healthcheck） | 我们缺：升级前快照与恢复、日志落盘与轮转、资源上限、只读根；回滚只回镜像不回数据 |
| 部署：多租户 | `docs/multi-tenant-hosting.md` + `docs/hosted-servers.md`：一租户一沙箱、Stripe 计费、root LaunchDaemon、签名 PKG、目标机验收清单；文档自己写明"不提供对恶意租户的资源隔离" | 无；单机 compose，`--name` 可在同一台机器起第二个实例 | 本阶段不该做；前置条件是账号、配额、隔离、计费、支持，任何一项缺失都会把运维成本转成数据风险 |
| 可观测与诊断 | `packages/logging`（ts-log + 脱敏 + 登记具体密钥值后全局掩码）、`src/main/trace-file.ts`（有界 NDJSON，固定 span 名、不含载荷、2 文件轮转）、provider 日志、资源监视、telemetry 包、状态页与 webhook | `core/src/host/diagnostics.ts`（内存 + `logs/diagnostics.jsonl` + `cleanText` 抹密钥与 home）、`core/src/client/feedback.tsx`（一键生成带诊断的 GitHub issue）、`/healthz` 带 `revision` | 诊断的"脱敏 + 一键上报"我们做对了；缺结构化追踪（看不出哪一步慢/挂）、缺崩溃与资源记录、缺日志落盘轮转 |
| 文档制度 | `changelog.d/<branch>.md` 片段 + CI 强制（无片段且无 `no-changelog` 标签即红）+ `scripts/release-notes.ts` 的格式校验 + `structure.md` 工作区图 + 各目录 `AGENTS.md` | PR 模板的 Changelog 字段（无校验）、`docs/plans/`、分区 `AGENTS.md`、`scripts/scan.mjs` 泄漏扫描 | 缺片段式 changelog 与格式校验；更缺**文档与规则的一致性检查**：PR 模板仍要求"提交 `client.js`"并跑已不存在的 `scripts/build-client.mjs`，`CONTRIBUTING.md` 也还在教这条 |

### 读表备注（几条需要说清楚的证据）

- **i18n 的两处盲区是查实的，不是推测**。`core/test/i18n.test.ts:25` 用的是 `readdirSync(dir)`，不递归，所以 `core/src/client/design/`、`core/src/client/vendor/` 以及整棵 `app/ui/src` 都不在"缺中文"的扫描范围内；第 105 行解析词典键的正则只匹配带引号的键，而 `core/src/client/i18n/zh.ts` 里有 204 个键是无引号的（例如 `Open: '打开'`）。我按同一套规则写了个一次性脚本核对：16 条 `t()` 文案落在 `app/ui/src/composer-menu.tsx`，该文件被 `app/ui/src/chat.tsx:18` 真实引用。
- **样式预算同样只扫一棵树**。`core/test/style-debt.test.ts:8` 调 `findStyles()`，默认目录是 `core/src/client`；`app/ui/src/app.css` 里有两处 `#fff`，按规则该进债务表，但没人看得见。
- **回滚的真实行为不是"回到旧版"，而是"停在新库上"**。`core/src/store/db.ts` 在 `user_version` 大于代码已知迁移数时直接抛错；`deploy/update.sh` 回滚只把容器换回旧镜像、不碰 `data/`，于是旧镜像启动即失败，`update.sh:64` 打印"旧镜像也没起来"后退出 1，实例保持下线。也就是说我们的自动回滚在"这次发布带迁移"时是失效的，而它看起来是成功的兜底。
- **`deploy/` 没有任何备份能力**。`grep backup deploy/` 无结果；`update.sh` 唯一的保护是 `.previous` 里的镜像 id。
- **预发布与自动更新是一对跨文件约定，没有门禁**。`desktop.yml` 发的是 `--prerelease`，`app/src/main.ts:237` 设了 `allowPrerelease = true`；两处任一改动都会让已安装的用户收不到更新，而没有任何检查盯着这个组合。
- **一份失效的旧门禁还留在树里**。`core/package.json` 的 `test:gate` 指向 `core/scripts/test-gate.mjs`，它跑 `test/*.test.js`、读 `core/test/known-red.json`（基线 883 个用例）、依赖已不存在的 `core/dev/harness`。它不在 CI 里，但名字看起来像门禁——这正是对方文档里警告的"看起来在检查"。

## 3. 可借鉴清单（编号 10–25，共 16 条）

工作量：S ≈ 半天以内、单文件级；M ≈ 1–2 天、跨 2–4 个文件并要写夹具；L ≈ 3 天以上或需要外部账号/机器。

### 10. 把"基线棘轮"抽成一个公共工具，不再一种债写一套
- **想法**：一个 `ratchet({baseline, count, noun, --write 只降, --add 起基线})` 的公共实现，基线文件按"检查名 → 文件 → 计数"存，超基线红、低于基线也要 `--write` 才更新。
- **为什么值得**：我们已经有 `style-debt.json` 这个形状，但逻辑锁在 `core/test/style-debt.test.ts` 里；下一处债务（JSX 存量、提示词字节、伪门禁清单）只能再抄一遍。对方把它做成公共件后，新增一种债的成本是一份计数函数。
- **落点**：新增 `core/scripts/ratchet.mjs`；`core/scripts/style-debt.mjs` 改成它的一个计数器；测试放 `core/test/ratchet.test.ts`。
- **工作量**：S
- **依赖顺序**：先做，11/16/25 都用它。
- **风险**：这是纯机制，不碰产品行为，无红线风险。唯一要守住的是"`--write` 只降不升"，否则基线会被人手改高而没人看见。

### 11. 给静态 `h(Comp)` 存量上棘轮，把已定的 JSX 规则从"靠评审"变成"靠数字"
- **想法**：数 `core/src/client` 与 `app/ui/src` 里元素类型为字面组件的 `h(...)` 调用，按文件记基线，只降不升；新代码再加一处就红。
- **为什么值得**：`docs/plans/2026-10-28-code-conventions.md` 写了"新代码不再新增静态 `h(Comp)`"，同一份文档又承认没有门禁，结果是两种写法长期混在同一文件里（写这份设计时约 600 处）。对方的做法证明：迁移中的规则用棘轮，比"迁移完再加门禁"现实。
- **落点**：`core/scripts/check-gates.mjs` 新增一条计数（复用已有的 TS AST 遍历）或作为 `ratchet.mjs` 的计数器；基线 `core/test/jsx-debt.json`；夹具放 `core/test/fixtures/gates/jsx/`（一个文件同时含 `h('div')`、`h(Comp)`、`<Comp/>`）。
- **工作量**：S
- **依赖顺序**：依赖 10；与 11 同期可做的是 12。
- **风险**：计数规则要写清"动态组件豁免"，否则会把 `h(entry.component, …)` 也算进来，逼人加例外注释；例外只能走"少算"，不能走"多算"。

### 12. 把"测试里不许 sleep"做成门禁，并配一棵会红的夹具
- **想法**：在 `check-gates.mjs` 里加一条：测试函数体内的语句位置出现"只为等时钟"的 `await new Promise(...setTimeout...)` 即报错；假定时器、模拟延迟的 fixture 不算。
- **为什么值得**：根 `AGENTS.md` 已经有这条硬规则，`code-conventions` 又把它列进"暂无门禁"。这种规则最容易在赶工时被违反，而且违反后表现为"慢机器上随机红"，是最贵的一类故障。对方用一条 GritQL 规则 + 正反例夹具解决，我们用现成的 compiler API 就能做同样的事。
- **落点**：`core/scripts/check-gates.mjs`（新 finding 组 `testSleep`）+ `core/test/fixtures/gates/sleep/`（`bad.test.ts` 标出每个该报的行、`ok.test.ts` 放 `waitFor`、事件、fake timer 等合法形态）+ `core/test/lint-gates.test.ts` 断言行号。
- **工作量**：S
- **依赖顺序**：与 11 并行；夹具写法参考 25。
- **风险**：误报会挡住正常测试（比如为了模拟"慢响应"而 sleep 的 fixture）。规则要窄：只认 `it/test` 体内、语句位置、延迟是字面量的写法，其余一律放过。

### 13. i18n 门禁补盲：递归、跨树、无引号键、占位符
- **想法**：把"缺中文"的扫描从 `core/src/client` 顶层扩到 `core/src` 全树 + `app/ui/src`，把"死词条"的键解析扩到无引号键；再加两条便宜的校验：中英文占位符集合必须一致、复数形态必须两边同形。
- **为什么值得**：现在有 16 条真实缺中文的文案在桌面窗口里显示英文（`app/ui/src/composer-menu.tsx`），而门禁是绿的。这是"门禁绿但产品错"的最坏形态，比没有门禁更危险。
- **落点**：`core/test/i18n.test.ts` 的两个扫描 + `core/src/client/i18n/zh.ts` 补 16 条；夹具 `core/test/fixtures/i18n/`（一棵含子目录与无引号键的小树）。
- **工作量**：S
- **依赖顺序**：独立，可先做。
- **风险**：扩范围后可能一次冒出更多缺条目，要先跑一遍看总量再决定是否分两次提交；不要为了让测试变绿而放宽规则。

### 14. 加一个文档链接与锚点检查，再加一条"模板不许和硬规则冲突"的检查
- **想法**：用 `git ls-files '*.md'` 找相对 md 链接与 `#anchor`，锚点按 GitHub 规则从标题生成；另外用几条小的"禁止串"检查 `.github/**`、`CONTRIBUTING*.md`（例如不许教人提交 `client.js`、不许引用不存在的脚本路径）。
- **为什么值得**：41 个 md、118 条相对链接、11 个带锚点的链接，现在全靠人读；而 PR 模板正在教人"提交 `client.js`"（违反硬规则 4，该文件在 `.gitignore` 里）并跑已改名的 `scripts/build-client.mjs`。模板是贡献者最先读的东西，它错一次，错的是每一次 PR。
- **落点**：`scripts/check-docs.mjs`（链接 + 禁止串两张表）；CI 挂到 `test.yml` 的独立 job；允许清单写在脚本里并注明原因。
- **工作量**：S
- **依赖顺序**：独立；先修模板再开门禁，否则第一天就红。
- **风险**：禁止串容易写成"抓关键词"，会误伤正当引用（比如 `docs/plans/` 里解释历史的段落）。做法上按"路径 + 句式"匹配，并且允许清单要写理由。

### 15. 补一层"未用导出/未用依赖"的检查
- **想法**：引入 knip（或先写一个最小版：对每个 workspace 的入口做导入图，报出没有任何入口可达的 `src` 文件与 `package.json` 里没人 import 的依赖）。
- **为什么值得**：这是唯一一类"删掉就变好、但没人知道自己该删"的问题。已经有一个实例：`app/package.json` 声明了 `pnpm`，`app/src/main.ts:108` 把它传给 `HostProcess`，而子进程侧（`core` 的服务入口）没有任何代码读这个参数——一整个包管理器的依赖和一条死线，靠人读代码才发现。
- **落点**：根 `knip.json`（按三个 workspace 写 `entry`/`project`）或 `scripts/unused.mjs`；CI 的新 job。
- **工作量**：M
- **依赖顺序**：独立；建议排在 13/14 之后，因为它会一次冒出较多存量。
- **风险**：误报会把"给外部用"的导出标成死代码（我们的 `core` 是 npm 包，`src/index.ts` 是公开入口）。第一版必须只报**依赖**、不报导出，等清单干净了再扩。

### 16. 给"模型看到的那段文字"设字节预算
- **想法**：对一个固定的 fixture Bot 量 `core/src/host/prompt.ts` 的指令文本、工具目录里每个工具的 schema 与描述、以及模型列表结果的字节数，按棘轮只降不升。
- **为什么值得**：这是我们最贵的代码——每一次回合都要付一遍 token，而且它只会变长。对方把它做成了和类型棘轮同一套规则，说明"提示词也是需要预算的工程产物"。
- **落点**：`core/src/host/prompt.ts`（读数来源）、`core/src/engine/registry.ts`（工具 schema/描述）、新增 `core/scripts/context-budget.mjs` + `core/test/context-budget.json`。
- **工作量**：M
- **依赖顺序**：依赖 10；排在 11/12 之后。
- **风险**：预算一旦定得太紧，会逼人删掉有用的行为约束（比如审批话术），那是拿安全换 token。做法：先只观测（打印不拦），看两三个版本的实际增长再定基线。

### 17. 加 `test:related`：按改动选测，而不是全量
- **想法**：用 TypeScript 的模块解析从改动的文件反查"导入了它的测试文件"，只跑这些；没有命中时明确打印"没有相关测试"，而不是静默绿。
- **为什么值得**：137 个文件的全量跑现在既是本地等待成本，也是 CI 的 3 倍支出；我们自己已经有 compiler API 的使用经验（`check-gates.mjs` 的 floating promise），做导入图是同一套工具。
- **落点**：新增 `core/scripts/related-tests.mjs`；`core/package.json` 加 `test:related`；根 `AGENTS.md` 的"验证"一节改成"改动完成仍要全量三件套，迭代中用 `test:related`"。
- **工作量**：M
- **依赖顺序**：独立；与 18 共用一次"跑全量拿数据"的机会。
- **风险**：选测漏跑会导致"本地绿、CI 红"，若把它当成完成标准就会让红线松动。定位必须是"开发迭代用"，完成定义仍是全量。

### 18. 先量时长，再谈分片
- **想法**：跑一次全量，把每个文件的耗时写进一张表；分片时按耗时做贪心装箱（长的先放），未记录的文件按中位数；CI 从 2 片起步。
- **为什么值得**：不测就分片等于按文件大小切，通常把最慢的几个切到一片里，等于没分。对方文档里记着按大小分的极端结果，也记着"同一提交连跑几次，墙钟能差三成，所以要看测试总耗时与并发的比值"——这类测量纪律比脚本本身更值钱。
- **落点**：`core/test/durations.json`、`core/scripts/test-shard.mjs`（按表选文件后 `node --test <files>`）、`.github/workflows/test.yml` 的 `matrix.shard`。
- **工作量**：M
- **依赖顺序**：依赖 17 的同一次全量跑；在 18 之前不要动 `test.yml` 的矩阵。
- **风险**：分片会把"某个文件静默没跑"变成看不见的失败。分片脚本必须断言"所有文件恰好被分配一次"，并打印每片文件数。

### 19. 测试环境隔离补齐：密钥变量、时区、语言
- **想法**：在 `core/test/harness-resolve.mjs` 里先清掉 `*_API_KEY`/`*_TOKEN`/`*_SECRET`/`*_PASSWORD` 这类变量，固定 `TZ=UTC`、`LANG=C.UTF-8`，再把 home 指到临时目录（这一步已有）。
- **为什么值得**：现在唯一挡住"测试打到真 provider"的是"所有测试都用 mock"这个约定；一旦有人写了一条会回落到真实 provider 的测试，它就会读到开发者 shell 里的 key。这也是"不要密钥"硬规则在测试面的延伸。固定时区则消除一类只在某些机器上出现的日期/定时器差异。
- **落点**：`core/test/harness-resolve.mjs`；`core/test/harness-resolve.test.mjs` 断言清理生效（用一个明显是假的 key 起进程，断言测试内看不到）。
- **工作量**：S
- **依赖顺序**：独立，可随时做。
- **风险**：清理范围过宽会弄坏"故意要读某个环境变量"的测试；清理表要写成显式列表，并在测试里给出"需要时自己设"的写法。

### 20. 发布 preflight：一屏拦下发不出去的版本
- **想法**：一个脚本在打 tag 前跑完：两个 manifest 版本一致且是 `X.Y.Z`、tag 未被占用、工作树干净、与 `origin/main` 同步、`CHANGELOG.md` 里有该版本段落且不含占位符、必需的仓库秘密存在（`gh secret list`）。
- **为什么值得**：我们现在这些检查散在 `desktop.yml`、`publish-connect.yml`、`app/test/package.test.mjs` 里，各自只覆盖一段；最容易出的事故（版本升了一半、tag 打重、脏树里带进别的改动）没有任何一处能一次拦住。刚发完 v0.1.5，下一个版本的边际收益最高。
- **落点**：新增 `scripts/release-preflight.mjs`；`docs/RELEASING.md` 的"Cutting a release"第 1 步改成"先跑 preflight"；`desktop.yml` 保留现有 tag 校验（tag 是最后一道）。
- **工作量**：S
- **依赖顺序**：独立；建议先于任何发布流程改动。
- **风险**：脚本要能离线跑，不能依赖 `gh` 才能通过（没有网络时应"跳过并说明"，而不是红）。秘密检查只报告"缺哪个"，绝不打印值。

### 21. 发布端自检更新产物：manifest 必须对得上文件
- **想法**：发布前对每个平台核对"恰好一个更新产物 + manifest 里的 size 与 sha512 与磁盘一致 + blockmap 存在（AppImage 内嵌要大到能证明可增量）+ 体积上限"。
- **为什么值得**：electron-updater 在客户端发现 manifest 不匹配时只会"更新失败"，用户看到的是"检查更新出错"，我们要靠 issue 才知道。CI 里 `check-update.mjs` 会真装一次，但它验的是"我们自己造的 feed"，不是"要发布的那两个文件"。
- **落点**：新增 `app/scripts/check-release-assets.mjs`，在 `desktop.yml` 的 windows/linux job 里、上传 artifact 之前跑；上限写进脚本常量。
- **工作量**：S
- **依赖顺序**：独立；与 20 一起构成"发布前"。
- **风险**：几乎没有。唯一的坑是把预发布与正式发布的产物规则写成两套；只写一套，参数化平台。

### 22. 镜像：加 provenance，并在发布后验一次匿名拉取
- **想法**：`web-image.yml` 的 build-push 打开 provenance/SBOM，推送后用匿名 token 拉一次 `:short` 与 `:vX.Y.Z`，失败就红。
- **为什么值得**：`REVISION` 已经能证明"跑的是哪个 commit"，但不能证明"这个镜像是这条 workflow 从那个 commit 构建的"。GHCR 的包默认私有，推送成功不代表别人拉得到——对方专门为此写了一条发布后校验。
- **落点**：`.github/workflows/web-image.yml`（`provenance: true`、`sbom: true`，以及一个 `docker pull` 校验步骤）。
- **工作量**：S
- **依赖顺序**：独立；可与 21 同批。
- **风险**：匿名拉取校验要求包是 public；如果我们保持私有，就改成"用只读 token 拉"，并在文档里写明这条替代。

### 23. 部署：升级前快照 + "旧镜像 vs 新库"的显式判定 + 一次真回滚演练
- **想法**：`update.sh` 在 pull 成功后、`up -d` 之前打一份数据快照（`data/` 打包，或至少 `store.sqlite3` 的 `VACUUM INTO` 副本 + `state.json`）；容器起不来时，先看新库的 `user_version` 是否已被这次启动迁移过，如果是，**不要**回滚镜像，而是明确报"数据已升级，回滚需要恢复快照"并给出恢复命令。
- **为什么值得**：这是目前唯一会"看起来兜住了、实际兜不住"的地方（见读表备注第 3 条）。一个刚发布的版本，最贵的故障是"升级失败且回不去"。
- **落点**：`deploy/update.sh`（快照 + 判定 + 提示）、`deploy/rollback.sh`（`--restore <snapshot>`）、`deploy/README.md`；演练放进 `test.yml` 的一个 ubuntu job（起 compose、升级到不存在的 tag、断言"什么都没变"，再升级到会失败的 tag、断言回滚或明确提示）。
- **工作量**：M
- **依赖顺序**：独立，与 20/21 无依赖关系，但要在下一个版本打 tag 之前完成。
- **风险**：备份命令会短暂停写（SQLite 在线备份可以不停），要在文档里写清"快照期间服务可用/不可用"。红线方面：这条不引入任何自动更新通道，也不把 docker socket 交给容器——保持"运维手动升级"的现状。

### 24. 有界追踪文件：只记"哪一步、多久、结果"，不记载荷
- **想法**：写一个 `logs/trace.ndjson`，每行是一个固定名字的 span（通道名、回合来源、崩溃来源、退出原因）加耗时与结果词，不含消息、路径、URL、ID；两个文件轮转，超过上限丢新行而不是堆内存。
- **为什么值得**：`core/src/host/diagnostics.ts` 已经能给出"哪条错误"，但给不出"哪一步慢/卡住"；用户报"点了没反应"时，我们只能猜。追踪不含载荷，因此可以直接进现有的诊断导出，不破坏"诊断可以公开贴"的性质。
- **落点**：新增 `core/src/host/trace.ts`（写文件 + 轮转 + 丢弃策略），在 `core/src/service/server.ts` 的请求入口与 host 的回合边界打点；`diagnostics.ts` 的导出加一段摘要。
- **工作量**：M
- **依赖顺序**：独立；建议排在诊断相关改动之后。
- **风险**：最容易犯的错是"顺手把 payload 写进去"，那会让诊断文件变成隐私文件。规则要写进 `core/src/host/AGENTS.md`：span 只能有固定名字、耗时、结果词。

### 25. 门禁自证制度：每条规则必须有一个"能变红"的夹具，且断言写在 lint 里
- **想法**：任何新增的预算或规则，同时提交一棵最小夹具树（一条该报的行 + 一条不该报的邻近行），并在 `core/test/lint-gates.test.ts` 里断言具体文件行；没有夹具的规则不允许合并。
- **为什么值得**：我们现在已经有这个传统的雏形（`test/fixtures/gates/**`），但它只覆盖 `check-gates`；`i18n.test.ts` 与 `style-debt` 的部分检查从没被证明过会红——而 13 号问题正是"检查一直在，但从来看不见"。对方的文档里反复记录同一件事：规则匹配不到任何东西时，输出和通过一模一样。
- **落点**：`core/test/lint-gates.test.ts`（扩成"所有门禁的自证入口"）、新增 `core/test/fixtures/i18n/`、`core/test/fixtures/style/`；`docs/plans/2026-10-28-code-conventions.md` 的门禁表增加"夹具在哪"一列。
- **工作量**：S
- **依赖顺序**：应最先立规矩，10–13 都按它写。
- **风险**：夹具写多了会让测试变慢且难维护。约束：每个夹具树不超过几个文件，只放"最能区分红绿"的两三行。

## 4. 明确不要借鉴

1. **多租户托管（沙箱 + 计费 + root 守护进程 + 签名 PKG）**。对方自己写明这套不提供对恶意租户的资源隔离，并且把"目标机验收"列为面向付费客户的前置门槛。我们的阶段是单机/小队自托管，做这套要先有账号体系、配额、隔离审计、支持流程和计费，任何一项缺失都会把风险从"功能没做"转移到"用户数据出事"。等价能力已经够用：`deploy/` 的 `--name` 可以在同一台机器起第二个实例。
2. **内建产品遥测**（事件模式、归因字段、自建分析服务）。与"不要密钥""数据留在本地"的立场冲突，而且它需要一套长期维护的隐私契约与 schema 版本管理。我们现在的信号来源是用户主动上报的诊断，这已经够支撑当前规模。
3. **容器内自助升级**（产品界面里点一下就让宿主机 root 去 pull 并重建容器）。这条把"产品进程"接到"root 权限路径"上，攻击面与误操作面都放大；对方为此写了请求目录、只读状态目录、systemd path unit 一整套隔离。我们保留"运维手动 `update.sh`"这个现状，是更省的正确答案。
4. **"只写 E2E、不写单元测试"的测试政策**。这条成立的前提是他们有一整套驱动真实 Electron/进程的脚本与产物约定；我们最强的回归网正是那约 990 个单元用例。照搬会先丢掉回归网，再拿到一堆跑得慢、更难定位的失败。
5. **把宽检查全部推给 CI、本地只跑最窄的子集**。这是对方为了不压垮开发机做的取舍（他们的 `AGENTS.md` 明确说是用户偏好）。我们的"改动完成 = 三件套全绿"是在本地就能拿到的结论；改成只跑窄检查，等于让 agent 和贡献者把判断权交给 CI 排队时间。
6. **用第三方类型检查器替换 `tsc`**。对方用 Rust 版 tsc 换取速度，同时在自己的文档里记着"两者会报不同的错误，所以某个平台不做类型检查"。我们现在的 `tsc` 已经够快，引入一个新二进制只增加打包、审计与"和编辑器不一致"的成本。
7. **预提交钩子自动改写并重新暂存**。它解决的是"格式工具会改文件"的问题，我们没有那个工具；而它会和"生成物不提交""永不手改产物"的规则互相干扰（钩子 stage 的东西可能正是被禁止提交的产物）。要拦的是内容错误，不是格式。
8. **本阶段补 macOS 构建、签名与公证**。这是真实缺口，不是坏主意，但它需要 Apple 开发者账号、证书保管、公证流程与一台 macOS runner，且必须在有 macOS 用户之前完成才有意义。顺序应该是"先有 macOS job（未签名、只做打包与启动检查）→ 再谈签名"，而不是反过来。同理，SPDX SBOM、Azure 签名这类合规级产物也留到有分发要求时。
9. **CLA / 贡献政策机器人**。这是治理决定，不是工程实践，而且我们的贡献者规模还不需要它；引入会改变 PR 流程本身，属于维护者决策范围。

## 5. 建议的前 3 个动作

### 动作 1：修 i18n 门禁的两处盲区，并补齐 16 条文案（S）
- **开工顺序**：
  1. 改 `core/test/i18n.test.ts`：把"缺中文"的扫描换成递归遍历 `core/src` + `app/ui/src`；把死词条的键解析扩到无引号键。
  2. 先只改扫描、不改词典，跑一次确认它变红，并记录红出来的条目（预期包含 `app/ui/src/composer-menu.tsx` 的 16 条）。
  3. 在 `core/src/client/i18n/zh.ts` 补这 16 条中文；如果扩范围后冒出更多，按文件分批提交。
  4. 加夹具：`core/test/fixtures/i18n/` 放一棵含子目录 `t('…')` 与无引号词典键的小树，测试断言它会被扫到。
- **验收标准**：
  - 只改扫描、不改词典时 `npm test -w moon-bot-core` 必须红，且失败信息逐条列出缺失键（证明门禁会红）；
  - 恢复改动后三件套全绿；
  - 人为在 `app/ui/src/` 下新增一条没有中文的 `t('…')`，测试必须红；删掉后恢复绿。
- **边界**：不改词典结构、不引入 `--fix` 排序、不动 `t()` 的签名。

### 动作 2：把两条"已定但没门禁"的规则机械化（S/M）
- **开工顺序**：
  1. 先做 12 号（测试等待）：`check-gates.mjs` 新增 `testSleep` 检查组 + `core/test/fixtures/gates/sleep/`；在 `core/test/lint-gates.test.ts` 加一条断言具体行号。
  2. 再做 10 号的最小版（`core/scripts/ratchet.mjs`），只抽"读基线 / 比较 / `--write` 只降"三件事。
  3. 用 10 号的工具做 11 号（静态 `h(Comp)` 棘轮），基线取当前实测值，只降不升。
  4. 更新 `docs/plans/2026-10-28-code-conventions.md` 的门禁表：把这两条从"暂无门禁"移到"已机械检查"，并注明夹具路径。
- **验收标准**：
  - 在任意测试里加 `await new Promise(r => setTimeout(r, 50))` 后 `npm run lint` 失败并指出文件行；
  - 在客户端新增一处静态 `h(Comp)` 后失败并指出"基线只降不升"；`node core/scripts/ratchet.mjs --write` 之后仍然失败（因为不能升）；
  - `npm test`、`npm run typecheck`、`npm run lint` 全绿；`core/test/lint-gates.test.ts` 的新断言能在夹具被改坏时红。
- **边界**：不批量迁移存量 `h(Comp)`；不新增依赖；不动 `intrinsic-h` 的现有语义。

### 动作 3：让部署回滚真的能回到一个能跑的状态（M）
- **开工顺序**：
  1. `deploy/update.sh`：pull 成功后、`up -d` 之前写一份数据快照（至少 `store.sqlite3` 用 `VACUUM INTO` 落一份、复制 `state.json`），快照目录与保留数写进 `.env.example`。
  2. 记录升级前的 `user_version`；容器不健康时先读新库的 `user_version`：变大了就**不回滚镜像**，改为打印"数据已升级，恢复快照用 `rollback.sh --restore <path>`"；没变大才走现有的镜像回滚。
  3. `deploy/rollback.sh` 支持 `--restore <snapshot>`：停容器、校验快照、替换数据、起容器、等 `/healthz`。
  4. 在 `.github/workflows/test.yml` 加一个 ubuntu job：起 compose → `update.sh` 指向不存在的 tag（断言 `.env` 与容器都没变）→ 指向一个会被健康检查判死的镜像（断言不发生"旧镜像对新库"）→ `rollback.sh --restore` 后 `/healthz` 正常且数据还在。
- **验收标准**：
  - 演练 job 在本 PR 里能跑通，且故意把 `user_version` 判定删掉后该 job 必须红（证明它测的是判定，不是脚本能跑）；
  - 手工演练一次：升级失败 → 输出明确给出快照路径与恢复命令，`rollback.sh --restore` 后 `/healthz` 返回 `{"ok":true,...}` 且一个 Bot 的对话仍在；
  - `deploy/README.md` 与 `docs/RELEASING.md` 的"Rollback"一节改成与新行为一致的说法。
- **边界**：不加自动更新通道、不把 docker socket 交给容器、不改 compose 的镜像 tag 规则；快照只落在部署目录内，不进仓库、不打印任何密钥。

> 动作 1 与 2 互不依赖，可以并行；动作 3 独立但要排在下一个版本打 tag 之前。20 号（发布 preflight）与 21 号（产物自检）是紧接着的下一批，都是 S，适合在同一个 PR 里一起落地。

# app：桌面壳

Electron 应用：主进程、窗口、服务子进程、首次启动、搬移数据、安装包与自动更新。先读根 [`AGENTS.md`](../../AGENTS.md)。桌面窗口和网页版共用 `packages/core/src/client` 的界面代码——是两个宿主、一套界面，不是两套界面。

## 窗口与 Host 的边界

- 主进程 [`src/main.ts`](src/main.ts) 只管壳：单实例、窗口、更新提示、Host 子进程的生死。窗口加载 loopback 上服务给的地址；团队数据只属于服务。
- Host 子进程 [`src/service-host.ts`](src/service-host.ts)：在 Electron 的 Node 模式里 `import('moon-bot-core/service')` 起 `startService`，用 IPC 报 ready/fatal/shutdown；[`src/host-process.ts`](src/host-process.ts) 管它的生命周期。它是 app 里唯一运行 core 的地方。
- 渲染进程没有 Node/fs：只经 `api/bot`、`api/bot/feed` 和 [`src/preload.cjs`](src/preload.cjs) 暴露的窄 IPC 面（数据位置、搬移、更新状态/检查/安装、标题栏颜色）。不要给渲染进程加通用 IPC 或文件访问；新增 IPC 要在主进程校验来源与参数。
- 窗口安全默认不能放宽：`contextIsolation: true`、`sandbox: true`，`will-navigate` 只允许服务 origin，新窗口一律拦下交给系统浏览器；没有需求不要加 `nodeIntegration`。
- Host 起不来时窗口要有错误面：`fatal` 消息带诊断（截断到 64KB），主进程把 stderr 尾部和退出码显示给用户；不要把子进程的错误静默掉，也不要让窗口卡在空白页。

## 数据目录

- 窗口不直连数据目录：读团队数据一律走服务。唯一动文件的是主进程的数据搬移（[`src/move-data.ts`](src/move-data.ts)）：先停 Host，复制到 staging，完整后改名，失败保留旧位置并删掉半份复制。
- app 自己的数据（`userData`、`locations.json`、`host-port.json`）与团队数据（`MOON_BOT_DATA`）分开；首次启动选的目录不能互相包含、不能落在别的应用数据（`DSH_HOME`/`~/.dsh`）或程序目录里。
- 开发/测试用一次性文件夹（`MOON_BOT_DATA`、`MOON_BOT_SHELL_DATA`），跑完删掉；绝不指向真实数据或 `~/.dsh`。
- 首次启动的目录选择在系统对话框里（[`src/first-run.ts`](src/first-run.ts)），默认 `~/.moon-bot` 与 `~/Moon Bot`，存进 app 自己的 `locations.json`；一次性运行（`MOON_BOT_DATA`）不询问，也不搬移。

## 共享界面代码

- 窗口的 Bot 视图从 `../../packages/core/src/client/` 取（[`ui/src/app.tsx`](ui/src/app.tsx)），不在 `apps/desktop/ui` 复制一份；`apps/desktop/ui` 只放窗口自己的壳：frame、聊天容器、主题、locale、primitives。历史上窗口和 DSH 插件面共用这套视图；DSH 插件宿主已移除，现在共用的是这个窗口和网页端。
- [`vite.config.js`](vite.config.js) 的 `ownPrimitives` 插件把 `packages/core/src/client/primitives.tsx` 换成本地 [`ui/src/primitives.tsx`](ui/src/primitives.tsx)（窗口不加载宿主原语）。共享组件不得 import 只存在于某个宿主的模块。
- 样式表清单在 [`ui/src/sheets.ts`](ui/src/sheets.ts)，必须覆盖 [`../../packages/core/src/client/index.ts`](../../packages/core/src/client/index.ts) 安装的每个组；[`test/ui-sheets.test.mjs`](test/ui-sheets.test.mjs) 会对比两边，漏一组会红。
- 共用 `--bt-*` token 与 `motion.tsx` 的预设；共享组件不得依赖桌面专有能力（窗口控制、自动更新、搬移数据、内置浏览器）——这些经注入面传入，缺省时降级（网页端和手机端就走缺省那条路）。
- 网页版和窗口共用同一个 `apps/desktop/ui` 构建；[`src/web.ts`](src/web.ts)（`pnpm --filter moon-bot run web`）只是不经过 Electron 的启动入口：起同一个 `startService` 并加密码页。网页版有的能力限制，桌面组件也要能接受。

## 打包与自动更新

- `pnpm run build`（或根上 `pnpm --filter moon-bot run build`）= vite 构建 `ui/` + esbuild 构建主进程 `dist-main/main.cjs`；`pnpm run pack`/`dist` 用 electron-builder（[`electron-builder.yml`](electron-builder.yml)）。Windows 出 NSIS 安装包 + portable，Linux 出 AppImage，macOS 出 zip（两个架构）。
- 只在目标平台/架构上打包：`better-sqlite3` 用 `node_modules` 里装好的原生模块，不交叉编译；[`scripts/before-pack.mjs`](scripts/before-pack.mjs) 会拦架构不符的构建。
- 自动更新走 electron-updater：Windows/Linux 读 Release 的 `latest.yml`，后台下载、校验 sha512、提示重启后安装；macOS 只查 GitHub Release 并打开下载页，不自动装。更新检查在 Host 之前启动，Host 起不来也能更新。
- 版本号必须等于 `packages/core/package.json`（[`test/package.test.mjs`](test/package.test.mjs)）；发布 tag 是 `vX.Y.Z`，`app-update.yml`/`latest.yml` 的发布源不要手改。生成物（`ui/dist/`、`dist-main/`、`dist-pack/`）不进 git，不手改。
- `publish` 指向 GitHub Release（pre-release）；CI 在 `.github/workflows/desktop.yml` 里构建安装包、跑 `check-packed`、安装/卸载检查，并在改动涉及 app 时跑更新检查。

## 验证

- `pnpm test`（`test/*.test.mjs`）和 `pnpm run typecheck`（主进程 + ui 两个 tsconfig）必须绿；打包后检查用 `pnpm run check-packed`，更新检查用 [`scripts/check-update.mjs`](scripts/check-update.mjs)。
- 界面改动用 dev 实例：`pnpm start`（一次性数据文件夹 + `../../packages/core/dev/mock-llm.ts`）或 bench，在窗口里真实点；不要拿安装包当界面验证。截图辅助用 [`scripts/shot.mjs`](scripts/shot.mjs)。
- `test/` 覆盖数据搬移（一次性文件夹）、更新器、窗口外框参数、lockfile 依赖与版本一致性；改这些行为时在同一 PR 里补测试。
- 动了 IPC、窗口安全选项、数据搬移或更新路径，要在同一 PR 里补测试；这些是边界，不靠肉眼。

# packages/core/src/client：界面层

浏览器半。两个宿主加载它：服务托管的网页，和桌面窗口（`apps/desktop/ui` 的 Vite 构建从这里取视图）。先读根 [`AGENTS.md`](../../../../AGENTS.md)；本文件只写这个区域自己的边界和坑。

## 边界

- 只 `import` `moon-bot-contracts`（具名 barrel）和本目录的文件。不得 import `host/`、`engine/`、`store/`、`service/`——[`check-gates.mjs`](../../scripts/check-gates.mjs) 的 boundary 检查会拒绝。
- 与 host 的交互只有两条路：`api.ts` 的 `call('endpoint', payload)`（POST `api/bot`，endpoint 名字与类型在 `moon-bot-contracts` 的 RPC 面），和 `/api/bot/feed` 的 SSE。组件里不直接 `fetch`、不读写文件、不读环境变量。
- 界面代码有两个消费路径：`apps/desktop/ui`（网页和桌面窗口）直接 import 视图模块，用 `apps/desktop/ui/src/team.ts` 建状态和动作；`apply(ctx)` 是历史插件入口（`client.js` 导出 `apply`/`inject`），保留但不再被这两个宿主调用。两边都要成立：网页/窗口没有 Node 能力；桌面壳的额外能力（窗口控制、自动更新、搬移数据、内置浏览器）只能经 `client-ctx.d.ts` 声明的注入面出现，缺省时降级。

## 状态与渲染

- 状态的事实源是 `sources.ts` 的 `createSource`（`getSnapshot`/`subscribe`/`set`）：插件入口 `apply(ctx)` 走一次 `createClientState(ctx)`（`client-boot.ts`），动作在 `client-actions.ts`；窗口/网页的宿主在 `apps/desktop/ui/src/team.ts` 用自己的源喂同一批视图模块。视图只读注入的 `actions` 和 `hooks`，不自己建全局状态、不在渲染里发请求。
- 状态源用 `sources.ts` 的 `createSource`（`getSnapshot`/`subscribe`/`set`），订阅走 `useSyncExternalStore`（`model-choice.tsx` 就是这么接的）；不要在模块顶层把一次快照存成常量。
- `ctx.effect` 和 slot `inject` 注册的副作用要在宿主切表面或卸载时能撤掉（返回 disposer；确实无需清理的才返回 void）；样式用 `installCompiledStyles` 随组装卸。
- 视图是纯函数式的：同样的 props/快照渲染同样的节点树；DOM、网络、计时都在 effect 或注入面里。测试因此可以直接调用组件函数断言节点。

## Kit（公用原语）

- 可复用、无宿主副作用的 UI 原语在 **`moon-bot-ui`**（`packages/ui`）：`EmptyState`、`Field`/`Select`、`Row`/`Card`/`Switch`/`SwitchRow`/`InlineText`。从包 barrel **具名**导入：`import { EmptyState, Field } from 'moon-bot-ui'`；禁止 `export *`。
- kit **不得** import `host`/`engine`/`store`/`service`/`client`，也不得碰 `api.ts`、`sources`、actions；只依赖 React 与包内 spring 辅助。Feature 页编排状态与副作用，再把细回调传给 kit。
- 第二个消费方且无副作用时再升 kit；usage 图表的 `Row` 等单域语义不同的组件留在 feature。不要在 `apps/desktop/ui` 再实现一套 Field/Row/Card/EmptyState。

## JSX 与组件

- 内建标签（`div`/`span`/`button`…）一律 JSX；`h('tag')` 只允许在写不了 JSX 的地方（纯 `.ts` 文件，或 props 要整体展开的动态对象），并就地注释原因。
- 元素类型和 props 在源码里固定的组件写 JSX `<Comp .../>`；元素类型来自变量（如 `h(entry.component, …)`）、props 来自外部对象、或上下文写不了 JSX 的，才保留 `h(Comp, ...)`。新代码不再写静态 `h(Comp)`；存量迁移进行中。
- JSX 必须继续编译成 `h()`：`core/tsconfig.json` 是 `jsx: react` + `jsxFactory: h`，[`../../scripts/build-client.ts`](../../scripts/build-client.ts) 用同一套（esbuild `jsx: transform`）。不要引入 `react/jsx-runtime`——宿主只 seed `react`/`react-dom`，[`../../test/client-bundle.test.ts`](../../test/client-bundle.test.ts) 会断言 bundle 没有 jsx runtime 依赖。
- `.tsx` 放组件；纯逻辑、数据表、样式字符串模板放 `.ts`。

## 样式与动效

- 颜色、圆角、弹簧只用 `--bt-*` token（`design/tokens.ts`）和 `motion.tsx` 的预设；不许新写字面量。门禁是 [`../../test/style-debt.test.ts`](../../test/style-debt.test.ts) + `../../test/style-debt.json`（这份债只减不增；`node scripts/style-debt.mjs --write` 只会调低）。
- 样式表放 `design/` 或组件旁的 `*_CSS` 模板字符串，类名前缀 `bt-`；`design/index.ts` 里 sheet 的拼接顺序是设计的一部分，不要重排。
- 动效读 `motion.tsx` 的 `reducedMotion()`，并给 `@media (prefers-reduced-motion:reduce)` 兜底；不要写只看 JS 计时、不看系统设置的动画。

## i18n

- 用户可见文案一律 `t('English key')`，中文进 [`i18n/zh.ts`](i18n/zh.ts)。[`../../test/i18n.test.ts`](../../test/i18n.test.ts) 会扫出 `t('…')` 里没有中文的词条。
- host 返回的错误用 `hostText`（已知的主机文案有中文）或 `errorCopy(code, …)`（错误码 → 用户解释 + 下一步）；不要把英文错误原文直接糊到界面上。
- 文案在渲染时取，不在模块加载时缓存（语言切换要立即生效）。

## 测试

- 组件测试范式：用 esbuild 把 `.tsx` 打成 cjs（`external: ['react','react-dom']`），用 `node:vm` 的 `runInNewContext` 注入假 React，直接调用组件函数断言节点树（[`../../test/header.test.ts`](../../test/header.test.ts)、[`../../test/empty-state.test.ts`](../../test/empty-state.test.ts)）。
- 测试文件不许 `import` 一个 `.tsx` 模块：Node 类型剥离不处理 JSX，[`check-gates.mjs`](../../scripts/check-gates.mjs) 第 4 条会先拦下。要么在测试里 bundle，要么把可测逻辑留在 `.ts`。
- 等状态用真实屏障：带超时和观察值的 `waitFor`，或 `setImmediate` 的 tick；不许 sleep 固定时间再断言。
- 界面行为用 bench + mock-llm 在浏览器里验证（`packages/core/dev/bench.sh`）；不要拿 `client.js`/`dist/` 当证据，它们只证明产物与源码一致。

## 规模

- 每个逻辑文件 ≤ 350 行（[`check-gates.mjs`](../../scripts/check-gates.mjs)）；`i18n/zh.ts`（词表）和 `brand-art.ts`（生成数据）按性质豁免。按职责拆分（`client-boot` / `client-actions` / `cells-*` / `design/*`），不要为过线堆注释。
- 组件变大时先拆样式和数据表，再拆渲染分支；一个文件只负责一个表面。

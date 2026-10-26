# Test layout

正式测试统一使用 TypeScript，并由 Node 的原生类型剥离直接运行：

- `test/*.test.ts` 是可执行的完整测试套件；新增测试使用 `.test.ts`。
- `fake-ctx.ts` 和 `framer-motion-shim.ts` 是测试基础设施，避免测试依赖真实 DSH UI 运行时。
- `tsconfig.tests.json` 为测试提供独立的 TypeScript 项目；`npm run typecheck:tests` 至少验证语法、模块解析和测试入口完整。
- `test/fixtures/gates/**` 中保留的两个 `.test.js` 是门禁 fixture，用来验证测试门禁能识别旧 JavaScript，不属于正式测试。

常用命令：

```sh
npm run typecheck:tests
npm test
npm run test:gate
```

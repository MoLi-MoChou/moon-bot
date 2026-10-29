# `test:related`：只跑碰得到的测试

- 日期：2026-10-29
- 相关：[从 OpenBot 借鉴什么](2026-10-28-openbot-borrowing.md) 的 P2-14

## 为什么

全量 `npm test` 是这个仓库的定义之一，改一行也要跑完才能说完成。但迭代时每改一处都跑全量太慢，容易让人跳过测试。缺的是一条「只跑相关的」快路——前提是它永远不能冒充门禁。

## 已定的行为

```
node scripts/test-related.mjs          # 从 git 读改动，跑相关测试
node scripts/test-related.mjs --list   # 只列出会跑什么
node scripts/test-related.mjs --files src/host/roster-rooms.ts
```

- 改动来自 `git status --porcelain`（暂存、未暂存、未跟踪），或 `--files` 显式指定。
- 反向导入闭包：从改动文件出发，沿 `core/src` 和 `core/test` 的 import 关系找能到它的 `*.test.ts`；跨过 helper 和 barrel。
- 改动的测试文件本身直接跑。
- 名字兜底：没有测试按名字导入时（例如 `host/roster-rooms.ts`），按文件名 token 匹配测试名，宁可多跑。
- 一个都没匹配上时，打印「跑全量」，不假装通过。
- 退出码就是那批测试的退出码。

## 不做什么

- 不改任何基线，不进 CI，不替代 `npm test`。脚本每行输出都提醒这一点。
- 不猜「改动很小所以不用跑」。匹配不到就退回全量。

## 变更

- 2026-10-29：定下反向导入闭包和「快捷方式不是门禁」。

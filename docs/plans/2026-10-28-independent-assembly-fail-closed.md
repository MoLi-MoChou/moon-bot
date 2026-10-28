# 独立装配下的缺件即拒绝

- 日期：2026-10-28
- 相关：`core/src/host/folders.ts`、`core/src/host/permissions.ts`、`core/src/service/engine.ts`
- 背景：[OpenBot 借鉴计划](2026-10-28-openbot-borrowing.md) 的 P0-2

## 语义

独立装配的 host 可能没有宿主通常提供的安全依赖。缺少依赖时不能把「没有检查」解释成「允许」：应在改变状态或开始工作前拒绝，并返回用户能看懂、能指出修复方向的原因。

- 没有 `sandboxPolicy` 时，团队工作区内的既有行为不变；把 Bot 或群聊移到团队工作区之外则拒绝，说明沙箱策略不可用，且不请求审批、不写状态。
- 没有 `permissionPresets` 时，权限预设目录返回缺省值以隐藏界面入口；设置 Bot 或群聊权限在校验阶段拒绝，说明权限预设不可用，且不写状态或 Session。
- 依赖正常装配时沿用现有策略、审批和默认值。此规则不新增默认批准，不改变每日预算，也不提供 `approvalPolicy: never` 或等价开关。

这样，独立装配的缺件只会收窄能力，不会把安全边界变成放行路径。

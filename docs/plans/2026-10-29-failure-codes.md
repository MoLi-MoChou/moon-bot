# 失败码：额度与过载

- 日期：2026-10-29
- 相关：[从 OpenBot 借鉴什么](2026-10-28-openbot-borrowing.md) 的 P2-12

## 为什么

额度用尽和暂时过载以前都落在 `SERVER` 或根本对不上号。人和「过一会儿再试」要的处理不一样。

## 已定的行为

- 导线文字先匹配 `QUOTA`（402、quota、billing、credits、payment required），再匹配 `OVERLOADED`（overloaded、at capacity）。`overloaded` 不再算 `SERVER`。
- `failureNeedsUser` 为真的码要人处理：`AUTH`、`QUOTA`、`INVALID_REQUEST`、`NO-MODEL`。`OVERLOADED`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT` 为假，表示可以再试。这次不因此自动重试。
- 群里的人话：额度是「模型的额度用完了」，过载是「模型这会儿过载了」。

## 不做什么

- 不自动换备用模型。
- 不把过载当成审批或权限问题。

## 变更

- 2026-10-29：加上两个码和「要不要人处理」的区分。

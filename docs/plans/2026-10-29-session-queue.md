# 会话队列：唯一可读来源，看得见、撤得掉

- 日期：2026-10-29
- 相关：[从 OpenBot 借鉴什么](2026-10-28-openbot-borrowing.md) 的 P1-5、P1-6；[任务面板](2026-10-28-tasks-panel.md)；[运行时对比](../research/openbot-runtime.md)
- 许可：OpenBot 是 PolyForm Noncommercial，与本仓库 Apache-2.0 不兼容。本文只定我们自己的行为。不搬它的代码、注释、文档文字或界面文案。

## 为什么

内置引擎把「还没开始的下一条」放在 bridge 的 `waiting` 里，任务面板用 `pendingTurns()` 读出一个数字。同一会话的 `inbox` 仍是空的，所以这三处读不到排队输入：合并未读请求（`tools/shared.ts`）、关停时撤掉还没接走的投递（`turns.ts`、`resume.ts`）、群聊把用户插话贴进当前轮（`groups/rounds.ts`）。用户看得到「排队 3 条」，看不到是哪 3 条，也撤不掉其中一条。

取舍：

- **不新建任务对象，不另存一份对话。** 队列是会话上还没开回合的输入，不是一等任务。消息正文仍然只有 `appendMessage` 一个写路径；排队项不进 `messages`，也不进 `state.json`。
- **不换运行时栈。** host 仍不调用 kernel。差异以后写成引擎能力描述符，本文不定那份描述符。
- **先让现有读点说真话，再给用户一个撤销。** 编辑、重排、拖进当前回合都留到下一份设计。

## 已定的行为

### 唯一真相

内置 bridge 里，`waiting` 是还没开始自己回合的消息的唯一可变列表，顺序就是接受顺序。

- `inbox.nextTurn` 是 `waiting` 的只读视图，同一顺序，同一批对象。
- `pendingTurns()` 等于 `waiting.length`，也等于 `nextTurn.length`。任务面板的 `queued` 继续读这个数，不自己记一份。
- `inbox.nextStep` 在内置引擎上保持空数组。steer 要么切进正在跑的回合，要么掉进 `waiting`（空闲，或切不进去），不另排一条「下一步」。
- 放进队列时给每条一个稳定 `id`。视图上的每条至少有 `id`、`content`、`source`，读点和今天对 DSH inbox 的读法相同。
- `remove(id)` 只从 `waiting` 里删掉还没开始的那条，删掉返回 `true`。已经开始、或没有这条，返回 `false`，并且不动正在跑的回合。
- `prepend('next-turn', message)` 插到 `waiting` 最前。同一 `id` 或同一 `source.exchangeId` 已经在队列里则不插第二遍。
- `prepend('next-step', message)` 也插到 `waiting` 最前，不造第二条列表。换段把输入交回去时，内置引擎只有「下一次回合」这一个位置。
- 整段取消（用户 Stop、Main Bot 的 `stop_bot`、`task-stop`）仍清空整个 `waiting`，再取消正在跑的回合。这一点不改。

上面三条既有读点改为读这个视图，不再读永远为空的 stub。群聊的既有规则不变：一轮进行中，队列里的用户纯文本在下一位发言前贴进群日志，并从队列删掉；带图片、非文本块或会话引用的那条以及它后面的，留在队列里。

### 看得见

`tasks` 的每一条进行中的行，在已有的 `queued` 数字之外，带上 `queue`：还在等的那些条。每条只有 `id` 和 `preview`。`preview` 是第一条文本块的第一行，截到 120 个字符；没有文本则是空字符串。不带附件、不带全文、不带密钥。

- 只列出还没开始的条。正在跑的那条不是队列。
- 回合还没开始时，这一行的 `queued` 仍是 0，`queue` 为空。那条输入是这个回合自己，不是排在自己后面。
- 顺序与 `waiting` 相同。
- 不持久化。进程退出后队列消失，和今天一样。`inflight.json` 的恢复不在本文改。

界面在「排队 N 条」下面列出 `preview`。没有 `queue` 或它为空时，只留原来的数字。

### 撤得掉

新端点 `queue-remove`：请求 `{ sessionId, id }`，响应 `{ removed: boolean }`。

- 删掉的是还没开始的那一条，不影响正在跑的回合。`task-stop` 仍是停整个回合并清空剩余队列。
- 已经开始、id 不对、会话没有这份队列：`removed` 为 `false`，不报错，不补写一条假消息。
- 删掉的那条若是还等着回复的 Bot 请求（`source` 表示要回复、且不是对用户说），告诉发送方一句：对方还没读，用户把它撤掉了。不重开工作、不改审批、不改风险等级。
- 用户自己的插话被撤掉时，不另发通知。
- 不提供编辑、改顺序、把排队消息 steer 进当前回合。

## 不做什么

- 不做任务对象、任务 tab、归档任务、跨重启的队列账本。任务面板仍是观察窗（[任务面板](2026-10-28-tasks-panel.md)）。
- 不做投递七态表，不加 SQLite 迁移。那是后面的「回合状态机」，要单独的设计。
- 不把 provider 的会话当成事实源，不引入子代理对象。
- 不做默认放行，不做 `approvalPolicy: never` 或等价开关。审批卡片的作用域和「谁答的」另写设计，不夹在这次里。
- 不做引擎能力描述符、上下文用量的生产者、手动压缩、引擎健康状态、doctor、备用模型。顺序仍是：本文的队列做完，再写那些。描述符只许让 host 更保守，不能变成少问审批的理由。
- 不换 Bun、Effect、Solid，不把桌面拆成对方的 main / preload / renderer。`core/src/shared/` 继续当契约边界。

## 已知限制

- 队列只在内存里。重启后的重放仍走 `inflight.json`，可能和「结清再问」不一致。那次改恢复行为要另写设计，不能靠本文偷偷改掉「重启后续跑」。
- `preview` 不是全文。长消息、附件、图片在队列列表里只显示截断的一行或空行。
- 内置引擎没有单独的 `nextStep`。依赖「下一步比下一回合更早」的 DSH 行为，在内置引擎上变成「都在下一回合的队列头」。
- ACP 会话不经这个 bridge。本文只约束内置引擎造出来的 agent。ACP 侧没有同一份 `waiting` 时，`queue` 为空，`queue-remove` 返回 `removed: false`。

## 变更

- 2026-10-29：定下队列的唯一来源、列表和单条撤销。
- 2026-10-29：内置 bridge 的 `inbox.nextTurn` 即 `waiting`；`tasks` 带 `queue`；`queue-remove` 撤一条并在 Bot 请求上通知发送方。

# OpenBot 产品功能与交互对比

- 日期：2026-10-28
- 范围：首启与上手、会话与消息渲染、composer、团队与频道、任务面板、浏览器与电脑、设置与模型、多端策略
- 结论用途：给「下一步方案」排优先级，不动已定的设计（[任务面板](../plans/2026-10-28-tasks-panel.md)、[派活与等待](../plans/2026-10-16-bot-handoffs.md)、[群聊](../plans/2026-10-07-group-chat.md)、[浏览器与电脑边界](../plans/2026-10-28-browser-and-computer-boundaries.md)）

## 关于材料

OpenBot 的源码在 `/tmp/openbot`，许可证是 PolyForm Noncommercial 1.0.0，与我们的 Apache-2.0 不兼容。本报告**只引用文件路径、API 名、字段名和结构**，所有描述、判断和方案都是自己写的；没有抄它的代码、注释、文档句子或界面文案。凡是无法确认的地方都在正文里标了「未确认」。

读的材料：`AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/architecture/{structure,agents,channels-and-messaging,browser,computer-use}.md`、`docs/web-client.md`；实现点是先用 grep 在 `packages/ui/src/features/**`、`packages/contracts/src/**`、`src/renderer/src/features/**`、`src/backend/**` 里定位，再读命中的那几十行。没有通读 170MB。

## 1. 摘要

1. OpenBot 的产品重心是**把「任务」做成一等对象**：每个 agent 的每个副线程有状态（running/queued/idle/closed）、排队原因（六种 hold）、并发上限、读标记、归档与删除，桌面把它画成聊天头部的 tab。我们的任务是 `host/tasks-panel.ts` 从 turns/handoffs 实时读出来的看板，**刻意没有对象**（[tasks-panel](../plans/2026-10-28-tasks-panel.md) 已定）。两边不是同一层的东西，差距不在对象模型，而在**「为什么在等」「有没有历史与筛选」「排队消息能不能动」**这三点。
2. 排队消息在 OpenBot 是一整块可操作的产品面：列出、steer、编辑、删除、拖动重排、转成新线程，还有编辑持锁（`QueuePanel.tsx`、`queue-edit-v1`）。我们只有 `tasks` 端点里的一个 `queued` 计数（`core/src/client/tasks-page.tsx`），用户看得到「有 3 条排队」，看不到是哪 3 条，也撤不掉。
3. 它的频道（channel）和我们的群聊是两种东西：一个频道有一个 host、一个 lead 负责给每条请求选 owner，任务可转交、可 Stop/Continue/Reassign、可归档/恢复，审批和浏览器步骤挂在频道上（`src/backend/channel-service.ts`、`packages/ui/src/features/channels/ChannelStoppedTasks.tsx`）。我们是「管理员先答 / 全员轮流 + `@` 提及 + 一件活一个地点」，没有 owner、没有归档。
4. 首启它走「先解决模型，再给模板/导入/迁移」：免费或订阅二选一 → 语言 → 电脑权限 → 进聊天；agent 可以被另一个 agent 在对话里创建和改写（`openbot.create_agent`），模板是链接，导入和实例迁移是 zip（`src/main/instance-transfer-service.ts`）。我们的首启只解决数据目录与工作区目录（`app/src/first-run.ts`），产品内是空白表单 + 模型选择卡片。
5. 设置与模型上它更细：设置页可搜索、agent 设置有分页、模型选择带备用模型链、上下文面板按类别拆账并显示压缩前后。我们对应的是模型菜单里的 thinking 档位（`core/src/client/model-menu.tsx`）加一个上下文环（`model-context.tsx`），没有明细。
6. 多端它用「桌面 + 网页 + 原生手机」三套壳共享一个 UI 包，靠可选的 host capability 兼容老新。我们「手机先做响应式网页」的判断不用改，但**能力清单**（谁没有浏览器、谁没有桌面壳）和**手机访问设置页**这两点值得借。

## 2. 分主题对比表

### 2.1 首启与上手

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 首启第一问 | 两组同权重的选项：先用免费模型，或用已有的订阅接入；标题上方画一排团队头像（`src/renderer/src/features/onboarding/FirstRunChoice.tsx`、`onboarding-avatars.ts`） | 桌面壳先问「数据放哪、工作区放哪」，两个路径都能改，冲突有文案（`app/src/first-run.ts`） | 不冲突，是两个问题：它解决「用什么模型」，我们解决「放哪里」。我们缺前者，产品里最接近的是聊天里的模型卡片 |
| 首启后续步骤 | `choose → plan（选供应商/登录）→ computer（仅 macOS 要权限）`，可跳过用免费（`FirstRunFlow.tsx`、`FirstRunPlanStep.tsx`、`OnboardingComputerVisual.tsx`） | 首启结束进界面，host 自动建好一个**没有模型**的 Main Bot（`core/src/host/roster.ts` 的首个 Main Bot、`sidebar.tsx` 的「Setting up your Main Bot…」），模型由 `ModelChoiceDock`（`core/src/client/model-choice.tsx`）在聊天里追问 | 我们的追问是「一个 Bot 一张卡」，它的是「整支队伍一次配好」。多 Bot 时要一张一张点 |
| 语言与区域 | 首启里有独立语言步（`.../onboarding/LanguageStep.tsx`、`language-step.ts`） | 语言跟随系统/既有设置，没有首启步（`core/src/client/i18n.ts`、`i18n/zh.ts`） | 我们只有 en/zh 两套，缺一步的收益低；但「首启把语言选明白」在中文用户里值一点 |
| 建第一个 Bot | 工作区里没有 agent 时，直接进「首个 agent」的设置页，给三条命名建议（含名字、描述、用途、头像），也可自己写（`packages/ui/src/features/agents/FirstAgentSetup.tsx` 的 `FIRST_AGENT_SUGGESTIONS`、`src/renderer/src/features/agents/WorkspaceAgentSetup.tsx`） | 空白表单：先随机外形，再名字、模型、thinking（`core/src/client/create-bot.tsx`、`bot-draft.ts`）；侧栏空状态只有一句「创建 Bot，或让 Main Bot 建一个」（`sidebar.tsx`） | 我们缺**角色模板**：用户要自己想「这是个什么 Bot」。它是「三条建议 + 可自由写」，我们是「纯空白表单」 |
| 对话里创建/改写 Bot | agent 调 `openbot.create_agent`、`update_profile`、`update_agents`，可一次改多个；新 agent 默认继承调用者的供应商/模型/thinking（`docs/architecture/agents.md` 的 Prompt-driven agent profiles、`src/backend/openbot-tools.ts`） | Main Bot 有 `create_bot` / `update_bot`（`core/src/client/cells-tool.tsx` 的 tool 分支、`core/src/host/channel/`），权限只给 Main Bot（[角色与权限](../plans/2026-10-07-roles-and-permissions.md)） | 能力有，颗粒度差一截：它单个字段可改（含备用模型、账户、访问级别），我们主要是名字/角色/指令/模型；它还有 `list_models` 这种只读查询给 agent 用 |
| 分享与模板 | 发布成链接（每个账号最多 5 个已发布），分享卡在渲染层画，打开链接进安装预览，链接本身不装东西（`packages/ui/src/features/agents/PublishAgentDialog.tsx`、`AgentTemplateInstallDialog.tsx`、`src/main/agent-template-service.ts`） | 无。只有「复制会话为 Markdown」（`core/src/client/details-drawer.tsx`） | 整块功能缺失。但它是账号体系的一部分，我们没账号，短期不做 |
| 导入与实例迁移 | 两种 zip：agent 导入（Grok Bot 那套 skill 生成导出包）与实例迁移（agent + 服务器设置 + shared 文件）；列了明确的排除项（聊天历史、连接、浏览器数据、各类密钥），导入时逐项提示「这项要你重新填」（`src/main/agent-import-manifest.ts`、`instance-transfer-manifest.ts`、`instance-transfer-service.ts`） | 只有「搬数据目录」：整目录拷贝、临时目录就位后改名、旧目录留着（`app/src/move-data.ts`、`copy-tree.ts`） | 我们缺「换一台机器带走这支队伍」。它是整包 + 排除密钥 + 逐项提示，我们是整目录搬。「排除密钥」这条我们要照做 |
| 起步提示 | 空聊天有引导与建议（`AgentChatEmptyState.tsx`、`ConversationPrompts.tsx`） | 三张卡片 starter（`core/src/client/starters.tsx`）、欢迎语（`chat-welcome.tsx`）、空状态（`empty-state.tsx`） | 我们有 starter，但只有 3 条且写死在源码里；它是按当前 agent 能力给的。差别不大，不值得大改 |

### 2.2 会话与消息渲染

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 正文渲染 | 一个 946 行的渲染层：Markdown、代码块、数据表、对比表、图片画廊 + 灯箱、图片生成、内容分块复用（`packages/ui/src/features/conversation/MessageRendering.tsx`、`MarkdownMessageText.tsx`、`ImageLightbox.tsx`、`CodeBlock.tsx`、`DataTable.tsx`、`ComparisonTable.tsx`） | 正文交给宿主原语 `MarkdownText`（`core/src/client/dsh-primitives.tsx`），我们只做气泡、引用、反应、时间、折叠（`cells-bubbles.tsx`、`cells-chat.tsx`、`user-message.tsx`、`fold.tsx`） | 我们把 Markdown 外包给宿主，省了维护也少了控制力：灯箱、画廊、表格样式这些它自己做。我们的 `show_view` 卡片（`widget-cell.tsx`）覆盖了「结构化展示」的大半需求，**不回填 Markdown 渲染器** |
| 工具调用的呈现 | 工具调用画成 step + 折叠的 trace，另有专门的 `TraceWaterfall.tsx` 呈现一次回合的调用树与耗时 | 白名单：只有 16 个工具画成事件行或卡片（`core/src/client/cells-tool.tsx` 的 `DRAWN`/`CARDS`），其余不画；跑着的调用只变成活动行的一句话（`toolActivity()`） | 方向一致（都克制）。差别是我们**不画**的东西连痕迹都没有：一次 `read`/`grep` 在聊天里完全不可见，只在「已工作 N 步」里被计数。它的每一步都能点开看 |
| 回合过程 | 跑的时候步骤列表跟着滚，结束后可点进 trace 瀑布；thinking、进度、记忆变更分三类（`AgentSteps.tsx`、`TraceWaterfall.tsx`） | 结束的回合折成一行「已工作 12s · 5 步」，点开右侧面板看完整过程（`core/src/client/work-process.tsx`、`cells-turns.tsx` 的 `TurnProcessCell`） | 我们的折叠更干净，但面板里**没有时间**：没有每步耗时、没有并行结构，也没有「跳到某一步」（它的 `focus` 参数做这件事） |
| 计划 / 待办块 | agent 的计划是一块有 header 的清单：pending/active/done、当前项可带进度环、头部显示「x/y」（`TaskList.tsx`） | 靠 `show_view` 画进度/栈/表格（`core/src/shared/views.ts` 的 `ProgressView`/`StackView`/`TableView`、`client/widget-cell.tsx`），但没有「计划」这个语义，也不能在**同一条消息里原地更新** | 差一个语义化视图：我们要么让模型重复发卡片，要么没有。这是「长任务可读性」的关键一块 |
| 子代理 | 一张卡片：类型、状态、耗时、步骤、结果，可展开（`Subagents.tsx`） | 没有子代理概念；Bot 之间是派活（`host/handoffs.ts`），界面上是事件行 + 任务面板 | 概念不同：我们的「子代理」就是另一个 Bot，已经能在任务面板看到。**不要**为了对齐引入子代理对象 |
| 附件与预览 | 卡片 + 由扩展名决定 MIME，MP3/MOV/MP4/ZIP 明确「不内联预览、可下载、可远程」（`AttachmentCards.tsx`、`docs/architecture/browser.md` 的 Browser client 段）；文件视图分三层：会话内文件面板、agent 设置里的文件页、服务器存储总览（`packages/ui/src/features/files/*`、`src/renderer/src/features/files/AgentFilesSettings.tsx`、`ServerStoragePanel.tsx`） | 交付物卡片 + 预览（文本/Markdown/图片/媒体/表格/PDF 壳），大文件超 64MB 直接给下载，另有一页**跨会话**文件库带类型与时间筛选（`core/src/client/deliver-cards.tsx`、`library-page.tsx`） | 我们这块不落后：它是「按会话/按 agent」看文件，我们是「一页看全队文件」。**不必借** |
| 引用与反应 | 引用一条消息进草稿（`ReplyQuote.tsx`）；表情反应（`MESSAGE_REACTIONS`） | 悬停工具条把消息引用进 composer（`composer.tsx` 的 `ComposerVoice`）；反应读宿主 `ui.reactions`（`cells-bubbles.tsx`） | 两边都有。我们的引用是纯文本 `> ` 前缀，它是结构化引用块；够用 |
| 未读与定位 | 新消息计数、跳到未读、滚动轨（`ChatScrollRail.tsx`、`MessageNavigation.tsx`、`new-message-tally.ts`） | 「N 条新消息 ↑」胶囊 + 未读分隔线 + 回到底部（`header-pills.tsx`、`cells-turns.tsx` 的 `unreadOpening`） | 打平。它多一条滚动轨（长会话里更好定位），成本 S |
| 长消息 | 长内容走 mailbox 与附件（`MailboxStore`） | 折叠 + `stripLongNote` + 全文落文件（`fold.tsx`、[长消息](../plans/2026-10-16-long-messages.md)） | 打平，思路一样 |
| 失败 | 统一的用户错误文案包（`packages/user-errors`），host 用 `sourceText(key)` 发中文键 | `failureLabel`/`errorCopy` + 群里的失败事件行（`diagnostics.ts`、`cells-tool.tsx` 的 `GroupReplies`） | 我们已有错误码 → 解释的路径，够用 |

### 2.3 Composer：`@`、`/`、IME、队列

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 触发菜单 | 两个前缀：`@` 给 agent / 附件 / MCP，`$` 给 skill；输入框里紧跟空白的一段文本作为查询，命中后插入成**不可编辑的 token**（`ComposerEditor.tsx` 的 `mentionAtSelection()`、`composer-tokens.ts`、`composer-picker.ts`） | `@` 是我们注册进宿主 trigger 菜单的两个 source（Bot 与「引用一个会话」），行由 `mentionRows()`/`chatRows()` 给（`core/src/client/at-menu.ts`）；`$` 与 `/` 是宿主自己的菜单 | 我们的插入结果是纯文本 `@名字`（引用会话是 `@[label](dsh-session:…)`），**不是 token**：Bot 改名后旧消息里的提及就失效，也没法在点选后继续编辑而不破坏它 |
| `/` 命令 | 没有斜杠命令。技能用 `$`，其余能力走工具（`ComposerEditor.tsx` 的 `MentionContext.trigger` 只有 `@` 与 `$` 两个取值） | `/` 打开宿主的命令菜单（`core/src/client/composer.tsx` 的 `ComposerPlus` 注释）；`+` 菜单是我们自己的（文件 / 引用会话 / 定时任务） | 我们在这块**功能更多**（有 `/` 有 `+`），但两套入口并存，用户要记两个。它只有一个 `@` 一个 `$`，更简单 |
| IME | `isComposing`、`compositionstart/end`、`keyCode === 229`、`key === "Process"` 四道判断（`ComposerEditor.tsx` 第 731 行附近；`ConversationPrompts.tsx` 第 112 行） | 捕获阶段监听器：`isComposing`/`229` 之外，额外处理 WebKit 在 `compositionend` 之后补发的纯 Enter（500ms 窗口），并对 Chromium 不做这个窗口（`core/src/client/ime-guard.ts`） | 我们的处理更细，踩过的坑写在注释里。**不借**它的，也不该简化 |
| 发送快捷键 | 用户可选 Enter 或修饰键+Enter 发送（`packages/ui/src/features/conversation/send-shortcut.ts`、`packages/ui/src/features/settings/SendShortcutSelect.tsx`） | composer 是宿主的，我们这层没有这项设置，也没有注入面能读它（`core/src/client/client-ctx.d.ts`，未确认宿主是否另有偏好项） | 缺一个小设置。S；但要落在宿主的能力里，不是我们能单方面加的 |
| 草稿 | 分 agent、分线程的草稿持久化（`composer-draft-storage.ts`、`composer-draft.ts`），队列编辑的草稿跨重启存活 | 宿主托管 composer 与草稿；我们的 `bot-draft.ts` 只管「新建 Bot」的表单 | 打平（宿主兜了）。差别：它的**排队消息编辑草稿**也有持久化 |
| 队列 | 一整块面板：位置排序、拖动重排、steer、删除确认、编辑、转成新线程、编辑持锁与 `queue-edit-v1`（`QueuePanel.tsx`、`BrowserDock.tsx` 里也嵌一份、`docs/architecture/channels-and-messaging.md` 的 Mobile chat queue） | 只有计数（`core/src/client/tasks-page.tsx` 的 `queued`），host 从引擎的 `pendingTurns()` 或 `inbox.nextTurn` 读（`core/src/host/tasks-panel.ts`）；用户发第二条消息时只能「steer 进当前回合」 | **最大的单点差距**。我们连「哪几条在排队」都说不出来 |
| 附件 token | 附件在输入框里是带缩略图、大小、可 Backspace 删除的 token（`composer-tokens.ts` 的 `createAttachmentToken`、`AttachmentReference.ts`） | 附件走宿主 composer，我们只在消息里画（`user-message.tsx` 的 `Attachments`） | 我们没法控制输入框里的附件表现。短期接受 |

### 2.4 团队与频道

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 组织单元 | 频道：一个 host、一个用途、若干成员 agent、一个选定的 lead、若干关联会话；成员资格决定「谁能接活」，不限制人看（`src/backend/channel-service.ts`、`channel-store.ts`、`docs/architecture/channels-and-messaging.md`） | 群聊：成员（最多 12）、管理员、公告、群级工作目录与权限；两种发言顺序（管理员先答 / 全员轮流）＋ `@` 提及 ＋ 每人可跳过（[群聊](../plans/2026-10-07-group-chat.md)、`core/src/host/groups.ts`、`groups/rounds.ts`） | 我们的模型更「可预测、不烧模型」；它更「任务化」。**不建议换模型**，只借它的三个交互（见 3.7） |
| 谁来做这条 | 分两层：先确定性规则选 owner（被点名的、回复挂着的任务、唯一开放任务、只有一个可用成员），规则不够才用 lead 的模型做路由，且路由结果要**写一条频道消息**让用户能纠正（`channel-service.ts`） | 没有 owner：管理员先答或全员轮流，靠 `@` 指名；`message_bot` 在群里等同 `@`（`groups.ts`、[群聊](../plans/2026-10-07-group-chat.md)） | 我们没有「这条归谁」的概念，因此也没有「转交给别人」。它把「选谁」做成可见的一步，这点值得学（只学可见，不学模型路由） |
| 一件活的状态 | 任务是频道里的对象：有 owner、revision、子任务、并行上限（8 次自动分配 / 2 个活跃）、转交会改 owner、子任务保留父 owner（`channel-service.ts`、`channel-tools.ts`） | 活是消息 + 派活树：`state.json` 的 `works`，父活等子活交回，结果自己往上走（`core/src/host/handoffs.ts`、[派活与等待](../plans/2026-10-16-bot-handoffs.md)） | 两套都成立。我们的树更省心（不需要 owner 字段），它的**转交**是我们没有的：我们只能停掉再派人 |
| Stop / Continue / Reassign | 三件事分开：Stop 暂停任务与所有子任务并打断；停止后的任务在频道里留一张卡，带原因、一个「继续」按钮、以及一个列出其他成员的重派菜单（`ChannelStoppedTasks.tsx` 的 `onResume`）；重派要等旧任务真正停下 | Stop 有（UI 与 `stop_bot` 走同一个 cancel，`core/src/host/tasks-panel.ts` 注释）；停止会告诉上游「被停下了」（`handoffs.ts`）；**没有**「继续」与「换人」 | 差距明确：我们停下就结束了，用户要重新说一遍。它的「停下 → 一张卡 → 继续或换人」是完整闭环 |
| 归档 / 恢复 | 归档会停掉频道工作、保留记录；恢复让频道重新可发；两者都不移除成员或关联会话。界面上归档入口放在删除那一类动作里，另有已归档分组的恢复入口（`channel-store.ts`、`docs/architecture/channels-and-messaging.md`） | 只有 `pinned` / `hidden` 两个标记与真删除（`core/src/host/roster.ts`、`client/group-settings.tsx` 的 `deleteRoom`） | 我们删了就没了。**归档**是数据安全角度也该有的一条 |
| 审批与浏览器挂在频道上 | 成员线程的审批与浏览器步骤显示在频道里，agent 自己的聊天不再显示；频道头部永远有浏览器按钮，多成员时可在成员之间切（`channel-attention-v1`、`channel-chats-v1`） | 群里的审批由 host 接住并发到群里，输入框上方的胶囊列出忙的成员、等审批的排前面，详情里「允许一次 / 拒绝」（`core/src/host/approvals.ts`、[群聊](../plans/2026-10-07-group-chat.md)） | 我们已有等价物。差别：它是「按线程归属显示」，我们是「按群显示」，且我们没有成员间切浏览器 |
| 读位置 | 每个成员在每个频道的读位置存在 `ChannelStore`；桌面/网页/手机共享（`channel-store.ts`、`agent-thread-reads-v1`） | 房间日志的 `seen`（每个成员看到的最后 seq，`groups/types.ts`），会话级 `completionUnread`（`client/sidebar-rows.tsx`） | 打平，粒度略粗 |
| 频道上下文 | 有版本号的摘要 + 源消息 ID，包是自包含的，提供方换了/压缩了也不丢共享决定（`channel-history.ts`、`channel-memory-store.ts`） | 分段 + 交接包 + 记忆（`core/src/host/parts*.ts`、`memory/`、[上下文与记忆](../plans/2026-10-09-context-and-memory.md)） | 打平。它的「摘要带源 ID 可回查」值得记一笔，但我们的分段已经能回读旧段 |

### 2.5 任务面板（我们刚做的 tasks popover）

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 数据模型 | 任务对象：id / agentId / threadId / origin（user 或 agent）/ title / state / outcome / hold / 进行中进度文案 / 错误 / 排队消息 / 时间戳（`packages/contracts/src/ipc-agent-tasks.ts`） | 不是对象：`tasks` 端点返回 running / waiting / completed 三段，从 turns 与 handoffs 实时算；完成态只留内存 40 条（`core/src/host/tasks-panel.ts`、`shared/rpc.ts`） | 已定取舍，不改。但它的**字段表**正好是一份「一个任务该说什么」的清单，可以逐项对照补我们缺的 |
| 状态 | running / queued / idle / closed 四态 + 结束原因三选（completed / failed / interrupted）（同上） | running（含 switching / tool / said）、waiting（等哪些 Bot 或群）、completed（reason: completed/error/user/hook/aborted）（`client/tasks-page.tsx` 的 `reasonText`） | 我们少 `idle`（线程开着但没在跑）与 `interrupted` 的区分；`reasonText` 已经能区分「你停的」和「Main Bot 停的」，这点比它细 |
| 排队原因 | `hold` 六种：task-limit、agent-restarting、usage-limit、server-busy、agent-busy、one-turn（`ipc-agent-tasks.ts` 的 `AGENT_TASK_HOLDS`）；侧栏还有 `limited` 态带 `resetsAt`（`sidebar-types.ts`） | 只有 `queued` 计数（`core/src/client/tasks-page.tsx`），侧栏没有「额度用完」态（`client/sidebar-rows.tsx` 的 `botState`） | **最值得补的一格**：用户看到「卡住了」时，最想知道的是「在等什么、等到什么时候」 |
| 停止 | 按线程停；关闭（归档）时要等这条线程没有排队、启动中或运行中的消息 | 按会话停，会先问一句「已经结束了，什么都没停下」而不是假装成功（`client/tasks-page.tsx` 的 `stop`），并用 `sessionId + since` 标记「这条回合已停」（`turnKey`） | 我们的**诚实反馈**比它好；它多「批量/按线程」的粒度，我们计划里写了不做多选，维持 |
| 历史与筛选 | 打开的任务在前，最近的关闭任务在后；线程有 Archived 分组；可按 agent 读列表（`AgentTasksSnapshot`、`threads/ThreadHeader.tsx`） | 重启即空，无筛选、无搜索、无分组（[tasks-panel](../plans/2026-10-28-tasks-panel.md) 的「已知限制」） | 我们缺「昨天那个跑了 20 分钟的活」。会话与消息本来就在 SQLite 里，可以**推导**而不新建对象 |
| 入口 | 注意力集中在侧栏：每个 agent / 频道一行状态，等待用户处理的行被单独归到一组；每个 agent 的副线程在聊天头部展开成 tab（`sidebar-agent-states.ts`、`SidebarChannelRow.tsx`、`threads/`、`docs/architecture/agents.md` 的 Agent threads）。我**没有找到**把所有 agent 的在跑任务并成一页的实现（未确认，可能藏在侧栏的 Routine/Tasks 视图里） | 侧栏按钮 → 弹层（`core/src/client/sidebar.tsx`、`tasks-popover.tsx`），另有一页设置（`settings.tsx` 的 `tasks`）；弹层适配窄屏（`tasks-page.tsx` 的 `@media (max-width:640px)`） | 全局看板是**我们的领先项**（它按 agent 组织，不按「现在谁在干活」组织），别丢。要补的是看板里的信息密度（3.1/3.2） |
| 打开哪些 tab | 每个设备记在 `localStorage`（`openbot:thread-tabs:v1`），关 tab 不等于关线程 | 我们只有一个会话视图，没有 tab 概念 | 不适用 |

### 2.6 浏览器与电脑

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 面板 | 独立的面板与全屏视图，带 tab 条、地址行、页面菜单、tab 菜单、快捷键；面板里还嵌着 composer 与队列（`packages/ui/src/features/browser/BrowserDock.tsx`、`BrowserFullView.tsx`、`BrowserTabStrip.tsx`、`BrowserAddressRow.tsx`） | 右侧栏两种视图：详情 / 浏览器；tab 条 + 地址 + 前进后退刷新 + 关闭；宽度可拖、可记忆（`core/src/client/browser-pane.tsx`、`browser-pane-chrome.tsx`、`details-drawer.tsx` 的 `BrowserCards`） | 打平偏弱：我们没有「在页面上直接发消息」的 dock，也没有全屏页。它把 composer 做进 dock 是合理的一步 |
| 每个 Bot 的登录态 | 三种选择：共享 / 仅此 agent / 命名 profile（多 agent 可共用一套登录），profile 是表里的行，改设置会关掉该 agent 的 tab（`src/main/browser-profile-service.ts`、`docs/architecture/browser.md` 的 Browser sessions） | 每个 Bot 一个自己的 partition，由桌面壳的 browser bridge 按 `bot:<id>` 分配（`core/src/client/bot-browsers-guest.ts` 的 `acquire()`、`platform-modules.d.ts`），页面的读要走窗口的长轮询（`core/src/host/browser.ts`） | 我们的默认更保守、也更简单。**不借**「命名 profile 跨 Bot 共用登录」 |
| 用户接管 | 接管 = 用户握住一个 tab，此期间**任何 agent 工具都不许碰它**（包括关闭），在最低层的 `#requireToolTab` 里挡；密码、验证码、passkey、支付走接管或安全输入（`docs/architecture/browser.md` 的 Tab lifetime 与 Secure browser authentication） | 未实现。今天 Bot 只能开/切页和读文本；页面动作不开放（[浏览器与电脑边界](../plans/2026-10-28-browser-and-computer-boundaries.md)） | 我们的边界文档已经定了「观察与接管分开」。它的实现给了两个可借的细节：**接管期内连关闭都挡**、**在最低层挡而不是在每个工具里挡** |
| 截图 / 实时画面 | 远端成员通过 gateway 收帧并回传指针/键盘；手机自己画指针；视口可由客户端指定（`docs/architecture/browser.md`、`BrowserLiveView.tsx`） | 面板里是真 webview；详情页的 tab 卡片只有标题 + 文本摘录（`details-drawer.tsx` 的 `bt-bcard-preview`），没有缩略图 | 差一张缩略图。做在桌面壳里成本低（S），但要想清楚「截图不许落盘、不许进模型」 |
| 远端 / 手机上的浏览器 | 有 `browser-view` 能力就能看和操作，手机是原生界面（`browser-view-*` 能力族） | 网页版直接说明「浏览器在桌面应用里」（`details-drawer.tsx`） | 我们的降级文案比它诚实。手机端浏览器**不做**（边界文档已定） |
| 电脑（Computer Use） | 每个 agent 可开，有 agent 光标、窗口高亮、权限帮助与逐步设置；服务端机器上另有显示方案（`src/renderer/src/features/computer-use/*`、`docs/architecture/computer-use.md`） | 未实现（E2）。边界已写死：默认关闭、按 Bot 开、独立容器、看不见宿主、输入 L4、观察与接管分开、一键停、审计（[同上](../plans/2026-10-28-browser-and-computer-boundaries.md)） | 我们缺实现，不缺边界。它可以借的是**可视化的「agent 正在哪、点了什么」**（光标 + 高亮），这正好服务我们的「可观察」目标 |
| 权限与审批 | 三档访问（Workspace only / Ask first / Full access）+ 单独的自动批准文件；`approvalPolicy` 保持 `on-request` | L0–L4 风险分级 + 每会话每日预算，超出逐次审批；「Always allow for this Bot」是用户给单个 Bot 调高预设（`core/src/engine/policy.ts`、`host/approvals.ts`、`client/approval-always.ts`） | 口径不同，**不改**。它的 Full access 是我们明确不做的默认放行 |

### 2.7 设置与模型

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 设置结构 | 左栏 11 个页（general / agents / notifications / voice / dynamic-island / computer-use / profile / billing / mobile-connect / updates / hosted-servers），每页带描述与「行清单」（`src/renderer/src/features/settings/settings-tabs.ts`、`packages/ui/src/components/SettingsPanel.tsx`） | 左栏 14 页（general / models / bots / groups / connectors / remote / capabilities / schedules / tasks / usage / library / secrets / feedback / about），表单在 `core/src/client/settings.tsx` 里按页分派 | 页数相当。它每页有「描述 + 行索引」，我们只有标签 |
| 设置搜索 | 有：`navItems` 的每页带「行清单」，设置窗口把页与行摊成一张索引表，按标题（再按描述）打分，命中后跳到那一行；同一份索引也接进全局搜索（`src/renderer/src/features/settings/settings-tabs.ts` 的 `rows`、`src/renderer/src/features/window/SettingsPage.tsx` 的 `SEARCH_ROWS`、`src/renderer/src/global-search-sources.ts`） | 没有搜索。我们有全局命令面板（`core/src/client/palette.tsx`），但它不索引设置里的行（`core/src/client/settings.tsx` 只是一份页面列表） | 我们有 14 页、几十行，**搜索是纯收益**，且不依赖任何新数据；我们甚至已经有一半（命令面板） |
| agent 设置 | 一个大面板：资料、头像编辑、有序保存队列、模型、权限、备用模型、通知、MCP、技能、定时、记忆、数据表，分页签（`AgentSettingsPanel.tsx`、`src/renderer/src/features/conversation/AgentSettingsPanel.tsx`） | `bot-settings.tsx` 的表单 + `capability-settings.tsx` + `memory-panel.tsx` + `schedules.tsx` + `model-menu.tsx`，同一页里纵向排 | 我们功能齐，**信息密度**不如它：它分页签，我们靠长滚动 |
| 模型选择 | 供应商 + 模型 + thinking 三件套，带搜索、分组、模型目录里「本机在用」优先（`ProviderModelPicker.tsx`、`provider-model-options.ts`、`list_models` 工具的分页规则） | 模型菜单按供应商分组、可搜、带 thinking 档位（Default + 各档）与「管理模型」入口（`core/src/client/model-menu.tsx`、`model-choice.tsx`） | 打平。它多「同一供应商多账户」与「备用模型」 |
| 备用模型 | 每个 agent 一条链：`automatic` 或指定顺序（供应商/模型/账户），额度用完或供应商报错时往下走，结果里带 `usageLimitReturn`（`BackupModels.tsx`、`docs/architecture/agents.md`） | 无（`core/src/shared/schema.ts` 的 Bot 只有 `model` / `appliedModel` / `effort`） | 整块缺失。对「长期跑着的 Bot」价值高（额度用完不至于第二天才停） |
| 上下文面板 | 环 + 分类明细（系统提示 / 记忆文件 / 工具 / 技能 / 工具结果 / 消息 / 其他）、自动压缩阈值、压缩前后 token、压缩中状态（`ContextUsage.tsx`、`AgentContextState`） | 环 + 百分比 + 「已用 / 总」，数据来自 `run-stats` 的 `contextPressure`（`core/src/client/model-context.tsx`、`model-menu.tsx` 顶部） | 我们只有总量。明细要引擎分类上报，**不是前端能算的**，要评估接缝代价 |
| 用量 | 单独的用量报告页，按 agent / 供应商出图（`packages/ui/src/features/usage/AgentUsageReport.tsx`、`UsageChart.tsx`、`docs/architecture/analytics.md`） | `usage-page.tsx` + `usage-charts.tsx` + `usage-data.ts`，带时间范围与按 Bot 的图 | 打平 |
| 通知与声音 | 单独的通知页、声音选择、Dynamic Island 页（`src/renderer/src/features/settings/` 与 `packages/ui/src/features/dynamic-island/`） | 侧栏未读 + 后台系统通知（`core/src/client/approval-notices.ts`，只针对审批）；grep 没找到任何完成音的实现 | 我们少一个「通知设置页」，也少「回合完成要不要响」这一项。S |
| 引导到宿主设置 | 不适用（一套设置） | 「Advanced settings」跳到宿主设置面板（`settings.tsx` 的 `openShellSettingsPanel`），`model-choice.tsx` 里也有多条降级路径 | 我们的两套设置并存是历史包袱，短期接受；文案上已经避免死路 |

### 2.8 多端策略

| 主题 | OpenBot 做法（文件路径） | Moon Bot 现状（文件路径） | 差距 |
|---|---|---|---|
| 端 | 桌面（Electron）、网页（`/app`，同一套视图 + 注入的 web runtime）、原生手机（Expo RN，自有界面但共享 brand token 与 contracts） | 服务托管的网页 + 桌面窗口，**同一棵客户端树**（`core/src/client`）；手机计划是响应式网页（[根 AGENTS](../../AGENTS.md#手机端)） | 我们少一整套原生壳，也少一整套同步成本。判断不变 |
| 共享 UI | `packages/ui` 一个包，桌面/网页/Storybook 共用，feature 组件按子路径导出；不得依赖 app context、桌面存储、`window.openbot`（`packages/ui/AGENTS.md`、`docs/architecture/structure.md`） | 一个目录 `core/src/client`，两种宿主（`app/ui` 窗口 + 服务网页）；桌面独有能力只能经 `client-ctx.d.ts` 的注入面出现 | 思路一样。它显式列了「共享组件禁止的依赖」，我们靠注入面 + 边界检查，等价 |
| 兼容 | 可选 host capability：`channel-chats-v1`、`agent-tasks-v1`、`browser-profiles-v1`、`queue-edit-v1`…；host 不广告就在界面上隐藏对应控件（`packages/contracts/src/team-protocol/*`） | 没有能力协商：靠「注入了什么 action」和 `LEAN` 两个开关（`core/src/shared/lean.ts`、`core/src/client/details-drawer.tsx` 里 `roster.browser === true && actions.openBrowser`） | 单机单版本时够用；一旦有「手机浏览器打开同一个服务」和「老版本窗口连新服务」，**能力清单**比 feature-detect 更可靠 |
| 桌面独有 | 明确列了哪些留在桌面：供应商与权限、应用更新（`docs/web-client.md`） | 明确列了哪些留在桌面壳：窗口控制、自动更新、搬移数据、内置浏览器（[app/AGENTS](../../apps/desktop/AGENTS.md)、`details-drawer.tsx` 的降级文案） | 打平，我们甚至写得更早。缺的是把这串清单**写进代码**（见 3.11） |
| 手机上的任务与队列 | 手机有原生队列路由、编辑面板、频道、通知、Dynamic Island（`docs/architecture/channels-and-messaging.md`） | 无手机专属交互；窄屏适配集中在 `tasks-page.tsx` 的媒体查询与 `core/src/client/design/mobile.ts`，设置页本身没有媒体查询（`core/src/client/settings.tsx`） | 我们先做「窄屏能用」，不做「手机专属交互」。顺序不变，但设置页在窄屏要先量一遍（动作 2 的验收里有一条窄屏检查） |
| 手机接入 | 设置页有「连接手机」（二维码 + 一次性连接票据），网页用 cookie、桌面用会话（`SettingsMobileConnectTab.tsx`、`docs/web-client.md`） | 服务有密码页与 HTTPS 要求（`deploy/`、`core/src/service/server.ts`），但界面里没有「怎么把手机接上」的一步 | 缺一块**上手界面**：用户不知道手机该打开哪个地址 |
| 通知 | 桌面/网页/手机三处分别有规则，含「隐藏的 tab 不响」等细节（`docs/web-client.md`、`agent-notifications`） | 只有审批会在后台发系统通知，且只在平台已授权时发、从不主动请求权限（`core/src/client/approval-notices.ts`） | 我们缺「回合完成」这类通知，也缺权限请求策略；窄屏上还要确认不重复响（`notifications` 在手机浏览器里权限模型不同） |

## 3. 可借鉴清单

工作量口径：S ≤ 0.5 天，M ≈ 1–2 天，L ≈ 3 天以上（单人，含测试与文案）。

**3.1 任务行说清「为什么还在等」**
- 想法：给 `tasks` 端点的每一行加一个 `hold`（枚举：等用户审批、模型额度用完、引擎忙、等另一个 Bot、排队中），由 host 从已有事实推算，模型永远不写这个字段。
- 为什么值得：用户看到「卡住了」时最想知道的是原因和预计。OpenBot 把它做成六种 `hold` 加侧栏 `limited` 态，说明这是真需求；我们现在只有一个 `queued` 数字。
- 落点：`core/src/host/tasks-panel.ts`（推算与字段）、`core/src/shared/rpc.ts`（`tasks` 的 response 契约）、`core/src/client/tasks-page.tsx`（一行原因 + 已有 `reasonText` 风格的文案）、`core/src/client/i18n/zh.ts`。
- 工作量：S。
- 依赖顺序：无。可与 3.2 并行。
- 风险：低。注意不要把供应商错误原文直接显示（走 `hostText`/`errorCopy`），也不要把「额度用完」写成可以一键放行的入口——那是审批红线。

**3.2 任务面板加筛选、搜索，并把「最近完成」从内存环换成可推导的历史**
- 想法：按 Bot / 群 / 状态筛选，按名字搜索；「最近完成」不新建表，改为从会话与消息里按时间取最近 N 个已结束回合（复用 `store/sessions.ts` 的读取路径）。
- 为什么值得：我们自己的文档把它列为已知限制（重启即空、无筛选）。任务面板是「观察窗」，历史留在会话里本来就是我们的事实源，读它比再写一份便宜。
- 落点：`core/src/host/tasks-panel.ts`、`core/src/client/tasks-page.tsx`（筛选 chips + 搜索框，注意 350 行上限，拆一个 `tasks-filter.tsx`）、`core/src/shared/rpc.ts`（给 `tasks` 加 `filter`/`since`）。
- 工作量：M。
- 依赖顺序：先 3.1（字段稳定后再加筛选维度）。
- 风险：中低。**不要**因此引入任务对象或新表（会与 [tasks-panel](../plans/2026-10-28-tasks-panel.md) 的取舍冲突）；如果确实要落库，迁移只能追加（[host/AGENTS](../../packages/core/src/host/AGENTS.md)）。

**3.3 排队消息面板 v1：看得见、撤得掉**
- 想法：把每个会话的排队消息列出来（预览、时间、位置），每条可撤销；编辑与重排放到 v2。
- 为什么值得：OpenBot 的 `QueuePanel` 说明这块是日常操作面（它甚至在浏览器 panel 里也嵌了一份）。用户现在唯一的选择是 steer 进当前回合，等于改不掉已经发出去的话。
- 落点：新 `core/src/host/queue.ts`（读引擎 inbox：`inbox.nextTurn`/`nextStep`，撤销用 `inbox.remove(id)`——`core/src/host/turns.ts` 已经这么用过）；`core/src/shared/rpc.ts` 加 `queue`/`queue-cancel`；新 `core/src/client/queue-panel.tsx`（≤350 行）挂在 composer 上方，`tasks-popover` 里也能开。
- 工作量：M（v1），L（含编辑/重排）。
- 依赖顺序：先 3.1（同一个「为什么等」的来源），再 v1；编辑/重排要等引擎支持文本替换，单独评估。
- 风险：中。撤销是删引擎 inbox 里的一条消息，删错会丢用户输入 → 只用 message id，返回「没找到」要如实说；**不要**做「编辑后静默重发」，那会重复计费也可能重复触发工具。

**3.4 计划块：同一条消息里原地更新的待办清单**
- 想法：给 `show_view` 加一个 `plan` 视图（条目 id、文案、pending/active/done、可选进度），同一 `viewId` 重复发送时原地更新而不是新增一条卡片；头行显示「3/7」并可折叠。
- 为什么值得：长任务里用户最需要的是「走到哪了」。OpenBot 把它做成聊天里的一等块（`TaskList.tsx`），我们现在只能让模型重复发表格。
- 落点：`core/src/shared/views.ts`（新 view 类型 + JSON schema 校验）、`core/src/client/widget-cell.tsx`（渲染 + 原地更新）、`core/src/engine/registry.ts`（工具参数说明）、规则文字（`core/src/host/` 里的提示词片段）。
- 工作量：M。
- 依赖顺序：无（可先只做渲染，再改提示词）。
- 风险：中。两个坑：一是模型会滥用（每次回话都发计划）→ 只在工具被显式调用时画；二是**不要把「当前计划」写进系统提示**，那会破坏缓存（[派活](../plans/2026-10-16-bot-handoffs.md) 已定「状态不进系统提示」）。

**3.5 回合过程面板补时间轴与「跳到某一步」**
- 想法：在「已工作 12s · 5 步」展开的面板里，给每个工具调用加开始/结束与耗时、按调用树缩进、并支持从聊天里的某条事件跳到对应步骤。
- 为什么值得：我们已经有面板（`core/src/client/work-process.tsx`），只差时间这一个维度；OpenBot 的 `TraceWaterfall.tsx` 证明这层信息对「为什么这次这么慢」是必需的。
- 落点：`core/src/client/work-process.tsx`、`core/src/client/cells-turns.tsx`（把事件时间带进节点）、`core/src/client/design/`（时间轴样式，用 `--bt-*` token）。
- 工作量：S。
- 依赖顺序：无。
- 风险：低。动效要读 `reducedMotion()`。

**3.6 群聊归档与恢复**
- 想法：给房间加 `archivedAt`；归档只是标记，停掉后续轮次、保留日志与记忆、从侧栏主列表移到「已归档」分组，可恢复；删除仍是删除。
- 为什么值得：今天「不想看见这个群」和「删掉它」之间没有中间选项，用户只能隐藏（`hidden`）或真删。数据安全角度也不该逼用户删。
- 落点：`core/src/shared/schema.ts`（RoomSchema）、`core/src/host/roster.ts` 与 `host/groups/log.ts`（归档时停轮）、`core/src/client/sidebar.tsx`（分组）、`core/src/client/group-settings.tsx`（菜单）、`core/src/shared/rpc.ts`。
- 工作量：M。
- 依赖顺序：无。与 3.7 共用同一处群菜单。
- 风险：中。**数据不可丢**：归档不删消息、不删分段、不删记忆；恢复后 `seen` 与轮次计数要自洽。加字段要走 `adopt()` 的兼容路径（旧 `state.json` 没有该字段 → 默认未归档）。

**3.7 群聊里「停 / 继续 / 换人」三个动作**
- 想法：用户停掉某个成员在群里这一轮后，群里留一张淡色卡片，写明原因与「继续」「换个人答」；换人只对下一条生效，不改历史。
- 为什么值得：现在停下就结束了，用户要重新打一遍。OpenBot 的 `ChannelStoppedTasks.tsx` 是同一思路（Stop → 卡 → Continue / 重派菜单），并且强调重派要等旧任务真正停下。
- 落点：`core/src/host/groups/rounds.ts`（保留被停的那一轮与原因）、`core/src/client/cells-tool.tsx` 的 `GroupReplies`（`kind === 'stopped'` 已有分支，扩成卡片）、`core/src/shared/rpc.ts`（`group-resume`）。
- 工作量：M。
- 依赖顺序：建议在 3.6 之后（同一片群代码，减少冲突）。
- 风险：中高。三个边界要写死：继续 = 重新起一轮，不重放工具调用；换人 = 换「谁答这一条」，不改派活树的 owner（我们没有 owner，别顺手引入）；任何「继续」都要用户点，不能自动重试（会重复计费与重复副作用）。

**3.8 设置页搜索**
- 想法：设置左栏加搜索；每页导出「页标题 + 行标题」清单，命中后定位并高亮那一行。
- 为什么值得：14 个页面、几十行，用户找「搬数据」「密码」「模型」全靠翻。这层纯前端，不碰 host。
- 落点：`core/src/client/settings.tsx`（搜索框与索引）、各页导出一份 `rows` 元数据（`bot-settings.tsx`、`capability-settings.tsx`、`secrets-page.tsx`…）、`core/src/client/i18n/zh.ts`（所有 key 都要有中文，`core/test/i18n.test.ts` 会扫）。
- 工作量：S。
- 依赖顺序：无。
- 风险：低。注意键盘可达（上下键 + Enter）与窄屏不溢出（[根 AGENTS](../../AGENTS.md#手机端)）。

**3.9 上下文面板：分类明细与压缩提示**
- 想法：在已有的环下面加一段可展开的明细（系统提示 / 工具 / 技能 / 工具结果 / 消息 / 其他）与「上次压缩 82k → 21k」；数据只信引擎给的，缺分类就整块不画，不估算。
- 为什么值得：我们有环（`model-context.tsx`），用户看到 87% 却不知道该砍什么。OpenBot 的 `ContextUsage.tsx` 把这件事讲清楚了，而且「压缩中」是单独状态。
- 落点：`core/src/host/usage/`（聚合）、`core/src/service/llm.ts` 或引擎事件（分类来源，需要评估 pi kernel 给不给）、`core/src/client/model-context.tsx`、`core/src/shared/rpc.ts` 的 `run-stats`。
- 工作量：M（若引擎不给分类则先做「压缩前后」这一半，S）。
- 依赖顺序：先确认引擎能力，再定前端形状。**不要**先画再找数。
- 风险：中。别用字符数瞎估 token 冒充真实分类——那会变成一种谎报。得不到就显示总量，这已经够用。

**3.10 每个 Bot 的备用模型链（带可见切换）**
- 想法：Bot 设置里可配「自动」或一条有序链（供应商 + 模型）；主模型额度用完或供应商报错时往下走，并在聊天里留一行「因额度切到 X」，可一键切回。
- 为什么值得：长期运行的 Bot 最怕「半夜额度用完，第二天全停」。OpenBot 的 `backupModels` + `usageLimitReturn` 证明这条链要带「从哪来、为什么走」的信息。
- 落点：`core/src/shared/schema.ts`（Bot 字段）、`core/src/host/models.ts`、`core/src/host/turns/failure.ts`（识别额度类错误）、`core/src/client/model-menu.tsx` 与 `bot-settings.tsx`（配置与那行提示）。
- 工作量：L。
- 依赖顺序：在 3.1（原因枚举）之后，两者共用「额度用完」的判定。
- 风险：高。切换必须**可见且可回退**，不许静默；按 Bot 存的 key 不许跨供应商复用；不因为切换而绕开审批预算。这是本轮清单里最该先写设计文档的一条。

**3.11 把「这台机器/这个端有什么」变成一份能力清单**
- 想法：服务在 `state` 里广告一个能力对象（如 `browser: false`、`desktopAbilities: false`、`mobile: 'web'`），客户端按它隐藏或改写控件，而不是靠「有没有注入某个 action」逐个试。
- 为什么值得：我们已经有 `roster.browser === true` 这种单点判断和 `LEAN` 开关；一到「手机浏览器打开同一个服务」「老窗口连新服务」就会散成很多个 if。OpenBot 用可选 capability 把这件事统一了（`channel-chats-v1` 等）。
- 落点：`core/src/shared/views.ts`（`capabilities` 现在是插件列表，别混用，新增一段 `features`）、`core/src/host/` 的 state 组装、`core/src/client/client-ctx.d.ts`（降级面）、`details-drawer.tsx` 等调用点。
- 工作量：S/M。
- 依赖顺序：无，但越早越省事。
- 风险：低。注意 `capabilities` 现有字段别改语义（客户端在用它列插件）。

**3.12 「手机访问」设置页：地址、二维码、一次性口令**
- 想法：设置里加一页，显示当前服务的局域网地址与一个二维码、一个按钮生成一次性口令；提示必须先设 `MOON_BOT_PASSWORD` 且外网走 HTTPS。
- 为什么值得：手机方案定了「浏览器打开同一个地址」（阶段 D），但界面里没有任何一步告诉用户地址是什么。OpenBot 的 `SettingsMobileConnectTab.tsx` 就是这一页。
- 落点：`core/src/client/settings.tsx`（新页）、`core/src/client/qr.tsx`（自己画，别引第三方 logo/图形）、`core/src/host/`（一次性口令，存 hash 不存明文）、`core/src/service/server.ts`（非 loopback 必须密码，已有校验）。
- 工作量：M。
- 依赖顺序：在阶段 D 的证书/远程接入设计确认之后；可先做「只显示地址」的 S 版本。
- 风险：中。口令一次性、有有效期；`diagnostics.ts` 的 `cleanText` 要能抹掉它；二维码不许指向带口令的长期 URL。

**3.13 浏览器面板的「只读观察 / 用户接管」两态**
- 想法：面板上加一个状态条：平时是「Bot 在用（只读给你看）」，点「接管」后变成「你在用，Bot 停手」，接管期内 Bot 的任何浏览器动作都被拒绝并如实回报；退出接管再交还。
- 为什么值得：我们的边界文档已经定了这条原则（观察与接管分开），但今天没有可操作的入口；OpenBot 的实现给了两个可借的细节——接管期内连关闭都挡、在最底层挡。
- 落点：`core/src/client/browser-pane.tsx` 与 `browser-pane-chrome.tsx`（状态条与按钮）、`core/src/host/browser.ts`（一个「此 Bot 的页面被用户握住」的标记，最低层的读取入口统一检查）、[边界文档](../plans/2026-10-28-browser-and-computer-boundaries.md) 补一段「接管的实现口径」。
- 工作量：M。
- 依赖顺序：先补设计文档（改的是已定设计的实现口径，需要维护者确认），再动代码。
- 风险：高（红线相邻）。接管只给**用户**输入，绝不因此给 Bot 输入；不做 `approvalPolicy: never` 的等价物；不因为接管而放宽任何审批。

**3.14 详情页的浏览器 tab 卡片用本机截图缩略**
- 想法：tab 卡片从「标题 + 文本摘录」升级为「缩略图 + 标题 + 域名」，缩略图只在本机生成、只在内存、不落盘、不进模型。
- 为什么值得：现在卡片是文字，用户要开一次才知道是哪一页。桌面壳已经有 webview，截一张的成本很低（OpenBot 走的是更重的实时帧，我们不需要）。
- 落点：`core/src/client/bot-browsers.ts` / `bot-browsers-guest.ts`（取图）、`core/src/client/platform-modules.d.ts`（注入面加一个 capture 能力）、`core/src/client/details-drawer.tsx` 的 `BrowserCards`。
- 工作量：S。
- 依赖顺序：可与 3.13 并行。
- 风险：中。截图可能含用户隐私 → 只存内存、只画给本机、网页版继续走「浏览器在桌面应用里」的降级文案。

**3.15 首启与新建 Bot 的角色模板**
- 想法：新建 Bot 时先给 3–4 个原创角色（例如「研究助手」「写手」「代码审查」「日程管家」），点一下预填名字、角色标签、指令骨架，用户再改；模板不预置任何权限。
- 为什么值得：OpenBot 把「第一个 agent 是什么」用三条命名建议接过去了（`FIRST_AGENT_SUGGESTIONS`）；我们的表单是纯空白，中文用户第一屏就要自己想角色，而「空白页综合征」在创建第一步最容易掉人。
- 落点：`core/src/client/create-bot.tsx`（模板行）、`core/src/client/bot-draft.ts`（预填）、`core/src/shared/schema.ts`（复用现有 `role`/`instructions`，不加字段）、`core/src/client/i18n/zh.ts`。
- 工作量：S。
- 依赖顺序：无。
- 风险：低，但**文案必须原创**：不能照搬它的角色描述或任何界面文字；模板只写名字/角色/指令，不带模型、不带权限、不带预设的「放行」。

**3.16 定时任务的静默收尾**
- 想法：定时或脚本触发的回合，如果没产生任何交付物、问题或需要用户看的东西，就只留一行记录，不计未读、不弹通知；用户点开任务面板仍能看到它跑过。
- 为什么值得：长期运行的 Bot 每天跑十几次定时任务，「每次都提醒」会让人关掉通知——那反而更危险（真出事时也看不到）。OpenBot 用一个静默回合标记加一个显式工具做这件事。
- 落点：`core/src/host/schedules.ts`（触发来源标记）、`core/src/host/turns/delivery.ts`（结束后判断是否静默）、`core/src/client/approval-notices.ts` 邻域与 `core/src/client/sidebar-rows.tsx` 的未读判断、`core/src/client/tasks-page.tsx`（静默回合仍出现在「最近完成」）。
- 工作量：M。
- 依赖顺序：在 3.2 之后（否则静默的东西没有地方回看）。
- 风险：中。只对「定时/脚本」来源生效，用户对话永不静默；静默的判定要保守（有交付物/有问题/有失败就不静默）。

## 4. 明确不要借鉴

| 不借的东西 | 它的做法（路径） | 理由 |
|---|---|---|
| 任务对象 + 线程 tab 的全生命周期（archive / rename / delete / undo / 每线程读标记 / 本地记 tab） | `packages/contracts/src/ipc-agent-tasks.ts`、`packages/ui/src/features/conversation/threads/*`、`src/backend/agent-threads/*` | 与已定设计冲突：[tasks-panel](../plans/2026-10-28-tasks-panel.md) 明确「不新建任务对象」，理由是两套事实会打架。它的那套要迁移、要读标记表、要 undo toast、要在三种端上一致，成本远超收益。我们需要的是**字段清单**（3.1/3.2），不是对象 |
| 频道里由 lead 用模型给每条请求选 owner | `src/backend/channel-service.ts`、`docs/architecture/channels-and-messaging.md` | 每条群消息一次路由模型调用，成本与延迟都不可控，而且「谁来做」变成模型判断，和「Bot 守在自己的目标里」冲突。我们的 `@` 提及 + 管理员先答更可预测。只借「选择必须可见」这一点（我们已经有事件行） |
| 每个 agent 的 Full access（自动放行）三档 | `docs/architecture/structure.md` 的 `openbot-approval-automation-v3.json` 段、`agent-access.ts` | 红线。我们不做 `approvalPolicy: never` 的等价物，也不做「默认无限预算/静默放行」。我们的「Always allow for this Bot」是用户主动调高单个 Bot 的预设，不是产品默认（[根 AGENTS](../../AGENTS.md#安全与审批)） |
| 命名浏览器 profile：多个 agent 共用一套登录 | `src/main/browser-profile-service.ts`、`docs/architecture/browser.md` | 与「不跨 Bot 共享会话/cookie」的方向相反。我们每个 Bot 一个 partition 已经是更好的默认 |
| 排队消息的「编辑持锁」协议（编辑身份、跨重启草稿、失败重试、保存/取消/删除三态事务） | `QueuePanel.tsx`、`docs/architecture/channels-and-messaging.md` 的 Mobile chat queue | 我们连队列面板都还没有，先做 v1（看 + 撤）。持锁是为了多端同时编辑同一条，我们单端单用户，代价不值。等 v2 再评估「编辑 = 撤销 + 重发」的简单版本 |
| 浏览器实时帧 + 远端指针/键盘回传 + 手机原生指针 | `docs/architecture/browser.md`、`packages/ui/src/features/browser/BrowserLiveView.tsx` | 我们的边界文档把电脑与浏览器定在「桌面壳内、独立分区、Bot 只读」，把远端注入这条路整个关掉是刻意的。做它等于把最容易漏的缝（远端输入）打开 |
| Computer Use 的默认开启与「操作用户整台机器」 | `src/renderer/src/features/computer-use/*`、`docs/architecture/computer-use.md` | 红线，边界文档已经写死「默认关闭、独立容器、看不见宿主、输入 L4、观察与接管分开」。可以借的是「光标 + 高亮」这种**可观察**的表达，不是权限模型 |
| 消息内联 HTML 可视化回复（沙箱 frame + postMessage 协议 + 快捷方式白名单） | `docs/architecture/agents.md` 的 `html_render` 段、`ChatVisual.tsx`、`chat-visual-shortcuts.ts` | 我们已经有声明式的 `show_view`（表/选项/进度/表单/差异），够表达最常见的结构化回复。再开一个任意 HTML 的注入面，会扩大 XSS、外链与「页面能反过来操作应用」的边界，收益不抵风险。真要富展示，走 3.4 这种受控视图 |
| 原生手机 App（Expo）+ Dynamic Island / Live Activity + 每端一套队列与频道界面 | `apps/mobile/AGENTS.md`、`docs/architecture/channels-and-messaging.md` | 与既定策略冲突（[根 AGENTS](../../AGENTS.md#手机端)：先做响应式网页，不上架）。它也带来三端同步成本 |
| 账号体系、订阅计费、托管服务器、市场发布 | `apps/auth-api/`、`marketplace/`、`docs/architecture/servers.md` | 我们是自托管/本地优先，没有账号也没有计费。模板的「发布成链接」那半依赖账号，整块不做；只做本地的角色模板（3.15） |
| 首启的「免费 vs 订阅」二选一 | `FirstRunChoice.tsx` | 那套的前提是它自己提供免费模型和订阅接入。我们没有这条供给，抄结构只会得到一个死路。可借的只是「首启先把模型解决掉」这个顺序（我们已经在聊天里问） |

## 5. 建议的前 3 个动作

### 动作 1：任务行说清「为什么在等」，并加上按状态/Bot 的筛选

- 范围：`core/src/host/tasks-panel.ts`、`core/src/shared/rpc.ts`（`tasks` 契约）、`core/src/client/tasks-page.tsx`（可能拆出 `tasks-filter.tsx`）、`core/src/client/i18n/zh.ts`。
- 做：① running / waiting 行加 `hold`，取值只从已有事实推：有未答审批 → `approval`；`pendingTurns()>0` → `queued`；最近一次失败是额度类错误 → `limit`；有上游未交回的活 → `handoff`；否则不出现。② 面板加一排筛选（全部 / 在跑 / 在等 / 已完成）与一个搜索框（按 Bot 名或群名）。
- 验收标准：
  - `tasks` 端点返回的每行在「有原因」时带 `hold`，无原因时不带该字段；`shared/rpc.ts` 的类型同步。
  - 任务弹层与设置页共用同一份渲染，两处行为一致。
  - host 单测覆盖五种 `hold` 的判定（用 `core/test/fake-ctx.ts`，不起真服务）；组件测试覆盖「无原因不显示空标签」。
  - `npm test`、`npm run typecheck`、`npm run lint` 全绿；`core/dev/bench.sh` 起实例，在浏览器里真实看到一次「等审批」的行。
- 不做什么：不引入任务对象、不动完成态的 40 条内存环（那是 3.2 的范围，不在这三个动作里）。

### 动作 2：排队消息面板 v1（列出 + 撤销）

- 范围：新 `core/src/host/queue.ts`、`core/src/shared/rpc.ts`（`queue` / `queue-cancel`）、新 `core/src/client/queue-panel.tsx`、composer 上方挂载点（与 `tasks-page.tsx` 的 `queued` 保持一致）。
- 做：① 读每个会话的引擎 inbox（`inbox.nextTurn` / `nextStep`），返回预览（截断）、时间、位置；② 撤销一条（`inbox.remove(id)`），返回是否找到；③ 面板随 SSE 刷新，空时不占位。
- 验收标准：
  - 发一条消息 → 回合还在跑时再发一条 → 面板里出现第二条，带预览与时间。
  - 点撤销 → 该条从面板消失，回合一结束不会被执行；「已经跑起来了」的情况返回 `cancelled: false`，界面如实说「已经开始了，撤不回来」。
  - 不在 inbox 里的 id 一律返回 false，不做任何副作用（幂等）。
  - 单测用假 inbox 覆盖三种情况（找到 / 已开始 / 不存在）；`npm test`、`typecheck`、`lint` 全绿；窄屏（≤640px）不溢出。
- 不做什么：不做编辑、不做拖动重排、不做「转成新会话」；不碰审批与策略。

### 动作 3：群聊归档与恢复

- 范围：`core/src/shared/schema.ts`（RoomSchema 加 `archivedAt`）、`core/src/host/roster.ts` + `store.ts` 的 `adopt()`（旧数据默认未归档）、`core/src/host/groups/log.ts`（归档时停轮）、`core/src/client/sidebar.tsx`（「已归档」分组）、`core/src/client/group-settings.tsx`（菜单：归档 / 恢复）、`core/src/shared/rpc.ts`。
- 做：① 归档 = 标记 + 停止后续轮次 + 从主列表移出；② 恢复 = 清标记 + 回到列表原位；③ 删除保持现状（只有用户在删除入口明确确认才删）。
- 验收标准：
  - 归档一个群后：侧栏主列表不再有它，「已归档」分组里有；群里的日志、成员、公告、记忆、分段一个都没少（归档前后读同一份 `state.json`，diff 只应该多一个字段）。
  - 恢复后能继续发言，轮次计数与 `seen` 不跳变。
  - 旧 `state.json`（没有该字段）打开不报错，视为未归档；`core/test/store.test.ts` 补一条。
  - 「归档不等于删除」在文案里说清（`i18n/zh.ts`）；`npm test`、`typecheck`、`lint` 全绿。
- 不做什么：不动删除路径的语义；不给群加「归档自动过期」。

## 附：证据索引

- OpenBot 文档：`docs/ARCHITECTURE.md`、`docs/architecture/structure.md`、`docs/architecture/agents.md`（Agent threads / Prompt-driven agent profiles / Agent import / Instance transfer / Agent templates）、`docs/architecture/channels-and-messaging.md`（Shared channel chats / Mobile chat queue）、`docs/architecture/browser.md`（Browser client / Browser sessions / Tab lifetime）、`docs/architecture/computer-use.md`、`docs/web-client.md`（Behavior and limits）。
- OpenBot 契约与实现：`packages/contracts/src/ipc-agent-tasks.ts`、`packages/ui/src/features/conversation/{ComposerEditor,composer-tokens,composer-picker,QueuePanel,TaskList,AgentSteps,TraceWaterfall,Subagents,OpenWaits,ContextUsage,MessageRendering,AttachmentCards}.tsx`、`packages/ui/src/features/conversation/threads/*`、`packages/ui/src/features/browser/{BrowserDock,BrowserLiveView,BrowserTabStrip}.tsx`、`packages/ui/src/features/channels/ChannelStoppedTasks.tsx`、`packages/ui/src/features/agents/{PublishAgentDialog,AgentTemplateInstallDialog,FirstAgentSetup}.tsx`、`packages/ui/src/components/ProviderModelPicker.tsx`、`src/renderer/src/features/onboarding/*`、`src/renderer/src/features/settings/settings-tabs.ts`、`src/renderer/src/features/agent-tasks/*`、`src/backend/channel-service.ts`、`src/backend/agent-threads/*`、`src/main/{agent-template-service,instance-transfer-service,agent-import-manifest,browser-profile-service}.ts`。
- Moon Bot：`core/src/client/{composer,at-menu,ime-guard,tasks-page,tasks-popover,sidebar,sidebar-rows,settings,group-settings,model-menu,model-context,cells-tool,cells-turns,work-process,deliver-cards,widget-cell,details-drawer,browser-pane,browser-pane-chrome,create-bot,starters,palette,approval-notices}.tsx`、`core/src/client/{bot-browsers,bot-browsers-guest,client-ctx,platform-modules,i18n}.ts`、`core/src/host/{tasks-panel,handoffs,groups,approvals,browser,delivery,turns}.ts`、`core/src/host/groups/{log,rounds}.ts`、`core/src/host/usage/*`、`core/src/shared/{rpc,schema,views,lean}.ts`、`app/src/{first-run,move-data}.ts`、`docs/plans/{2026-10-28-tasks-panel,2026-10-16-bot-handoffs,2026-10-07-group-chat,2026-10-28-browser-and-computer-boundaries}.md`。

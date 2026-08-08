# PartSignal Frontend V2 全页面与业务流程蓝图

## 1. 页面 Pattern

V2 只定义五种主要页面 Pattern：

- **Table**：扫描、比较、筛选大量同类对象。
- **List**：数量不大，但每项需要多行语义摘要。
- **Workspace**：编辑、审核、状态推进，同时需要上下文/参考。
- **Detail**：只读对象、不可变历史、证据、Timeline。
- **Analytics Workspace**：KPI、趋势、维度分析、Recommendations。

---

# 2. 工作台 `/`

Pattern：Operations Inbox / Workspace。

首页只回答“现在最需要我处理什么”。推荐结构：

```text
早上好，<User>

需要你处理                         12
事实审核            3
内容审核            4
待核验发布          2
发布异常            1
GEO 准确性问题      2

──────────────────────────
重点流程
事实 / 内容 / 发布

──────────────────────────
GEO
发现率       提及率       准确率
最近异常
```

每项待办直接深链接到具体 Workspace。不做“快捷入口”宫格；Sidebar 已承担导航。

---

# 3. 产品事实

## 3.1 `/products`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 产品 | 型号；第二行品牌 |
| 类别 | 产品类别 |
| 事实状态 | 未录入 / 待审核 / 已批准 / 待修订 |
| 当前事实 | `Approved vN` / `Pending vN` |
| 最近更新 | 相对时间 + tooltip 精确时间 |
| 操作 | Primary + `•••` |

Primary 由 `primary_task` 穷尽映射：`ENTER_FACTS`→录入事实、`SUBMIT_FACT_REVIEW`→提交审核、`REVIEW_FACT`→审核、`REVISE_FACT`→修订、`CREATE_CONTENT_TASK`→创建内容、`VIEW_FACT_HISTORY`→查看事实历史。

点击产品名称/行进入 `/products/$productId`，不常驻“查看”。

## 3.2 `/products/$productId`

Pattern：Detail。

展示型号、品牌、类别、当前批准事实、待审核事实、内容任务摘要、发布成果摘要、GEO 摘要、Activity。详情页不承担事实正文编辑。

## 3.3 `/products/$productId/facts`

Pattern：Workspace。

```text
┌───────────────┬──────────────────────────┬──────────────────┐
│ Product       │ Fact Markdown            │ Evidence/Status  │
│ Context       │                          │                  │
│ 型号/品牌/类别 │ CodeMirror               │ 数据级别         │
│ 当前批准 v3   │                          │ Evidence URLs    │
│ 待审核 v4     │                          │ Revision         │
└───────────────┴──────────────────────────┴──────────────────┘

                              [提交事实审核]
```

Markdown 是唯一编辑源；提交后创建不可变 `PENDING_REVIEW` snapshot。

## 3.4 `/products/$productId/facts/review`

Pattern：Workspace。左侧不可变 Fact Snapshot/Evidence，右侧 Diff、Blocking Issues、Review History；底部 `[退回修改] [批准事实]`。

## 3.5 Fact History

历史列表列：版本、状态、数据级别、变更摘要、提交人、提交时间。**没有操作列**。点击行进入 `/products/$productId/facts/versions/$versionId` 只读 Detail。

---

# 4. 内容生产

## 4.1 `/content/tasks`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 任务 | 产品型号 + task identifier |
| 目标平台 | Platform |
| 当前阶段 | 生成中 / 草稿 / 待审核 / 待发布 / 发布处理中 / 完成 |
| 当前内容 | `vN · AI/HUMAN` |
| 最近更新 | Time |
| 操作 | Primary + `•••` |

普通列表不同时展示 Task Status、Generation Status、Content Status、Publication Status；由服务端 `workflow_stage` 聚合成用户理解的当前阶段。

## 4.2 `/content/tasks/new`

Pattern：Form。字段建议：Product、Approved Fact Version、Target Platform、Topic/GEO Source、Content Intent、generation/manual mode、notes。

## 4.3 `/content/tasks/$taskId`

Pattern：Detail / Workspace Shell。展示 Product、Target Platform、Current Fact Version、Current Content Version、Generation Job、Review、Publishing、Timeline、Source GEO context。Primary Action 始终消费服务端 `primary_task`。

## 4.4 `/content/tasks/$taskId/editor`

Pattern：三栏 Workspace。

```text
┌──────────────┬─────────────────────────────┬─────────────────┐
│ Context      │ Document                    │ Reference       │
│ 280px        │ flex                        │ 360px           │
│ 产品         │ 标题/摘要                    │ 产品事实         │
│ 平台         │ Markdown                    │ Quality         │
│ Prompt       │                             │ AI Snapshot     │
│ Model/Job    │                             │ Diff/Warnings   │
└──────────────┴─────────────────────────────┴─────────────────┘
```

顶部 `[编辑] [分屏] [预览] [Diff]`；底部 Sticky Action Bar 显示保存状态和 `[提交审核]`。

编辑入口围绕 Task；`ContentTask.current_content_version_id` 决定当前内容。`/content/versions/$versionId` 只负责历史版本。

## 4.5 `/content/tasks/$taskId/review`

Pattern：Workspace。主区域是 immutable Markdown，右侧 Review Panel 展示 blocking issues、warnings、fact consistency、platform adaptation、review timeline；底部 `[退回修改] [批准内容]`。

Review Context 应一次加载 content、diff、quality issues、fact markdown、generation snapshot、review timeline。

## 4.6 `/content/versions/$versionId`

Pattern：Detail。展示 title/summary/Markdown、source AI/HUMAN、fact version、Prompt/model snapshot、content hash、creator、change note、review result、timeline。不可直接修改。

---

# 5. 发布管理

## 5.1 `/publishing/work`

Pattern：Queue + Table。

顶部摘要：待开始、进行中、待核验、需处理。

Ready candidate 还不是 `PublicationWork`，用 Queue List：标题、平台、Approved version、可用账号、`[开始发布]`。

Active Work Table：

| 列 | 内容 |
|---|---|
| 内容 | 标题 + Product |
| 平台 / 账号 | Platform + account label |
| 当前阶段 | Preparing / 平台审核 / 待核验 / 需处理 |
| 最近情况 | 最近关键事件 |
| 更新时间 | Time |
| 操作 | Primary + `•••` |

## 5.2 `/publishing/work/$workId`

Pattern：Workspace。包含 Approved Content、Publishing Instruction、Account、Target Section、Current Stage、Evidence、Verification History、Publication Event Timeline。

可能动作：复制发布包、登记结果、执行核验、重新核验、切换批准版本、关闭工作。所有写操作尊重服务端 revision/current state。

## 5.3 `/publishing/articles`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 发布内容 | 标题 + URL domain |
| 平台 / 账号 | Platform + account |
| 发布时间 | actual time |
| 首次核验 | Passed |
| 内容健康 | 正常 / 有开放问题 / Retired |
| 操作 | 仅存在业务动作时 |

点击标题进入 Detail。

## 5.4 `/publishing/articles/$articleId`

Pattern：Detail。展示 Final URL、Actual title、Publish time、Platform、Account、Approved content snapshot、First successful verification snapshot、Publication timeline、GEO references、Content Issues。成果正文和成功核验 snapshot 不允许编辑。

## 5.5 `/publishing/issues`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 问题 | 发布文章 + issue type |
| 平台 | Platform |
| 状态 | OPEN / RESOLVED |
| 打开时间 | Time |
| 修复任务 | Task link / 未创建 |
| 操作 | Primary + `•••` |

Primary 可能是 `CREATE_REPAIR_TASK` 或 `RESOLVE_ISSUE`。

## 5.6 `/publishing/issues/$issueId`

Pattern：Workspace。包含 Published Article context、Issue detail、evidence、repair task、resolution note、timeline。

---

# 6. GEO

## 6.1 `/geo/observations`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 查询 | 标准问题/搜索词；第二行 Product |
| GEO 平台 | ChatGPT / Gemini / ... |
| 结果 | 发现 / 提及 / 准确 compact indicators |
| 关联成果 | N 篇 |
| 证据 | Screenshot indicator |
| 记录人 | User |
| 观测时间 | Time |
| 操作 | `•••`，仅有更正/删除资格时 |

整行/主列进入详情，不常驻“查看详情”。

## 6.2 `/geo/observations/new`

Pattern：Workspace。支持一次人工搜索记录 query/topic、product、GEO platform、discovered/mentioned/recommended/cited/accuracy、related articles、evidence screenshot、notes。

## 6.3 `/geo/observations/$observationId`

Pattern：Detail。展示完整问题、平台、产品、结果事实、关联文章、证据、记录人、correction history。

## 6.4 `/geo/observations/$observationId/correct`

Pattern：Workspace。必须明确“追加 Correction，不是原地修改 Observation”：

```text
Original                         Correction
原结论                           新结论
原 evidence                      新 evidence
原备注                           更正原因
                              [提交更正]
```

## 6.5 `/geo/topics`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 标准问题 | Primary text |
| 意图 | Intent |
| 变体 | 前 1~2 个 + `+N` |
| 业务引用 | Task / Optimization / Observation 摘要 |
| 操作 | `开始观测` + `•••` |

Overflow：编辑、删除、查看删除条件/引用情况。

## 6.6 `/geo/insights`

Pattern：Analytics Workspace。

```text
Filter Bar
Discovery / Mention / Accuracy
Trend
Platform Performance
Content Performance
  ├ Best
  ├ Declining
  └ Long Unmentioned
Question Coverage
Recommendations
```

日期、产品、GEO 平台等筛选进入 URL。“创建优化任务”必须由服务端重新验证异常；print view 复用同一 read model。

---

# 7. 业务配置

## 7.1 `/settings/platforms`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 平台 | Logo + Name |
| 类型 | Category |
| 配置状态 | 完整 / 缺 Prompt / 缺账号 |
| 发布账号 | N 个可用 |
| 状态 | Enabled / Disabled |
| 更新时间 | Time |
| 操作 | Primary + `•••` |

官网 URL、allowed domains 等细节进入 Workspace。

## 7.2 `/settings/platforms/$platformId`

Pattern：Workspace。顶部 `[概览] [发布账号] [生成配置]`。

账号表在平台上下文中不重复“平台”列：业务标签、内部账号标识、状态、操作。

## 7.3 `/settings/platforms/types`

Pattern：Settings Table。列：名称、Slug、平台数量、`•••`。不占 Sidebar。

## 7.4 `/settings/prompts`

Pattern：List + Workspace。

```text
┌────────────────┬─────────────────────────┬────────────────────┐
│ Prompt Library │ Prompt Editor           │ Preview            │
│ Search/Filter  │ Prompt Name/revision    │ Test Context       │
│ Prompt list    │ CodeMirror              │ Rendered Output    │
│                │                         │ Bound Platforms    │
└────────────────┴─────────────────────────┴────────────────────┘
```

保留 revision、dirty handling、line/word count、真实 preview、bound platform。

## 7.5 `/settings/ai`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 渠道 | Provider icon + Name |
| Provider / Protocol | OpenAI Compatible 等 |
| 状态 | Enabled |
| 模型 | 3 Enabled / 4 |
| 连接状态 | Passed / Failed / Untested |
| 配置状态 | Ready / Needs setup |
| 操作 | Primary + `•••` |

列表不直接展示 API key、headers、完整 base URL。

## 7.6 `/settings/ai/$channelId`

Pattern：Workspace。建议 sections：基本、请求、模型、使用、日志。Models 表只保留模型、状态、连接测试、最近测试、操作。

---

# 8. 系统

## 8.1 `/system/users`

Pattern：Table。

| 列 | 内容 |
|---|---|
| 用户 | Avatar + Display name + `@username` |
| 角色 | ADMIN / ENGINEER |
| 状态 | Enabled / Disabled |
| 登录安全 | 正常 / 必须修改密码 |
| 创建时间 | Time |
| 操作 | Primary + `•••` |

只有选择用户后出现 BulkActionBar：`3 selected [启用] [停用] [清除选择]`。

## 8.2 `/system/audit`

Pattern：Table + Detail Pane。

列：时间、操作者、模块、动作、对象、结果、Request ID。**没有操作列**。点击 row：Desktop 右侧 Detail Pane，Mobile Sheet。

---

# 9. 全局操作列标准

Desktop 统一：

```text
[Primary] [•••]
```

建议标准 action zone：144px。业务页面不得随意定义 154/160/168/180/220/280 等不同宽度。

对象名称或整行就是详情入口；禁止常驻“查看/查看详情/查看日志详情”。

Primary 每行最多一个；低频和危险操作进入 overflow，危险项二次确认。

---

# 10. Responsive

- `>=1280`：完整 Table / 三栏 Workspace。
- `1024–1279`：收缩 side panes，非关键 metadata 收起。
- `768–1023`：Workspace 改双栏/Tabs；表格保留核心列。
- `<768`：宽表转 mobile list pattern；reference/context 用 Sheet/Tabs；Sticky action 适配 safe area。

至少验收：375 / 768 / 1024 / 1440。

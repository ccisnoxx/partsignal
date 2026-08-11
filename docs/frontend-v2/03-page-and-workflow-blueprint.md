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

PageHeader 只提供一个 `[新建产品]` Primary，进入 `/products/new`；创建资格不由前端角色推断，最终权限由服务端判断。

## 3.2 `/products/new`

Pattern：Form。页面只收集产品型号、品牌和类别，三个字段去除两侧空白后必填且不超过 160 字符。表单使用 Form Kit 与 DirtyGuard；pending 时禁止重复提交和造成状态丢失的操作，服务端字段错误进入字段与 ErrorSummary，其他错误进入 form summary，并始终展示 `request_id`。

成功创建后失效 Products list query，并依据 canonical `Product.id` 进入 `/products/$productId`；不得把 `Product` 写成 `ProductListItem` cache，也不得跳转尚未实现的 Fact Workspace。Cancel 返回 `/products`。

## 3.3 `/products/$productId`

Pattern：Detail。

页面按 Header → Summary → Metadata → Facts → Content → Publishing → GEO → Activity 展示型号、品牌、类别、产品状态、workflow stage、当前批准事实、当前待审核或待修订事实、内容任务摘要、发布成果摘要、GEO 指标与最近 Activity。空摘要明确显示“暂无”，历史事实只链接后续 readonly route，详情页不展示或编辑事实正文。

页面只请求 `GET /api/v1/products/{product_id}/detail`。`primary_task` 形成唯一 Primary，`available_actions` 进入 overflow；前端不从状态、事实或关联数量推导动作。Products List 的 UPDATE 进入本详情页，详情 Dialog 只编辑型号、品牌、类别和产品状态，并提交 `ProductUpdate.expected_revision`；`REVISION_CONFLICT` 与 `IMMUTABLE_VERSION` 都显示服务端错误并刷新 canonical detail。

## 3.4 `/products/$productId/facts`

Pattern：Workspace。

```text
┌───────────────┬──────────────────────────┬──────────────────┐
│ Product       │ Fact Markdown            │ Status/Data      │
│ Context       │                          │                  │
│ 型号/品牌/类别 │ CodeMirror               │ 数据级别         │
│ 当前批准 v3   │                          │ Workflow stage   │
│ 待审核 v4     │                          │ Revision         │
└───────────────┴──────────────────────────┴──────────────────┘

                              [提交事实审核]
```

页面只请求 `GET /api/v1/products/{product_id}/facts`，一次获得只读 Product Context、Markdown 草稿、数据级别、revision、当前批准/待审核摘要、workflow stage 与 `available_actions`，不得在浏览器拼接 Product Detail 或事实版本接口。当前权威数据模型没有 Evidence URL；本页不恢复旧 evidence 表，也不创建 Markdown 之外的第二个可编辑事实来源。

Markdown 是唯一编辑源。保存与提交都发送当前基线的 `expected_revision`；保存成功采用服务端 canonical workspace response，冲突时保留本地内容并提供显式 reload。提交只允许 clean 草稿，服务端从已保存内容创建不可变 `PENDING_REVIEW` snapshot，页面刷新 actions 和摘要但停留当前路由。动作入口只由 `available_actions` 决定；DirtyGuard 覆盖应用内导航与浏览器离开。

## 3.5 `/products/$productId/facts/review`

Pattern：Workspace。页面只请求 `GET /api/v1/products/{product_id}/fact-review-context`，由服务端优先定位唯一 `PENDING_REVIEW` 版本，否则返回该产品最新 FactVersion；产品存在但没有事实版本时返回 empty context。浏览器不得通过 Product Detail、Facts 或版本列表拼接审核目标。

主区使用只读 Markdown Preview 展示不可变 Fact Snapshot；上下文区显示数据级别、版本、状态、提交摘要和 revision；参考区显示服务端基于紧邻前序 FactVersion 计算的 Diff，以及仅属于目标 `fact_version_id` 的 Review History。当前事实模型没有 Evidence 或 Blocking Issues，本页不恢复 Evidence，也不创建页面本地质量规则或占位结果。

底部动作只消费 `available_actions` 中的 `APPROVE` / `REQUEST_CHANGES`。两者发送 CSRF 与 `expected_revision`，退回意见必须非空；服务端仍最终校验权限、状态、revision 和意见。成功后采用 canonical FactVersion 并刷新当前 context，409 不自动重放命令，审核完成后停留当前 route。

## 3.6 `/products/$productId/facts/versions?page=1&pageSize=20`

Pattern：readonly Table。历史列表列严格为版本、状态、数据级别、变更摘要、提交人、提交时间，**没有操作列**。版本链接进入 `/products/$productId/facts/versions/$versionId` 只读 Detail；页面不展示或推导任何审核、退回、停用、删除或编辑命令。

页面与 query 归 `domains/product`，thin route 只管理 `page`/`pageSize` canonical search、prefetch 和导航。页面只请求 `GET /api/v1/products/{product_id}/fact-history`，一次获得 Product identity、由服务端按 `version DESC` 排好的当前页及 `total`；不得请求 Product Detail 拼标题，也不得用既有详情型 `FactVersionList` 在客户端分页或重排。`VIEW_FACT_HISTORY`、Product Detail 的完整历史入口和 Fact Version Detail 的返回入口都指向该 canonical URL。

响应的 `product.id` 及每个 item 的 `product_id` 必须与 URL `productId` 大小写不敏感地精确一致；任一不一致都阻断整张表。页面明确标记只读、不可编辑，使用既有 Table loading/empty/error/retry 与分页模式，并把 `page`、`pageSize` 始终保留在 URL。

## 3.7 `/products/$productId/facts/versions/$versionId`

Pattern：readonly Detail。页面只请求 `GET /api/v1/fact-versions/{fact_version_id}`，展示版本号、状态、不可变 Markdown snapshot、数据级别、change summary、revision、版本与产品 UUID、创建信息，以及存在时的审批信息。人员按现有合同显示 UUID；不得额外请求用户、Product Detail、Facts、Review Context 或版本列表补全上下文。

响应的 `FactVersion.product_id` 必须与 URL `productId` 大小写不敏感地精确一致；不一致时阻断全部 snapshot 内容，并显示该版本不存在或不属于当前产品。页面明确标记 readonly/immutable，不使用表单、CodeMirror、DirtyGuard、保存或自动保存，也不展示或推导 APPROVE、REQUEST_CHANGES、RETIRE、DELETE 等命令。

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

列表一次消费 `ContentTaskListItem`：任务标识、Product/Platform summary、当前主线摘要、`workflow_stage`、`primary_task`、`available_actions`、`deletion/revision` 与 `updated_at` 均由服务端投影。`q/workflowStage/archiveStatus/platformId/page/pageSize` 进入 canonical URL 并由服务端处理；页面不得请求 ContentVersion、GenerationJob、Product、Publication 等接口补行。

列表直接实现 `CANCEL/DELETE/ARCHIVE/RESTORE/PERMANENT_DELETE`；生成与人工首稿 token 只链接 Task Editor。永久删除必须先读取实时 preview 并使用其 revision 和确认文本，所有 Dialog 关闭后恢复 overflow 触发器焦点。

## 4.2 `/content/tasks/new`

Pattern：Form。当前 `ContentTaskCreate` 的权威字段只有 Product、Approved Fact Version、Target Platform；不得恢复 Topic/GEO Source、Content Intent、audience、angle、conversion goal、format、length、generation/manual mode、notes、Prompt 或 AI model。

页面以 `GET /content-tasks/creation-options` 一次读取活动 Product 及其非空 `APPROVED` FactVersion、活动 PlatformProfile；Product 改变时清除旧 FactVersion。`productId` handoff 保留在 URL，并由服务端返回明确的合格、不存在、停用或无批准事实状态；不合格时不得静默改选。

创建使用稳定 `Idempotency-Key` 调用既有 `POST /content-tasks`。服务端仍在事务锁内重新校验三项资格；平台缺 Prompt 不阻止任务创建。成功后采用响应中的 canonical `ContentTask.id`，失效 Content Task List、清除 DirtyGuard 与幂等键，并进入 `/content/tasks/$taskId`；不得通过列表搜索新任务 ID。

## 4.3 `/content/tasks/$taskId`

Pattern：Detail / Workspace Shell。页面只消费 `GET /api/v1/content-tasks/{content_task_id}/detail`，一次展示 Task identity、锁定的 Product/Fact/Platform、严格由 `current_content_version_id` 解析的 Current Content、最近相关 Generation Job、当前主线 Review、Publishing、真实 Source Context 与服务端已排序的最近十项 Activity。空摘要明确显示“暂无”。

专用 read model 在单个 PostgreSQL `REPEATABLE READ` 请求中形成一致 snapshot，并以固定次数批量查询完成；浏览器不得请求 Task List、FactVersion、ContentVersion、GenerationJob、Review、Publication 或 GEO 接口自行 join，也不得重排 Activity。Primary Action 始终消费服务端 `primary_task`；后续 Editor/Review/Publication 页面未实现时只生成 routing blueprint 已确定的 canonical link，不在 Detail 内复制工作流或创建占位成功页。生命周期 overflow 复用 Content domain 的 CANCEL/DELETE/ARCHIVE/RESTORE/PERMANENT_DELETE command、revision conflict、deletion blockers、request ID 与 Dialog focus return。

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

AI Production 仅在服务端返回对应 action token 时显示。generation-options 在用户打开确认 Dialog 后按需读取，Prompt revision 与 model 必须明确确认；创建命令使用稳定 `Idempotency-Key`。页面只对当前 `PENDING/RUNNING` job 轮询 summary，terminal 后停止并重新读取 Editor Context；完整 job detail/snapshot 只在用户查看时读取，retry 只提交原 job ID，由服务端精确重放冻结 snapshot。Humanization 由 `CREATE_HUMANIZATION_JOB` 驱动，并创建新 GenerationJob 与新 AI DRAFT，源版本不变。

## 4.5 `/content/tasks/$taskId/review`

Pattern：Workspace。主区域是 immutable Markdown，右侧 Review Panel 展示 blocking issues、warnings、fact consistency、platform adaptation、review timeline；底部 `[退回修改] [批准内容]`。

Review Context 应一次加载 content、diff、quality issues、fact markdown、generation snapshot、review timeline。

## 4.6 `/content/versions/$versionId`

Pattern：immutable Detail。页面只消费 `GET /api/v1/content-versions/{content_version_id}/detail`，一次展示 title、summary、Markdown、tags、version/status、AI/HUMAN source、对应 Fact Version、compact Prompt/model/generation lineage、content hash、creator、change summary、目标版本自己的 review result/timeline，以及创建和更新时间。响应同时明确该版本是否为 `ContentTask.current_content_version_id`；页面只展示该事实，不改变主线。

该 read model 在单个 PostgreSQL `REPEATABLE READ` 请求内形成一致 snapshot，不返回完整 ContentTask、Fact Markdown、全部 GenerationJob 或内容历史。历史记录的 `updated_at` 允许为空并显示明确缺失状态；没有 generation 或 review snapshot 时显示“暂无”，不得请求 Editor Context、Review Context 或 GenerationJob 接口补齐。

所有 Content Version（包括当前 HUMAN DRAFT）在本路由都只读。页面不使用表单、CodeMirror、DirtyGuard 或 workflow action，不提供 SAVE、DELETE、APPROVE、REQUEST_CHANGES、ABANDON，也不按 status 推导动作。返回入口使用所属 `/content/tasks/$taskId` canonical link，对应事实使用 Product Fact Version canonical link；本页不复制 Editor、Review Workspace、Content History 或 Publication Workspace。

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

Pattern：Workspace。页面只请求 `GET /api/v1/publication-works/{work_id}/workspace-context`，一次获得工作、平台与账号身份、批准 Markdown、最新实际发布结果、附件、核验历史、事件时间线和服务端动作。发布包只在用户点击复制时按需请求，不进入首屏 waterfall。

主区只读展示 Approved Content Markdown；上下文区展示 Platform、Account 和 Current Stage，不恢复跨平台无意义的 Target Section。结果区展示已登记的 actual title、final URL 与发布时间；Evidence、Verification History 和 Publication Event Timeline 都按服务端顺序呈现。

动作只消费 `available_actions` 中的 `UPDATE_PREPARATION`、`MARK_PLATFORM_REVIEW`、`REGISTER_RESULT`、`VERIFY`、`SWITCH_CONTENT_VERSION` 与 `CLOSE`。Core 实现前四个写动作和发布包复制；核验与切换批准版本进入后续任务。所有命令携带当前 `expected_revision`，成功后采用 canonical response 并刷新 Context；`409` 保留本地表单与已完成上传，只有显式 reload 才丢弃草稿。

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

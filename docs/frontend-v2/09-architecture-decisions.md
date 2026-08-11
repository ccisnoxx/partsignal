# PartSignal Frontend V2 Architecture Decisions

本文作为简化 ADR 索引。重大变化应继续追加 ADR，而不是只在 PR discussion 中达成。

## ADR-001：新建 `frontend-v2/`

**Decision**：V2 在独立前端目录开发，成熟后整体替换 V1。  
**Why**：Router/UI/CSS/Table 均是核心变更；避免旧 Ant Design styles 与新系统污染；V1 保持业务参考。

## ADR-002：保留 React + Vite，不切 Next.js

**Decision**：React SPA + FastAPI。  
**Why**：登录后业务工作台、SEO 非核心、FastAPI 已是明确后端、高交互，避免第二 server layer。

## ADR-003：使用 TanStack Router

**Decision**：从 React Router 切到 TanStack Router。  
**Why**：PartSignal 大量 filter/pagination/sort/date/workspace section 应进入类型安全 URL。

## ADR-004：TanStack Query 只管理 Server State

禁止把 URL/form/local UI state 混进 Query cache。

## ADR-005：TanStack Table 是默认业务表格 engine

所有一般业务表格使用 TanStack Table + PartSignal Table Kit。真正 spreadsheet/huge grid 才单独考虑 AG Grid。

## ADR-006：shadcn/ui + Base UI

用 shadcn component source + Base UI primitives 构建 PartSignal Design System，以获得产品级自定义和可访问性基础。

## ADR-007：V2 不继续以 Ant Design 为基础

不是因为 Ant Design 不成熟，而是 V2 要从“标准后台”升级为高度定制的专业工作台。

## ADR-008：审核不占 Sidebar

Fact Review / Content Review 是 Workflow route。入口来自 Workbench、row Primary Action、deep link。

## ADR-009：发布资源一拆三

```text
/publishing/work
/publishing/articles
/publishing/issues
```

前端与 `PublicationWork / PublishedArticle / PublishedContentIssue` 领域边界一致。

## ADR-010：内容编辑 route 以 Task 为入口

主编辑：`/content/tasks/:taskId/editor`。  
历史版本：`/content/versions/:versionId`。

原因：`ContentTask.current_content_version_id` 是当前内容主线权威指针。

## ADR-011：不可变对象统一 Detail

Fact submitted snapshot、Content history、PublishedArticle、verification snapshot、audit record、GEO history 等使用 readonly Detail。

## ADR-012：每行一个 Primary Action

Row 标准 `[Primary] [•••]`，最多一个 Primary。

## ADR-013：不显示冗余“查看详情”

对象名称/行承担详情导航。只有确有语义或可访问性原因时再例外。

## ADR-014：业务资格服务端权威

前端不从 status/role 推导另一套 action eligibility，消费 `workflow_stage / primary_task / available_actions`。

## ADR-015：Read Model 优先于客户端拼装

复杂列表/Workspace 由 API 提供 UI-oriented projection/context，避免 waterfall、snapshot 不一致和前端 join。

## ADR-016：Domain Vertical Slice

主要 domain：product、content、publication、geo、platform、generation、identity、audit。

## ADR-017：Workbench 最后实现

Dashboard 是所有 domain 的聚合，应在 Product/Content/Publishing/GEO 稳定后实现。

## ADR-018：Prompt 使用 Workspace

Prompt 使用 Library + Editor + Preview 三栏，不退化成普通表单。

## ADR-019：GEO Analytics 与业务 Table 分离

Analytics 使用自己的 Pattern/ECharts，不强行复用 CRUD Table 视觉。

## ADR-020：测试 Pattern，而不只测试页面

Design System Pattern 必须有 Storybook/component coverage；关键 domain workflow 用 E2E。

## ADR-021：Product Detail 使用独立一致性 Read Model

**Decision**：`/products/$productId` 只消费 `GET /api/v1/products/{product_id}/detail`；既有 Product response 不增加跨域摘要。服务端在同一个 PostgreSQL `REPEATABLE READ` 请求事务内批量形成 compact facts/content/publishing/GEO projection，并返回已排序 typed Activity。

**Why**：现有单项接口不能完整按产品筛选发布数据，浏览器多请求会引入 join、waterfall、N+1 和 snapshot 不一致。独立 schema 也避免污染 Product create/update、Products List 与 repair context。

**Action ownership**：页面原样消费 Product `primary_task`、`available_actions`、`deletion` 和 `revision`。Products List 的 UPDATE 链接 Product Detail；详情内短 Dialog 是产品基本信息的 canonical edit surface，不新增猜测性的 `/edit` route，也不编辑事实正文。

## ADR-022：Fact Review 使用产品级目标定位 Read Model

**Decision**：`/products/$productId/facts/review` 只消费 `GET /api/v1/products/{product_id}/fact-review-context`。服务端优先定位唯一 `PENDING_REVIEW` FactVersion，否则返回最新版本；无版本返回 `review: null`。客户端不请求 Product Detail、Facts 或 Versions 猜测目标。

**Review evidence**：事实审核上下文只包含不可变 Markdown snapshot、metadata、紧邻前序版本的服务端 Diff、目标版本自己的追加式 Review History，以及窄动作 `APPROVE | REQUEST_CHANGES`。当前事实模型没有 Evidence 或 Blocking Issues。

## ADR-023：Fact History 使用 Product 专用分页 Read Model

**Decision**：`/products/$productId/facts/versions?page=1&pageSize=20` 只消费 `GET /api/v1/products/{product_id}/fact-history`。服务端在 `REPEATABLE READ` 中返回 Product identity、按 `version DESC` 排序的窄版本项和分页 metadata；页面不得再请求 Product Detail 拼标题。

**Compatibility**：既有 `FactVersionList` 虽能绘制六列，但无分页、携带完整 Markdown/动作/删除投影且被 V1 三处调用。保留 `listFactVersions` 不变，避免破坏 V1；新投影只属于 Product domain，不创建通用 History API、第二套 DTO framework 或未来 Content History 抽象。

**UI ownership**：Fact History 是无操作列的 readonly Table；`VIEW_FACT_HISTORY` 指向该 canonical route，版本链接进入既有 immutable Detail。排序、命令资格和 Product context 均不由浏览器推导。

## ADR-024：Content Task List 扩展既有 endpoint 的兼容双模式

**Decision**：`/content/tasks` 继续消费 `GET /api/v1/content-tasks`。显式 `page + page_size` 启用服务端搜索、阶段/归档/平台筛选、稳定排序和分页；两者都省略时保留 V1 完整集合语义。现有 `ContentTaskListItem` 增加 identifier、current mainline summary 和 updated_at，不新增 V2 endpoint 或客户端 DTO。

**Why**：现有批量投影已拥有 ContentTask workflow/action 权威且没有 N+1，缺口只是列表字段和查询能力；新增 endpoint 会复制同一领域 read model。兼容双模式避免破坏 V1 本地搜索、统计、分页和 Detail/Editor 的既有调用，又不引入 `view=v2`、feature flag 或客户端版本判断。

**Lifecycle ownership**：普通 DELETE 补齐必填 `expected_revision` 并在行锁内复核；CANCEL/ARCHIVE/RESTORE/PERMANENT_DELETE 继续使用各自既有 command/preview 合同。V2 只按 `primary_task/available_actions/deletion` 呈现入口，409 刷新 projection 但不自动重放。

## ADR-025：Content Task Detail 使用独立 snapshot read model

**Decision**：`/content/tasks/$taskId` 只消费 `GET /api/v1/content-tasks/{content_task_id}/detail`。服务端在单个 PostgreSQL `REPEATABLE READ` 请求内以固定次数装配 compact task、锁定上下文、当前主线、生成、审核、发布、真实来源与最近十项 typed Activity；前端不跨域 join、不选择“最新”版本，也不重排 Activity。

**Boundary**：基础 `ContentTask` 保持 command canonical response，不承载跨域详情；Detail response 也不包含正文、Diff、完整 Review Context、Generation snapshot 或 Publication Workspace。`current_content` 严格来自 `current_content_version_id`，历史平台 fallback 与 source 是否存在由服务端决定。

**UI ownership**：Primary/overflow 只消费服务端 `primary_task/available_actions/deletion/revision`。List 与 Detail 仅在 Content domain 内共享最小 action/lifecycle 边界；不创建 design-system 业务组件、通用 aggregate framework 或 workflow engine。后续页面只使用已确定 canonical link，本期不创建占位页面。

## ADR-026：Content Editor 拆分同步 Core 与异步 AI Production

**Decision**：Phase 3.4 不合并为一个超大 Task。Core 先交付 Task 路由的同步人工编辑闭环；`frontend-v2-content-ai-production` 再在同一 Editor surface 交付 AI generation、progress/failure、exact snapshot retry 与 humanization。两者共享既有 Content/Generation 合同与服务端 action token，不共享新的前端 workflow framework。

**Editor snapshot**：首屏只消费 `GET /api/v1/content-tasks/{content_task_id}/editor-context`。服务端在 `REPEATABLE READ` 中按 `current_content_version_id` 装配当前 ContentVersion、锁定 Fact Markdown、服务端 Diff、quality issues、compact generation/lineage/source；不返回完整 Review/Publication Context、全部版本或全部作业历史。AI options 与 exact snapshot 只在用户触发时读取；summary polling 仅在 tracked job 为 `PENDING/RUNNING` 时运行，terminal 后停止并重新读取 Editor Context。

**Mutation ownership**：页面仅显示 Editor surface 的服务端 action token。Manual/revision 创建新 HUMAN DRAFT；SAVE 只更新当前可变 HUMAN DRAFT；SUBMIT_REVIEW 要求表单已保存；DELETE 与 ABANDON 保持不同语义。AI DRAFT、CHANGES_REQUESTED、审核中和已批准版本不可原地编辑，客户端不按 version/created_at 选择主线或恢复父版本。

**AI command ownership**：generation/retry/humanization 使用各自稳定 `Idempotency-Key`；Prompt/model 由用户明确确认，但 generation snapshot 只由服务端冻结。retry 只提交原 job ID，服务端验证它仍是任务实际 latest job 并精确复制 snapshot。Humanization 创建新 GenerationJob 与 based-on ContentVersion，不修改源版本。

## ADR-027：Content Version Detail 使用 compact immutable read model

**Decision**：`/content/versions/$versionId` 只消费 `GET /api/v1/content-versions/{content_version_id}/detail`。既有 ContentVersion response 缺少 change summary、更新时间、creator、Prompt/model/generation 与 review snapshot；页面又不能通过 Editor/Review/Generation 多接口拼装，因此服务端在单个 `REPEATABLE READ` 请求内一次返回页面实际消费的 compact snapshot。

**Boundary**：响应包含不可变内容、Fact identity、creator、`change_summary`、nullable `updated_at`、current-pointer 布尔值、compact generation lineage 和目标版本 review timeline；不包含动作、完整 Task、Fact Markdown、全部作业或版本历史。`content_versions.updated_at` 对迁移前历史记录保持 `NULL`，新记录使用数据库默认值并随允许的 HUMAN DRAFT 更新；不伪造历史更新时间。

**UI ownership**：本路由对所有 status/source/current-pointer 组合始终只读，不推导或调用任何命令，也不切换 current pointer。Content domain 直接复用 MarkdownPreview、DetailSection、Timeline 与 Badge，不创建跨 Fact/Content 的 Version Detail framework；业务 query key、错误分类、状态、时间和 timeline 投影仍由 Content owner 管理。

## ADR-028：PublishedArticle 保留窄 list/detail 并扩展 immutable detail

**Decision**：`/publishing/articles` 继续消费既有 `GET /api/v1/published-articles`，additive 增加服务端 `search/sort`；`/publishing/articles/$articleId` 继续消费既有 detail endpoint，additive 嵌入 `ContentVersionDetail` 与 PublicationWork events。不新增 Article Context、Content snapshot DTO 或客户端多接口 join。

**Snapshot boundary**：PublishedArticle 与 PublicationWork 同 ID，固定 verification 必须为 PASSED；该 verification 的 `content_version_id` 唯一决定来源内容。平台/账号文本只读取 Work 终态 snapshot，来源 payload/hash 与 events 在单个 `REPEATABLE READ` 请求中校验和返回；live Profile/Account、ContentTask current pointer 与后续 ContentVersion status 不能改写发布时历史。

**UI ownership**：Article List 是固定五列 readonly Table，Detail 复用 MarkdownPreview、DetailSection、Timeline 与 Badge。两页不消费既有 `available_actions/deletion`，不按 health/status 推导动作，也不提供编辑、删除、重新核验、Published Content Issue 或 GEO 能力；这些 workflow 保留给各自后续 canonical surface。

## 后续建议 ADR

未来以下问题单独建 ADR：是否引入 AG Grid、server-side user preferences、Command Palette、多租户、实时协作、WebSocket/SSE、错误监控平台、自动发布、i18n。

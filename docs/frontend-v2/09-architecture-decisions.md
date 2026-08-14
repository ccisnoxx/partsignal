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

**UI ownership**：Article List 是固定五列 readonly Table，Detail 复用 MarkdownPreview、DetailSection、Timeline 与 Badge。成果 payload 始终不可编辑；Detail 只消费 `OPEN_ISSUE` 或 `HANDLE_CONTENT_ISSUE + open_issue_id` 交接 Issue lifecycle，不按 health/status 推导资格，也不提供成果删除、重新核验或 GEO 能力。

## ADR-029：PublishedContentIssue 使用单一 Workspace Context

**Decision**：`/publishing/issues` 复用既有批量 list DTO；`/publishing/issues/$issueId` 新增窄 `GET /api/v1/published-content-issues/{issue_id}/workspace-context`，返回 `issue + immutable article + nullable repair_task`。既有 `repair-context` 只在创建修复任务时按需读取 Fact 候选，不扩成首屏万能载荷。

**Snapshot boundary**：issue list/detail/workspace/repair-context 均在单个 `REPEATABLE READ` 请求内投影。Workspace 校验 Issue/Article、PASSED verification、来源 ContentVersion ID/hash 与 repair source identity；浏览器不得跨请求 join。`CANCELLED` repair task 与 `COMPLETED` 一样进入待确认解决，但不代表 issue 已解决。

**UI ownership**：Issues List 固定六列，Workspace 只拥有 issue report、repair/resolution 与不可变关联历史；实际修复内容仍在 `/content/tasks/$taskId`。当前合同没有 issue attachment/evidence upload，页面不渲染占位能力。

## ADR-030：GEO Observation List 使用 additive compact read model

**Decision**：`/geo/observations` 只消费新增 `GET /api/v1/geo-observations/list-items`。既有 collection endpoint 保留完整 `GeoObservation` 响应供 V1 使用；新 endpoint 统一 legacy/manual 的列表字段、只返回纠正链尾，并在服务端完成 Product/query search、platform/accuracy/date filter、稳定排序、分页、证据继承和 actor-aware actions。

**Why**：完整 DTO 携带 notes、citations、文章与附件详情，仍缺少列表直接需要的 Product label、统一 platform、compact outcomes 和关联/证据计数。扩展旧 DTO 会污染 V1 与详情合同，浏览器 join 或逐行补请求又会制造 waterfall、N+1 与分页后本地语义错误；additive 窄投影把列表事实放回唯一服务端 owner。

**UI ownership**：页面复用既有 TableShell、FilterBar、RowActions、Pagination 和 TanStack Router/Query/Table pattern，不新增通用 DataTable 或 GEO status enum。`available_actions` 是更正/删除的唯一呈现依据；List 输出 Detail 与 Correction canonical anchors，两者分别由 ADR-031 与 ADR-032 落地。当前数据库未变化，manual discovered/mentioned 的非空约束继续权威，accuracy 未评估由 compact counts 表达。

## ADR-031：GEO Observation Detail 使用窄 generated union read model

**Decision**：`/geo/observations/$observationId` 只消费 additive `GET /api/v1/geo-observations/{observation_id}/detail`。既有单条 GET、collection 与 POST 基础 `GeoObservation` 保持不变；新 read model 以 `observation_kind` 区分 Legacy 单记录与 Manual 完整 correction chain，一次返回 Query Topic、Product、Published Articles、direct evidence/签名地址和服务端动作投影。

**Snapshot boundary**：服务端在 `REPEATABLE READ` 中通过 recursive CTE 确定唯一 root，并校验、排列 root→tail；selected/root/tail 和 original/selected/tail 标记均由响应明确表达。文章使用 PublicationWork 终态 snapshot，证据只从节点直接 attachment 关系读取；浏览器不得跨旧 GET、Article 或 File endpoint join，也不得按 `created_at/is_current/supersedes_id` 重排或推导动作。

**UI ownership**：所有 Observation 与 Correction 始终 readonly。Detail 与 List 仅在 GEO domain 内共享最小 action resolver；CORRECT 永远指向服务端链尾 canonical Correction URL，DELETE 只消费 tail token 并复用现有命令和 Dialog。New Observation 成功后直接消费 POST response ID 进入 Detail；不创建通用 Detail/History framework，现有 Timeline 只增加承载只读节点内容的 optional slot。

## ADR-032：GEO Correction 使用组合 Detail 的专用读取上下文与通用 append POST

**Decision**：`/geo/observations/$observationId/correct` 只消费 additive `GET /api/v1/geo-observations/{observation_id}/correction-context`；该响应直接组合既有 `ManualGeoObservationDetail`、当前 Published Article 候选初值和历史空 Query Topic 的选项。写入继续使用 `POST /api/v1/geo-observations` 与 `GeoObservationCreate.supersedes_id`，不增加 Correction command、数据库字段或兼容 DTO。

**Snapshot boundary**：读取在单个 `REPEATABLE READ` 事务中确定 actor 的 `CORRECT` 资格、权威尾、当前候选和 Topic 规则。Product、Platform、Search Query 与非空 Topic 由上下文冻结；历史结果和证据只读。`GEO_PUBLICATIONS_CHANGED` / `REVISION_CONFLICT` 不自动重放，只有显式刷新才按文章 ID 合并仍有效草稿，并以服务端新尾 replace URL；提交仍由服务端锁内复核所有不变量。

**UI ownership**：Correction 使用专用 form model 并复用现有 WorkspaceShell、DirtyGuard、StickyActionBar 与 GeoEvidenceUpload；不把 New/Correction 合并为通用 GEO Form，也不引入全局草稿 store。成功只使用 POST 响应 ID 进入新 Detail。页面级 strict fixture 证明 production artifact 状态机，完整真实栈 GEO 闭环保留给后续独立 Task。

## ADR-033：Query Topic 保留完整 options 并新增窄 V2 list-items

**Decision**：`/geo/topics` 只消费 additive `GET /api/v1/query-topics/list-items`，由服务端完成 canonical question/variant search、稳定排序、分页、三类业务引用批量摘要和 actor-aware actions。既有 `GET /api/v1/query-topics` 保持完整 `QueryTopicList` 语义，继续服务 V1、New Observation 与 Correction Workspace；不增加 `view=v2`、兼容字段或 Query Topic Detail endpoint。

**Why**：完整 options 是现有表单消费者需要的稳定合同，但 V2 Table 需要服务端分页和所有角色可见的跨域引用摘要；直接扩展旧 endpoint 会破坏完整列表语义，浏览器逐行 join 又会制造 N+1。一个窄 read model 是兼容现有消费者且不复制 mutation 合同的最小边界，无需数据库迁移。

**Ownership**：Query Topic 服务以同一批量引用查询同时形成 Content Task、GEO Optimization source 和 Observation count；`deletion` 仍只向 ADMIN 投影，开始观测、编辑和删除只消费 `primary_task/available_actions/deletion`。创建/编辑使用短 Dialog，PATCH/DELETE 409 保留草稿并只允许显式 reload；引用 resolve links 只进入已实现且支持精确 Topic filter 的 Content Task 或 Observation 列表。

## ADR-034：GEO Insights Screen/Print 单 read model、冻结平台身份与局部 SVG

- 决定：页面以单个 `GET /api/v1/geo-insights` 为指标、筛选选项和动作来源；命令 Dialog 只按需读取既有 Content Task creation-options。
- 决定：`PublicationWork` 同时冻结无外键平台 UUID 与名称。实时 PlatformProfile 可删除，历史 PublishedArticle/GEO 关系仍保持精确身份；无法回填时 migration 显式失败。
- 决定：`optimization_action` 是 actor-aware、required nullable 的服务端 source projection；写命令在 advisory lock 内按完整 source+target 重算并校验幂等。
- 决定：三个单指标趋势使用局部 SVG 与原生精确表格，不安装 ECharts，不创建通用 Analytics/Chart framework。
- 决定：`/geo/insights/print` 与 Screen 共用七参数 URL owner、query key、read model 和 GEO 域报告体；route metadata 只让该 child 使用无导航 Print shell。Print 不接受 action callback，不读取 creation-options 或 mutation；筛选标签只从同一响应解析，打印调用原生 `window.print()`。
- 决定：375px Screen media 只以 CSS `data-label` 将同一语义 table 卡片化；Print media 保留 table DOM、重复表头并控制 row/短卡片分页，不引入 PDF 服务、Puppeteer 或全局 `@page`。
- 边界：不为 Recommendation 猜测 V2 链接，不把 strict fixture 宣称为完整 real-stack E2E。

## ADR-035：Platform List 扩展既有双模式 collection，并分离 readiness

**Decision**：`/settings/platforms` 继续消费 `GET /api/v1/platform-profiles`，显式分页时完成服务端搜索、类型/状态/readiness 筛选；省略分页时保留 V1 与 Content options 的完整参考集合语义。不新增 V2 endpoint、客户端 DTO、数据库列或 migration。

**Read model ownership**：旧 `configuration_*` 保持 Prompt-only 语义；独立 `readiness_status` 以缺 Prompt、缺启用账号、完整三态表达列表就绪度。账号 total/enabled 在同一次批量查询中聚合，summary 不受当前筛选影响，类型 options 由同一响应稳定提供。普通用户的 Primary/actions/deletion 由服务端归零，浏览器不推导权限或业务状态。

**Mutation boundary**：ENABLE/DISABLE/DELETE 都使用 canonical row revision，DELETE 将 `expected_revision` 收紧为 required query，并仅同步 V1 既有直接调用。409 刷新列表但不自动重放；行锁内 revision、目标状态、权限和实时 blocker 仍由服务端最终裁决。Platform 名称和导航动作只输出后续 Workspace 的 canonical href，本 Task 不创建占位 route。

## ADR-036：Platform Workspace Core 扩展既有 Detail 并按 Tab 延迟读取

**Decision**：`/settings/platforms/$platformId?tab=overview|accounts|generation` 首屏继续消费既有 Platform Detail endpoint，additive 增加稳定 `platform_type_options`，并把读取权限从 ADMIN 扩为 CurrentUser。响应在 `REPEATABLE READ` 中显式接收 `can_manage`，复用 Platform List 的 Platform projection；不新增巨型 Workspace DTO、客户端 DTO 或数据库字段。

**Request boundary**：Detail 是 Shell/Overview 唯一首屏业务请求。Accounts 只在对应 Tab 按 `platform_profile_id` 读取；Prompt references 只在可管理用户进入 Generation 时读取。账号明细和全部 Prompt 不进入 Detail，浏览器也不从 Platform List 搜索当前平台或抓 Prompt Detail 拼 options。

**Mutation and draft boundary**：Overview 与 Generation 是两个独立 RHF+Zod 草稿，但每次写入都提交当前 Detail revision 的单个完整 `PlatformProfileUpdate`，并保留另一表面的权威字段。Logo 只绑定 verified `PLATFORM_LOGO` FileRecord；外部候选必须二次确认。409 保留草稿且不 replay，显式 reload 才采用新 baseline。跨域 cache 组合留在 route，Configuration domain 只拥有 Platform List/Detail/Accounts/Prompt keys。

**Scope boundary**：Core 只读展示账号标签、内部标识与状态。账号 CRUD、actor-aware actions、revision delete 与 blocker 属于拆分后的 `frontend-v2-platform-workspace-accounts`；不为将来能力预建通用 Settings Workspace、CRUD registry 或媒体框架。

## ADR-037：Platform Account 复用行级动作投影，集合创建保持页面动作

**Decision**：Accounts Tab 复用既有 `PlatformAccountList` 与 CRUD/enable/disable endpoints，不新增 Workspace Account DTO、`CREATE` token、路由或通用 CRUD 框架。创建是页面级动作；行级入口穷尽消费 `primary_task/available_actions/deletion/revision`，不读取 `isAdmin` 推导资格。

**Concurrency and error boundary**：Account DELETE 收紧为 required `expected_revision` query。服务在既有 Platform → Account 锁序内先比较 revision，再实时统计非终态 PublicationWork；PublicationWork 创建使用同一锁序。同平台 normalized identifier 继续由数据库唯一约束权威保证，预检与约束竞态共享 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 字段错误。

**UI and cache boundary**：create/edit 使用局部 RHF+Zod Dialog，status/delete/blocker 使用既有 RowActions 与 Dialog；409 保留输入或确认上下文并要求显式 reload。375px 使用局部移动卡片，较宽视口使用 TableShell，不改变全局 Table Kit。Configuration domain 失效 Platform list/detail/accounts，route 只组合 Publication ready/work list/workspace context；冻结 PublishedArticle snapshot 与 Content caches 不失效。

## ADR-038：Platform Type 复用既有管理合同并补权威引用数量

**Decision**：`/settings/platforms/types` 作为“平台与账号”的 ADMIN-only subsettings 继续复用 `/api/v1/platform-types`，不新增 V2 endpoint、Detail route、Sidebar 项、数据库列或通用 CRUD/Settings 框架。列表固定 Name、Slug、平台数量和 overflow；`primary_task=EDIT_CATEGORY` 只表达服务端任务语义，不强制独立 Primary button。

**Read model and field boundary**：`platform_count` 与 deletion blocker 在一个 grouped query 中统计全部 Enabled/Disabled PlatformProfile，列表按 `lower(name), id` 稳定排序。name 由请求 schema trim、允许重复；slug 不自动规范化、允许更新，并只把真实 `uq_platform_types_slug` 约束映射为稳定字段错误。

**Concurrency, permission and cache boundary**：PATCH body 与 DELETE query 都要求 canonical revision。DELETE 锁行后先比较 revision，再实时复核 PlatformProfile 引用，明确区分 `REVISION_CONFLICT` 与 `PLATFORM_TYPE_IN_USE`。route 与四个 endpoint 都维持 ADMIN 边界；List/Workspace 的入口隐藏只负责 UX。create/update/delete 只失效 Type settings、全部 Platform lists 与全部 Platform details，覆盖 options 和名称消费者，不清 QueryClient 或触碰其他 domain。

## ADR-039：Prompt Preview 复用真实生成链路与窄 Options read model

**Decision**：Prompt Workspace Preview 新增唯一 ADMIN-only `GET /api/v1/platform-prompts/{platform_prompt_id}/preview-options`，但不新增 preview mutation、Job type、ContentVersion type、数据库字段或 provider 调用。提交继续使用既有 GenerationJob command；成功结果继续由既有不可变 ContentVersion 拥有。

**Read model ownership**：endpoint 路径按 Prompt 定位，资格和模型查询仍由 Content production/read-query owner 管理。候选任务先按当前 Platform→Prompt 绑定收窄，再复用 `content_tasks_out` 的 `CREATE_GENERATION_JOB` action 作最终筛选；模型与 generation-options 共用一个 helper。响应只提供 UI 选择所需身份，固定查询次数，不泄露 Markdown、snapshot、credential 或历史。

**UI and command boundary**：Configuration domain 拥有 Preview UI 与 query key，但只导入 Content domain 的公开 GenerationJob/JobList/ContentVersion API，不导入 Content 内部页面组件或复制状态机。context/model 必须显式选择，确认文案揭示普通首稿副作用；同 signature 的未成功请求复用 key，只追踪 create response Job ID，terminal 后读取 Version，不打开完整 snapshot、不自动 retry。Prompt/Platform mutation 只失效当前 read models；历史 Job/Version 保持原快照含义。

## ADR-040：AI Channel List 收紧安全摘要并复用既有 collection

**Decision**：`/settings/ai` 继续消费既有 `GET /api/v1/ai-channels`，不新增 V2 endpoint、数据库字段、依赖或通用 Settings/Table framework。`AIChannelSummary` 删除 base URL，增加服务端模型总数和 `READY|NEEDS_SETUP` 配置状态；完整连接信息继续只属于既有 Detail。

**Action and concurrency boundary**：Primary/overflow 只穷尽映射服务端 token。列表直接命令限 ENABLE/DISABLE/DELETE，启停返回安全 Summary，删除改为 required revision query，三者都在行锁内比较 revision，启停另拒绝 no-op。409 保留当前 cache 且不 replay，只有显式 reload 才读取 canonical list。

**UI and scope boundary**：1024px 以上使用固定七列；768/375px 用同一 row 在主单元格重复必要摘要，不创建第二套卡片数据。未来 Workspace 只通过 canonical href 交接，本 Task 不注册 `$channelId`、不提供创建入口，也不读取 detail/models/headers。命令成功由 route 组合失效 AI lists、Prompt Preview Options 与 Content generation-options。

## 后续建议 ADR

未来以下问题单独建 ADR：是否引入 AG Grid、server-side user preferences、Command Palette、多租户、实时协作、WebSocket/SSE、错误监控平台、自动发布、i18n。

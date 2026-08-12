# Frontend V2 Published Content Issues List + Workspace

## Goal

交付 Published Content Issue 的 canonical 列表 `/publishing/issues` 与处理工作区 `/publishing/issues/$issueId`，并补齐 Published Article 到新问题工作区的最小入口。已认证运营人员应能在服务端权威投影驱动下登记问题、创建修复任务、继续修复、显式解决问题并查看不可变历史；浏览器不得跨接口拼首屏快照、从状态或角色推导资格。

## 用户价值

- 发布后内容问题不再嵌入 V1 `/publications` 混合页面，而有可复制、可刷新、可直接访问的独立 URL。
- 列表可优先处理 OPEN 问题，并按服务端分页读取 RESOLVED 历史。
- Workspace 一次读取同一 PostgreSQL snapshot 下的问题、发布成果与修复任务；创建修复任务所需候选只在用户发起该动作时读取。
- 修复任务和 issue resolution 保持独立：创建或完成修复任务都不自动解决 issue，解决 issue 也不修改修复任务。

## 权威来源与现状审计

### 已确认事实

- 路由蓝图与 ADR-009 已把 `PublicationWork`、`PublishedArticle`、`PublishedContentIssue` 固定为三组 URL；本任务承接 Phase 4 第 4 项（`docs/frontend-v2/02-information-architecture-and-routing.md:64`、`docs/frontend-v2/07-migration-plan.md:386`、`docs/frontend-v2/09-architecture-decisions.md:40`）。
- V2 当前只有 `/publishing/work` 与 `/publishing/articles`；导航、route tree 和 Publication domain 尚无 Issues runtime（`frontend-v2/src/app/navigation.ts:12`、`frontend-v2/src/domains/publication/publication.api.ts:39`）。
- 现有 issue list item 已包含六列所需字段、`revision`、`repair_task_id`、typed `workflow_stage`、唯一 `primary_task` 与 `available_actions`；列表无需浏览器关联 Article 或 ContentTask（`backend/app/schemas/publication.py:453`、`contracts/openapi.yaml:6686`）。
- 现有 list 仅支持 `status/page/page_size`，服务端按 `opened_at DESC, id ASC` 稳定分页；V1 业务只区分 OPEN 待处理与 RESOLVED 历史，没有搜索、类型、平台或日期筛选（`backend/app/services/publication_queries.py:937`、`frontend/src/features/publications/PublicationsPage.tsx:859`）。
- 现有 detail `PublishedContentIssueOut` 只有嵌套 Article list summary；Workspace 蓝图要求的来源内容、首次成功核验、Publication events 与修复任务状态不能由一次 detail GET 完整绘制（`backend/app/schemas/publication.py:468`、`docs/frontend-v2/03-page-and-workflow-blueprint.md:260`）。
- 现有 `repair-context` 返回完整 Article、原任务、Product、原 Fact 与候选 Fact，适合创建修复任务时按需读取；它过宽且候选会随业务变化，不应成为每次 Workspace 首屏载荷（`backend/app/schemas/publication.py:506`、`backend/app/services/publication_queries.py:1114`）。
- issue list/detail/repair-context 当前未使用 `_publication_read_snapshot`。list 的 count、page、Article health、repair task projection，以及 detail 的外层 issue 与内层 Article health 可能在 READ COMMITTED 下跨提交点混合（`backend/app/routers/publication.py:116`、`:662`、`:682`、`:696`）。
- 现有动作投影把任意非 `COMPLETED` repair task 都映射为 `REPAIRING / CONTINUE_REPAIR`。但 `ContentTask.CANCELLED` 的权威主任务是 `VIEW_CANCELLATION`，因此 cancelled repair task 会得到不可执行的“继续修复”主入口（`backend/app/services/publication_queries.py:181`、`backend/app/services/projections.py:262`）。
- 写命令均锁 issue 并重新校验权限、CSRF、revision、状态与 Fact 资格；创建 repair task 不修改 issue revision/status，resolve 只允许 `OPEN -> RESOLVED` 并递增 revision（`backend/app/routers/publication.py:710`、`backend/app/services/publication.py:827`、`:894`）。
- 数据库固定 issue 身份与描述不可变、只允许一次 `OPEN -> RESOLVED`、repair source 不可改；仅受控 PublishedArticle/归档 Task 聚合永久删除可以清理历史（`backend/alembic/versions/0034_publication_workflow_redesign.py:528`、`backend/alembic/versions/0038_published_article_delete.py:46`、`contracts/database.md:391`）。
- 当前领域没有 issue-specific evidence 文件或 attachment 合同。已有可展示依据只有 issue kind/description、公开 URL、不可变来源内容、首次 PASSED verification 与 Publication events；本任务不得猜测证据上传能力。
- OpenAPI 的五个 issue endpoint 只声明 `422`，与运行时已有的 `401/403/404/409` 不一致（`contracts/openapi.yaml:2575`）。
- Published Article detail 当前收到 `OPEN_ISSUE` token 也不渲染入口；上一任务明确把该 workflow 延后给 Published Content Issues canonical surface（`frontend-v2/src/domains/publication/published-article-detail-page.tsx:65`、`.trellis/tasks/archive/2026-08/08-11-frontend-v2-published-articles/prd.md:48`）。

### 合同判断

- **List：基本满足。** 复用现有 endpoint 与 item DTO；只补同请求一致快照和真实 error responses，不新增搜索、排序或 V2 专用列表 DTO。
- **Workspace：不满足。** 新增窄 `GET /api/v1/published-content-issues/{issue_id}/workspace-context`，一次返回 canonical issue、不可变 PublishedArticle detail 与可空 repair task；不让浏览器 join detail、Article、Task 和 timeline。
- **Repair options：现有 endpoint 满足。** `repair-context` 只在 `CREATE_REPAIR_TASK` Dialog 打开时按需读取；它是命令选项，不是首屏第二份快照。POST 继续在锁内重校验候选和 revision。
- **持久化合同：满足。** 无数据库 schema、migration 或第二套历史表变更。

## In Scope

- 注册 `/publishing/issues`、`/publishing/issues/$issueId` 和独立 `publishing-issues` navigation metadata。
- 列表 canonical URL：`status=OPEN|RESOLVED|ALL`、`page`、`pageSize`；默认显式 `status=OPEN&page=1&pageSize=20`，筛选变化回第一页。
- 固定六列：问题（actual title + issue kind）、平台、状态、打开时间、修复任务、操作；主单元格进入 Workspace。
- Issue Action Registry 穷尽映射 server `primary_task` 与 `available_actions`，不读取 raw status/role 计算资格。
- 新增窄 Issue Workspace Context，所有首屏 section 使用一次 GET 的同一 `REPEATABLE READ` snapshot。
- Workspace 展示 issue report、Published Article immutable context、公开地址、来源 Markdown、首次 PASSED verification、repair task、resolution note 与按 canonical fields/events 形成的 timeline。
- 当前合同下的“证据”只指 issue description 与不可变 Article/verification/event context；明确没有 issue-specific upload。
- 从 Published Article detail 消费既有 `OPEN_ISSUE` token，使用短 Dialog 提交 `kind + description`，成功后进入返回 issue ID 的 canonical Workspace；Article payload 仍不可编辑。
- `CREATE_REPAIR_TASK`：按需读取 `repair-context`，只展示服务端 `fact_candidates`，发送 `fact_version_id + expected_issue_revision`。
- `CONTINUE_REPAIR`：只使用 server `repair_task_id` 进入 `/content/tasks/$taskId`。
- `RESOLVE`：发送 `outcome + comment + expected_revision`；成功后重读 canonical context/list，不完成或取消 repair task。
- 修正 cancelled repair task 的服务端投影：由于现有唯一 source 约束不允许重建 repair task，投影为 `AWAITING_RESOLUTION / CONFIRM_RESOLUTION / [RESOLVE]`，Workspace 同时诚实显示任务已取消。
- issue list/detail/workspace-context/repair-context 使用同请求 snapshot；OpenAPI 补齐实际 structured errors；重新生成 V1/V2 schema。
- Backend unit/integration、Frontend model/component、production-artifact fixture Playwright 和相关文档/spec 更新。

## Out of Scope

- Publishing 完整真实栈 E2E checkpoint；由 Phase 4 后续独立 Task 连续验证 Article → open → repair → resolve。
- Phase 4 vertical-slice 抽象回顾。
- GEO 页面、观测、候选或优化能力；只保持既有 issue/GEO 服务端规则。
- issue-specific evidence 上传、附件表、截图 API 或数据库迁移。
- repair task 重建、重新打开 RESOLVED issue、编辑 kind/description/resolution、自动完成修复任务或自动解决 issue。
- PublishedArticle 编辑、删除、重新核验；只增加 issue lifecycle 的 server-token 入口。
- 新通用 Action Registry、workflow engine、万能 Workspace/DataTable、全局 Store、运行时依赖或未来占位能力。
- V1 UI、路由与本地状态重做；`frontend/` 仅允许 OpenAPI generated schema 的机械更新。
- 审计白名单扩展。当前数据库合同只保留 `RETAINED_AUDIT_ACTIONS` 中的成功事件，issue 命令没有独立保留审计不是本页面 Task 可单独改变的局部规则。

## Requirements

### R1 — Canonical routing 与 URL state

- `/publishing/issues?status=OPEN&page=1&pageSize=20` 是默认列表 URL；非法、缺失或额外参数必须 replace 后再 prefetch。
- `ALL` 只属于 URL/UI view model，映射为 API 省略 `status`；不得增加后端兼容 enum。
- `/publishing/issues/$issueId#issue` 是默认 Workspace URL；合法 sections 为 `issue | article | repair | resolution | history`，未知 hash replace 为 `issue`。
- route 只负责 Zod/UUID/hash validation、metadata、prefetch 和 composition。

### R2 — List read model 与 actions

- List 只请求现有 `GET /api/v1/published-content-issues`；不得额外请求 Article、Task 或 detail 补行。
- rows/count/article health/repair task status 在一个 `REPEATABLE READ` 请求中形成，查询次数不随当前页行数线性增长。
- Primary/overflow 矩阵：
  - `HANDLE_CONTENT_ISSUE`：`CREATE_REPAIR_TASK` 为 Primary，`RESOLVE` 为 overflow；
  - `CONTINUE_REPAIR`：repair task canonical href 为 Primary，`RESOLVE` 为 overflow；
  - `CONFIRM_RESOLUTION`：`RESOLVE` 为 Primary；
  - `VIEW_RESOLUTION`：Workspace `#resolution` 为只读 Primary。
- Primary 所需 command token/ID 缺失时显式失败，不补幽灵按钮或猜测 fallback。

### R3 — Single Workspace Context

- `GET /api/v1/published-content-issues/{issue_id}/workspace-context` 返回：
  - `issue: PublishedContentIssueOut`；
  - `article: PublishedArticleOut`；
  - `repair_task: ContentTaskOut | null`。
- 服务端必须校验 URL issue、nested Article、Article/Work/verification/source content ID/hash 与 repair task source identity；断裂返回 `409 PUBLICATION_CONTEXT_INCOMPLETE`，不返回部分对象。
- issue、article health、repair task status、source Markdown、verification 和 Publication events 来自同一 snapshot；事件保持服务端顺序。
- 初始无 data 的 403/404/409 使用 typed full-page error；有 cached data 的后台刷新失败保留 Workspace 并展示 request ID/retry。

### R4 — Issue 状态、primary task 与不可变历史

- 权威矩阵：
  - OPEN + 无 repair task → `OPEN / HANDLE_CONTENT_ISSUE / [CREATE_REPAIR_TASK, RESOLVE]`；
  - OPEN + repair task OPEN → `REPAIRING / CONTINUE_REPAIR / [RESOLVE]`；
  - OPEN + repair task COMPLETED 或 CANCELLED → `AWAITING_RESOLUTION / CONFIRM_RESOLUTION / [RESOLVE]`；
  - RESOLVED → `RESOLVED / VIEW_RESOLUTION / []`。
- CANCELLED 仅表示修复任务终止，不表示 issue 已解决；页面必须仍要求用户显式提交 resolution outcome/comment。
- UI 不提供 issue 原地编辑/删除/重开；resolution 只读展示 `RESTORED|RETIRED`、comment、actor、time、revision。
- Article events、issue opened/resolved fields 与 repair task created/status 只用于展示 timeline，不产生动作资格。

### R5 — Open、repair 与 resolve commands

- Article detail 只在 `available_actions` 包含 `OPEN_ISSUE` 时显示登记入口；若 `primary_task=HANDLE_CONTENT_ISSUE`，必须使用 server `open_issue_id` 生成 canonical Issue link。
- Open form 只提交 generated `PublishedContentIssueCreate` 两字段，携带 CSRF；成功使用 response ID 导航，不搜索列表。
- Repair form 只有在 issue `available_actions` 含 `CREATE_REPAIR_TASK` 时才读取 `repair-context`；客户端不得请求 Fact 列表、按 status 筛候选或把候选当授权。
- Resolve form 只有在 `available_actions` 含 `RESOLVE` 时可提交；`comment` 非空，revision 来自当前 context。
- command 成功后失效 issue context/list、Article detail/list、publication summary 与受影响 Content Task projections；不得把 `ContentTaskOut` 写进 issue context shape。
- 409 保留当前 Dialog 输入，不自动重放；显式 reload 后重新检查服务端 tokens，失效动作关闭 Dialog。

### R6 — Permission、errors 与 scope discipline

- reads 保持当前 `CurrentUser` 权限；writes 保持 `ADMIN|ENGINEER + CSRF`，服务端最终校验。前端不按账号类型计算 action eligibility。
- OpenAPI 为 list/detail/workspace/repair-context/open/repair/resolve 声明实际 `401/403/404/409/422 ErrorResponse`。
- 前端基于 status/code 展示 403/404/409/422 与 `request_id`，不解析 message 推导业务分支。
- 不新增数据库、依赖、通用抽象或 V1 runtime 兼容分支。

## Acceptance Criteria

- [ ] 默认列表 canonical 为 `/publishing/issues?status=OPEN&page=1&pageSize=20`；OPEN/RESOLVED/ALL、分页、refresh、Back/Forward 均只映射一个 list GET。
- [ ] 列表严格六列，行不请求额外资源；四种 primary task 和 overflow 只随 server tokens/IDs 变化。
- [ ] list count/page/article health/repair task projection 与 detail/workspace/repair-context 均在各自单个 `REPEATABLE READ` 请求中一致。
- [ ] `/publishing/issues/$issueId#issue` 一次 GET 展示 issue、Article immutable source/PASSED verification/events、repair task、resolution 与 timeline；无浏览器 join。
- [ ] no-task、OPEN repair、COMPLETED repair、CANCELLED repair、RESOLVED 五种状态得到精确 stage/primary/actions；CANCELLED 不再出现“继续修复”。
- [ ] healthy Article 只按 `OPEN_ISSUE` token打开两字段 Dialog，携带 CSRF，成功进入返回 ID 对应 Workspace；已有 open issue 使用 canonical link。
- [ ] repair candidates 只在打开 create-repair Dialog 时读取；payload 精确包含 fact ID/revision，创建后 issue 仍 OPEN 且出现 repair task link。
- [ ] resolve 使用 outcome/comment/revision；成功后 issue RESOLVED，repair task 保持原状态，`RESTORED/RETIRED` 历史只读。
- [ ] 409 保留表单、不自动重放并要求显式 reload；初始/后台错误区分，403/404/409/422 显示 request ID。
- [ ] fixture Playwright 拒绝未声明 API，覆盖 direct/refresh/Back/Forward、键盘/Dialog focus、375/768/1024/1440/1280 Workspace 和页面级无横向溢出。
- [ ] OpenAPI、FastAPI、V1/V2 generated types、backend tests、V2 component/E2E 与直接受影响文档一致。
- [ ] 没有 issue evidence upload、数据库迁移、GEO、完整 Publishing E2E、Phase 4 抽象回顾或新通用框架。

## Blocking Open Questions

无。上述范围与关键决定需由用户在最新规划摘要后显式批准，批准前不得 `task.py start` 或实施。

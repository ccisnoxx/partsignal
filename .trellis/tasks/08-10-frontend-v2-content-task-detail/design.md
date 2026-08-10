# Content Task Detail 技术设计

## 架构边界

数据流固定为：PostgreSQL owners → Content Task Detail query service → FastAPI/OpenAPI → generated client → Content domain query → Detail page。Route 只负责 prefetch/metadata/composition；业务 projection 与动作资格留在 backend/domain。

新增独立 `GET /api/v1/content-tasks/{content_task_id}/detail`，不扩展基础 `ContentTask` command response。这样 cancel/archive/restore 等命令仍返回 canonical ContentTask，不被迫装配跨域详情。

## Contract

`ContentTaskDetail` 必填字段：

- `task`: `id`, `identifier`, `status`, `workflow_stage`, `primary_task`, `available_actions`, `deletion`, `revision`, `created_by`, `created_at`, `archived_at`。
- `product`: `id`, `brand`, `part_number`, `status`。
- `platform`: `id|null`, `name`, `website_url|null`, `logo|null`。实时平台存在时取当前 profile/Logo；不存在时只取 task snapshot。
- `fact`: `id`, `version`, `status`, `classification`。
- `current_content|null`: `id`, `version`, `source_type`, `status`, `title`, `summary`。
- `generation|null`: `id`, `job_type`, `status`, `attempt_count`, `error_code|null`, `error_summary|null`, `created_at`, `started_at|null`, `finished_at|null`。
- `review|null`: `content_version_id`, 当前 ContentVersion `status`, `latest_result|null`；latest result 只含 `action`, `actor`, `created_at`。
- `publishing|null`: compact `work {id,status,updated_at}` 与 `result|null {id,status: VERIFIED,actual_title,final_url,published_at,verified_at}`。
- `source|null`: 三个 nullable 真实来源 summary：`query_topic`、`geo_optimization`、`published_content_issue`。三者全空时根对象为 null。
- `activity[]`: `kind`, `timestamp`, `actor`, `summary`, `target {kind,id,label}`。

响应不得包含事实/内容 Markdown、完整 generation snapshot、Review Context/Diff/history、Publication events/verifications/attachments 或 GEO aggregate。GEO `basis_snapshot` 必须按现有三种 `Geo*Basis` schema 解析后返回，不透传 unknown JSON。

## Backend projection

1. Detail route dependency 在任何 session query 前设置 `db.connection(execution_options={"isolation_level": "REPEATABLE READ"})`。
2. Query service 读取 task，404 使用既有 `not_found("内容任务")`。
3. 调用现有 `content_tasks_out(db, [task], can_permanently_delete=...)` 获取与 List 完全相同的 workflow/primary/available/deletion、identifier、Product/Platform/current pointer 基础投影。
4. 固定批量查询补充 Fact/current-content compact 字段、latest GenerationJob、当前主线 latest review、PublicationWork/PublishedArticle、真实 source。
5. Activity 使用一个 `UNION ALL` 查询收集 task creation、generation milestone、content version creation、content review record、publication work event，服务端按 `timestamp DESC, kind ASC, source_id DESC` 截取 10 条；再按 actor ID 集合一次查询 actor map。
6. 所有 schema 组装在查询完成后进行；循环中禁止单项 query/serializer。

选择规则：

- current content：只按 `task.current_content_version_id`，不存在或越界视为服务端 invariant failure，不选 max(version)。
- generation：任务全部 GENERATE/HUMANIZE job 按 `created_at DESC, id DESC` 取一条；workflow projection 仍使用原有业务规则。
- review：只查 current content ID；当前内容存在但无 record 时 `latest_result=null`。
- publishing：数据库保证每任务最多一个 work；result 只在同 ID PublishedArticle 存在时返回 VERIFIED。
- source：query topic 可来自 task 或 GEO source；GEO source row 存在时即返回，即使 article FK 已 SET NULL；repair issue FK 已清除且无 snapshot 时不猜测。

## Activity taxonomy

- `TASK`: task created。
- `GENERATION`: 每 job 一项，时间为 `finished_at ?? started_at ?? created_at`，summary 由 typed job type/status 穷尽映射。
- `CONTENT_VERSION`: version created。
- `CONTENT_REVIEW`: append-only review action。
- `PUBLICATION`: append-only publication work event。

未知 action/status 抛中文 developer-visible RuntimeError，让 contract/test 暴露漂移；不使用 mutable `ContentTask.updated_at` 或递归 AuditLog 猜时间线。

## Frontend data/action/cache

- `contentKeys` 新增 `details()`、`detail(taskId)`；query options 采用 `staleTime=30_000`、`refetchOnWindowFocus='always'`、`retry=false`、`retryOnMount=false`，不轮询。
- `$taskId` route loader 只 prefetch detail query；页面不访问其他 domain API。
- 将现有 Content Task primary/overflow registry 提取为 domain-local action module，输入只包含两种 response 共有的 canonical task action state；List 与 Detail 共用同一个 exhaustive switch。
- 生命周期 HTTP helpers 保留在 `content.api.ts`。最小 domain `ContentTaskLifecycleControls` 复用 RowActions、cancel/delete/archive/restore/permanent-delete、preview、409/request ID、blockers 与 `finalFocus`；不进入 design-system，不建立 workflow engine。
- command success 失效 `contentKeys.detail(id)`、`contentKeys.lists()` 及相关 preview；基础 ContentTask response 不写入 Detail/ListItem cache。
- 409 保留错误、禁止 replay、refetch detail/list。删除成功以 `refetchType: none` 失效旧 detail 后导航列表。
- New Task 成功以 POST response ID 导航 Detail；提交成功前清 idempotency ref、reset form、失效 lists。

## UI 与 canonical routes

页面层级：PageHeader → Summary → Locked Context → Current Content → Generation → Review → Publishing → Source Context → Timeline。所有 null section 显示“暂无”。

Primary mapping：

- `CREATE_FIRST_DRAFT`, `EDIT_AND_SUBMIT_REVIEW`, `REVISE_CONTENT` → `/content/tasks/$taskId/editor`
- `REVIEW_CONTENT` → `/content/tasks/$taskId/review`
- `VIEW_GENERATION_PROGRESS`, `HANDLE_GENERATION_FAILURE` → 当前 Detail `#generation`
- `START_PUBLICATION` → `/publishing/work`
- `CONTINUE_PUBLICATION` → `/publishing/work/$workId`；没有 work 时显式 invariant error
- `VIEW_FULL_LINEAGE` → 当前 Detail `#activity`
- `VIEW_CANCELLATION` → 当前 Detail `#summary`

CREATE_GENERATION_JOB/CREATE_MANUAL_VERSION 只链接 Editor。未实现 route 不创建占位页面。

Product link `/products/$productId`；Fact link `/products/$productId/facts/versions/$factId`；live Platform link `/settings/platforms/$platformId`，snapshot platform 仅文本；current content link `/content/versions/$versionId`。

## 兼容与文档

- 保持基础 `GET /content-tasks/{id}`、ContentTask schema、List 双模式和 command responses 不变，V1 不重构。
- 不新增 migration、依赖、表、缓存或通用 projection framework。
- 同步 `contracts/database.md`、frontend-v2 03/05/07/08/09、backend database guideline 与 frontend state-management 中直接受影响的权威说明。
